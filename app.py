import ipaddress
import json
import math
import os
import re
import secrets
import shutil
import socket
import subprocess
import threading
import time
import uuid
from collections import defaultdict, deque
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from functools import wraps
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from flask import (
    Flask,
    jsonify,
    render_template,
    request,
    send_file,
    stream_with_context,
    url_for,
)
from flask_socketio import SocketIO, emit, join_room, leave_room
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent
COMPANION_EXTENSION_ARCHIVE = BASE_DIR / "together-watch-companion.zip"
UPLOAD_DIR = BASE_DIR / "static" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
APP_STARTED_AT = time.time()
APP_VERSION = os.environ.get("APP_VERSION", "personal-beta")
APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()
TRUST_PROXY_HOPS = max(
    0,
    min(3, int(os.environ.get("TRUST_PROXY_HOPS", "0"))),
)

ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".webm", ".ogg", ".m4v"}
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", 512 * 1024 * 1024))
ROOM_TTL_SECONDS = int(os.environ.get("ROOM_TTL_SECONDS", 6 * 60 * 60))
MAX_ROOM_MEMBERS = max(2, min(500, int(os.environ.get("MAX_ROOM_MEMBERS", "50"))))
MAX_CALL_MEMBERS = max(2, min(12, int(os.environ.get("MAX_CALL_MEMBERS", "8"))))
UPLOAD_TTL_SECONDS = int(os.environ.get("UPLOAD_TTL_SECONDS", "0"))
MAX_PLAYLIST_BYTES = 2 * 1024 * 1024
ROOM_ID_PATTERN = re.compile(r"^[\w-]{4,64}$", re.UNICODE)
CONTROL_EVENTS = {"play", "pause", "seek", "change_source", "speed"}
REDIRECT_STATUSES = {301, 302, 303, 307, 308}
DIRECT_MEDIA_EXTENSIONS = {".mp4", ".webm", ".ogg", ".m4v", ".m3u8"}
MEDIA_SOURCE_MODES = {"direct_media", "official_page"}


def parse_host_allowlist(raw_value):
    """Parse exact hosts and explicit *.example.com wildcard rules."""
    rules = []
    for candidate in re.split(r"[\s,;]+", raw_value or ""):
        rule = candidate.strip().rstrip(".").lower()
        if not rule:
            continue
        base = rule[2:] if rule.startswith("*.") else rule
        try:
            base = base.encode("idna").decode("ascii")
        except UnicodeError:
            continue
        if (
            not base
            or len(base) > 253
            or not re.fullmatch(
                r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*"
                r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?",
                base,
            )
        ):
            continue
        normalized = f"*.{base}" if rule.startswith("*.") else base
        if normalized not in rules:
            rules.append(normalized)
    return tuple(rules)


# Compliance mode is intentionally hard-coded. The retired upload, extraction,
# proxy and transcoding paths cannot be re-enabled by a deployment variable.
ENABLE_LEGACY_MEDIA_PIPELINE = False
AUTHORIZED_MEDIA_HOSTS = parse_host_allowlist(
    os.environ.get("AUTHORIZED_MEDIA_HOSTS", "")
)
AUTHORIZED_PAGE_HOSTS = parse_host_allowlist(
    os.environ.get("AUTHORIZED_PAGE_HOSTS", "")
)
COPYRIGHT_CONTACT_EMAIL = os.environ.get("COPYRIGHT_CONTACT_EMAIL", "").strip()[:254]
COPYRIGHT_CONTACT_CONFIGURED = bool(
    re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", COPYRIGHT_CONTACT_EMAIL)
)
SERVICE_OPERATOR_NAME = os.environ.get("SERVICE_OPERATOR_NAME", "").strip()[:100]
SERVICE_OPERATOR_CONFIGURED = bool(SERVICE_OPERATOR_NAME)
PUBLIC_LAUNCH_READY = (
    COPYRIGHT_CONTACT_CONFIGURED and SERVICE_OPERATOR_CONFIGURED
)
LEGAL_NOTICE_VERSION = "2026-07-28"
FAKE_IP_NETWORKS = (
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("fdfe:dcba:9876::/64"),
)
PARSE_FAST_TIMEOUT_SECONDS = max(
    3.0,
    min(12.0, float(os.environ.get("PARSE_FAST_TIMEOUT_SECONDS", "7"))),
)
PARSE_BROWSER_TIMEOUT_SECONDS = max(
    5.0,
    min(15.0, float(os.environ.get("PARSE_BROWSER_TIMEOUT_SECONDS", "8"))),
)
PARSE_MAX_WORKERS = max(
    2,
    min(8, int(os.environ.get("PARSE_MAX_WORKERS", "4"))),
)
ENABLE_BROWSER_PARSER = False
DEFAULT_ICE_SERVERS = [{"urls": "stun:stun.cloudflare.com:3478"}]
ENABLE_HLS_TRANSCODE = False
FFMPEG_BIN = os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg")
FFPROBE_BIN = os.environ.get("FFPROBE_BIN") or shutil.which("ffprobe")
HLS_SEGMENT_SECONDS = max(2, min(10, int(os.environ.get("HLS_SEGMENT_SECONDS", "4"))))
HLS_MAX_CONCURRENT_JOBS = max(
    1,
    min(4, int(os.environ.get("HLS_MAX_CONCURRENT_JOBS", "1"))),
)
HLS_MAX_QUEUED_JOBS = max(
    HLS_MAX_CONCURRENT_JOBS,
    min(20, int(os.environ.get("HLS_MAX_QUEUED_JOBS", "4"))),
)
HLS_TRANSCODE_TIMEOUT_SECONDS = max(
    300,
    int(os.environ.get("HLS_TRANSCODE_TIMEOUT_SECONDS", str(4 * 60 * 60))),
)
HLS_MAX_ESTIMATED_OUTPUT_BYTES = max(
    256 * 1024 * 1024,
    int(os.environ.get("HLS_MAX_ESTIMATED_OUTPUT_BYTES", str(4 * 1024**3))),
)
TRANSCODE_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
HLS_LADDER = (
    {"height": 360, "video_kbps": 800, "audio_kbps": 96},
    {"height": 480, "video_kbps": 1400, "audio_kbps": 96},
    {"height": 720, "video_kbps": 2800, "audio_kbps": 128},
    {"height": 1080, "video_kbps": 5000, "audio_kbps": 160},
)

KNOWN_VIDEO_PROVIDERS = (
    {
        "key": "bilibili",
        "name": "哔哩哔哩",
        "domains": ("bilibili.com", "b23.tv"),
        "id_pattern": re.compile(r"\b(BV[0-9A-Za-z]{10})\b", re.IGNORECASE),
    },
    {
        "key": "tencent-video",
        "name": "腾讯视频",
        "domains": ("v.qq.com",),
    },
    {
        "key": "iqiyi",
        "name": "爱奇艺",
        "domains": ("iqiyi.com",),
    },
    {
        "key": "youku",
        "name": "优酷",
        "domains": ("youku.com",),
    },
    {
        "key": "mgtv",
        "name": "芒果 TV",
        "domains": ("mgtv.com",),
    },
    {
        "key": "douyin",
        "name": "抖音",
        "domains": ("douyin.com", "iesdouyin.com"),
    },
    {
        "key": "kuaishou",
        "name": "快手",
        "domains": ("kuaishou.com",),
    },
    {
        "key": "acfun",
        "name": "AcFun",
        "domains": ("acfun.cn",),
    },
    {
        "key": "youtube",
        "name": "YouTube",
        "domains": ("youtube.com", "youtu.be"),
        "id_pattern": re.compile(
            r"(?:youtu\.be/|youtube\.com/(?:watch\?.*?v=|shorts/|embed/))"
            r"([0-9A-Za-z_-]{11})",
            re.IGNORECASE,
        ),
    },
)


def load_ice_servers():
    raw_value = os.environ.get("WEBRTC_ICE_SERVERS")
    if not raw_value:
        return DEFAULT_ICE_SERVERS
    try:
        candidates = json.loads(raw_value)
    except json.JSONDecodeError:
        return DEFAULT_ICE_SERVERS
    if not isinstance(candidates, list):
        return DEFAULT_ICE_SERVERS

    normalized = []
    for candidate in candidates[:8]:
        if not isinstance(candidate, dict):
            continue
        urls = candidate.get("urls")
        url_list = [urls] if isinstance(urls, str) else urls
        if not isinstance(url_list, list):
            continue
        valid_urls = [
            value
            for value in url_list[:12]
            if isinstance(value, str)
            and value.startswith(("stun:", "stuns:", "turn:", "turns:"))
            and len(value) <= 500
        ]
        if not valid_urls:
            continue
        item = {"urls": valid_urls[0] if isinstance(urls, str) else valid_urls}
        for key in ("username", "credential"):
            value = candidate.get(key)
            if isinstance(value, str) and len(value) <= 1000:
                item[key] = value
        normalized.append(item)
    return normalized or DEFAULT_ICE_SERVERS


ICE_SERVERS = load_ice_servers()
TURN_CONFIGURED = any(
    isinstance(url, str) and url.startswith(("turn:", "turns:"))
    for server in ICE_SERVERS
    for url in (
        [server.get("urls")]
        if isinstance(server.get("urls"), str)
        else server.get("urls", [])
    )
)


app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY") or secrets.token_hex(32),
    UPLOAD_FOLDER=str(UPLOAD_DIR),
    MAX_CONTENT_LENGTH=MAX_UPLOAD_BYTES,
    JSON_AS_ASCII=False,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=APP_ENV == "production",
    PREFERRED_URL_SCHEME="https" if APP_ENV == "production" else "http",
)
if TRUST_PROXY_HOPS:
    app.wsgi_app = ProxyFix(
        app.wsgi_app,
        x_for=TRUST_PROXY_HOPS,
        x_proto=TRUST_PROXY_HOPS,
        x_host=TRUST_PROXY_HOPS,
    )

socket_options = {
    "async_mode": os.environ.get("SOCKETIO_ASYNC_MODE", "threading"),
    "max_http_buffer_size": 1_000_000,
}
allowed_origins = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]


def socket_origin_allowed(origin, environ=None):
    """Allow the room page plus unpacked/published Chromium extensions."""
    if not origin:
        return True
    if "*" in allowed_origins:
        return True

    parsed = urlparse(origin)
    if (
        parsed.scheme == "chrome-extension"
        and parsed.hostname
        and re.fullmatch(r"[a-p]{32}", parsed.hostname)
    ):
        return True

    normalized_origin = origin.rstrip("/")
    if normalized_origin in {value.rstrip("/") for value in allowed_origins}:
        return True

    if environ:
        scheme = environ.get("HTTP_X_FORWARDED_PROTO") or environ.get(
            "wsgi.url_scheme",
            "http",
        )
        scheme = scheme.split(",", 1)[0].strip()
        host = environ.get("HTTP_X_FORWARDED_HOST") or environ.get("HTTP_HOST")
        if host:
            host = host.split(",", 1)[0].strip()
            return normalized_origin == f"{scheme}://{host}".rstrip("/")
    return False


socket_options["cors_allowed_origins"] = socket_origin_allowed
message_queue = os.environ.get("SOCKETIO_MESSAGE_QUEUE")
if message_queue:
    socket_options["message_queue"] = message_queue

socketio = SocketIO(app, **socket_options)


class UnsafeURLError(ValueError):
    """Raised when a URL could access a non-public network resource."""

    def __init__(self, message, *, code="blocked_address", status_code=400):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


DIAGNOSTIC_CATALOG = {
    "invalid_url": {
        "stage": "链接检查",
        "reason": "输入内容不是完整的公网 HTTP(S) 地址。",
        "suggestion": "请粘贴以 http:// 或 https:// 开头的完整链接。",
    },
    "proxy_fake_ip": {
        "stage": "DNS 与代理检查",
        "reason": (
            "域名被本机代理解析成了 Fake-IP，解析器还没有访问视频网站；"
            "因此这不是网站加密或 DRM 导致的。"
        ),
        "suggestion": (
            "把 Clash/Mihomo 的 DNS 增强模式改为 Redir-Host，刷新 DNS 后重试。"
        ),
    },
    "blocked_address": {
        "stage": "地址安全检查",
        "reason": "链接指向本机、局域网或保留地址，已被安全策略阻止。",
        "suggestion": "请使用可从公网访问的视频或网页地址。",
    },
    "page_host_not_authorized": {
        "stage": "来源合规检查",
        "reason": "该网页不在本站允许同步的官方平台或管理员授权域名中。",
        "suggestion": "请使用受支持的官方视频页面；自有网页需由管理员先登记域名。",
    },
    "media_host_not_authorized": {
        "stage": "来源合规检查",
        "reason": "任意 MP4/M3U8 直链默认不接受，该媒体域名尚未登记为自有或已授权来源。",
        "suggestion": "请改用官方视频页面；自有或已获授权的媒体请联系管理员登记域名。",
    },
    "media_requires_https": {
        "stage": "传输安全检查",
        "reason": "已授权媒体只能通过 HTTPS 播放，避免链接和访问凭据在传输中泄露。",
        "suggestion": "请为媒体域名启用 HTTPS 后再使用。",
    },
    "compliance_setup_required": {
        "stage": "上线合规检查",
        "reason": "生产环境尚未配置真实运营者名称和可用的版权投诉邮箱。",
        "suggestion": (
            "管理员需设置 SERVICE_OPERATOR_NAME 和 COPYRIGHT_CONTACT_EMAIL，"
            "重新部署并确认 /health 中 public_launch_ready 为 true。"
        ),
    },
    "dns_failed": {
        "stage": "DNS 检查",
        "reason": "服务器无法把域名解析成 IP 地址，尚未访问视频网站。",
        "suggestion": "检查域名拼写、DNS 和代理状态后再试。",
    },
    "drm_protected": {
        "stage": "媒体提取",
        "reason": "源网站明确报告了 DRM 受保护内容，不是本站解析器故障。",
        "suggestion": "本站不会绕过 DRM；请改用你有权分享的无 DRM 文件并上传。",
    },
    "auth_required": {
        "stage": "源网站鉴权",
        "reason": "源网站要求登录、会员权限或浏览器 Cookie，匿名解析拿不到视频。",
        "suggestion": "先确认该视频无需登录即可公开播放，或改用本地文件上传。",
    },
    "geo_blocked": {
        "stage": "源网站访问",
        "reason": "源网站限制了当前服务器所在地区或网络出口。",
        "suggestion": "换用源网站允许的网络环境，或上传本地视频。",
    },
    "access_blocked": {
        "stage": "源网站访问",
        "reason": "源网站拒绝了服务器请求，常见于 403、防盗链、验证码或反爬校验。",
        "suggestion": "这不等于 DRM；可先关闭“代理中转”测试，或改用本地文件上传。",
    },
    "source_rate_limited": {
        "stage": "源网站访问",
        "reason": "源网站对当前服务器请求进行了限流。",
        "suggestion": "稍等几分钟再试，不要连续重复解析。",
    },
    "source_not_found": {
        "stage": "源网站访问",
        "reason": "源地址不存在、已删除，或临时签名链接已经过期。",
        "suggestion": "回到原网页重新复制最新链接。",
    },
    "network_error": {
        "stage": "网络连接",
        "reason": "服务器连接源网站超时或中断，尚不能判断视频是否加密。",
        "suggestion": "检查服务器代理与网络后重试。",
    },
    "parser_component_unavailable": {
        "stage": "解析器检查",
        "reason": "动态网页解析组件不可用，但其他解析方式仍会继续尝试。",
        "suggestion": "若公开网页反复失败，请检查 Chrome/Chromedriver 与解析器安装。",
    },
    "parser_timeout": {
        "stage": "解析超时",
        "reason": "解析器已达到本次时间预算并主动结束，源站响应慢或动态脚本卡住均有可能。",
        "suggestion": "稍后重试一次；若原网页能秒开，请展开解析过程检查是哪种解析器超时。",
    },
    "parser_no_media": {
        "stage": "媒体提取",
        "reason": (
            "源网页可以访问，但没有发现公开的 MP4/HLS 地址。"
            "未检测到明确 DRM；可能是动态签名、需要 Cookie，或本站暂不支持该网站。"
        ),
        "suggestion": (
            "用无痕窗口确认视频无需登录即可播放；若能公开播放，"
            "说明更可能需要适配本站解析器。"
        ),
    },
    "direct_not_media": {
        "stage": "媒体直链检查",
        "reason": "该地址返回的是网页而不是视频文件或 HLS 播放列表。",
        "suggestion": "请粘贴原视频网页让本站解析，或复制真正的 MP4/M3U8 直链。",
    },
    "media_ready": {
        "stage": "媒体直链检查",
        "reason": "服务器能够访问该媒体地址，接下来由浏览器检查编码兼容性。",
        "suggestion": "若播放器仍报错，重点检查视频编码、跨域或临时签名是否过期。",
    },
    "direct_media_ready": {
        "stage": "来源识别",
        "reason": "这是管理员登记的自有或已授权媒体，将由每位成员的浏览器直接访问。",
        "suggestion": "本站不会代理或缓存视频；域名授权失效时，管理员应立即从白名单移除。",
    },
    "official_page_ready": {
        "stage": "官方页面",
        "reason": "已识别视频网页，视频仍由原网站播放，本站只同步播放状态。",
        "suggestion": "请打开官方页面，并使用观影伴侣扩展加入同一房间。",
    },
}


def diagnostic_payload(code, *, error=None, attempts=None, extra=None):
    template = DIAGNOSTIC_CATALOG.get(code, DIAGNOSTIC_CATALOG["parser_no_media"])
    payload = {
        "error": error or template["reason"],
        "code": code,
        "stage": template["stage"],
        "reason": template["reason"],
        "suggestion": template["suggestion"],
    }
    if attempts:
        payload["attempts"] = attempts
    if extra:
        payload.update(extra)
    return payload


def unsafe_url_response(error):
    return jsonify(
        diagnostic_payload(
            getattr(error, "code", "blocked_address"),
            error=str(error),
            extra={"ok": False},
        )
    ), getattr(error, "status_code", 400)


def classify_parser_error(error):
    if isinstance(error, UnsafeURLError):
        return error.code

    text = str(error).lower()
    patterns = (
        ("drm_protected", ("drm", "digital rights management")),
        (
            "auth_required",
            (
                "login required",
                "sign in",
                "log in",
                "cookies",
                "account required",
                "members-only",
                "premium",
                "subscription",
                "private video",
            ),
        ),
        (
            "geo_blocked",
            (
                "not available in your country",
                "geo-restricted",
                "georestricted",
                "geographic restriction",
            ),
        ),
        (
            "access_blocked",
            (
                "http error 401",
                "http error 403",
                "forbidden",
                "captcha",
                "challenge",
                "anti-bot",
                "bot detection",
            ),
        ),
        (
            "source_rate_limited",
            ("http error 429", "too many requests", "rate limit"),
        ),
        (
            "source_not_found",
            ("http error 404", "not found", "video unavailable", "removed"),
        ),
        (
            "network_error",
            (
                "timed out",
                "timeout",
                "temporary failure in name resolution",
                "name or service not known",
                "connection reset",
                "connection refused",
                "network is unreachable",
            ),
        ),
        (
            "parser_component_unavailable",
            (
                "unable to obtain driver",
                "chromedriver",
                "chrome binary",
                "no module named 'selenium'",
            ),
        ),
    )
    for code, needles in patterns:
        if any(needle in text for needle in needles):
            return code
    return "parser_no_media"


def parser_attempt(name, error=None, *, code=None, status="failed"):
    resolved_code = code or classify_parser_error(error)
    template = DIAGNOSTIC_CATALOG.get(
        resolved_code,
        DIAGNOSTIC_CATALOG["parser_no_media"],
    )
    return {
        "name": name,
        "status": status,
        "code": resolved_code,
        "summary": template["reason"],
    }


def select_parse_diagnosis(attempts, *, source_reachable=False):
    codes = {attempt["code"] for attempt in attempts}
    priority = (
        "proxy_fake_ip",
        "drm_protected",
        "auth_required",
        "geo_blocked",
        "access_blocked",
        "source_rate_limited",
        "source_not_found",
        "network_error",
        "parser_timeout",
    )
    for code in priority:
        if code in codes:
            return code
    if source_reachable:
        return "parser_no_media"
    if codes == {"parser_component_unavailable"}:
        return "parser_component_unavailable"
    return "parser_no_media"


rate_buckets = defaultdict(deque)
rate_lock = threading.Lock()


def rate_limit(scope, limit, window_seconds):
    """Small single-process limiter; replace with Redis when scaling out."""

    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            client = request.remote_addr or "unknown"
            key = f"{scope}:{client}"
            now = time.monotonic()
            with rate_lock:
                bucket = rate_buckets[key]
                while bucket and now - bucket[0] > window_seconds:
                    bucket.popleft()
                if len(bucket) >= limit:
                    return jsonify({"error": "请求过于频繁，请稍后再试"}), 429
                bucket.append(now)
            return view(*args, **kwargs)

        return wrapped

    return decorator


def validate_public_url(value):
    if not isinstance(value, str) or len(value) > 4096:
        raise UnsafeURLError("链接格式无效", code="invalid_url")

    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise UnsafeURLError("仅支持 http 或 https 链接", code="invalid_url")
    if parsed.username or parsed.password:
        raise UnsafeURLError("链接中不能包含账号密码", code="invalid_url")

    hostname = parsed.hostname.rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith(".local"):
        raise UnsafeURLError(
            "不允许访问本机或局域网地址",
            code="blocked_address",
        )

    try:
        addresses = {
            result[4][0]
            for result in socket.getaddrinfo(
                hostname,
                parsed.port or (443 if parsed.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        }
    except (socket.gaierror, OSError) as exc:
        raise UnsafeURLError("无法解析目标地址", code="dns_failed") from exc

    if not addresses:
        raise UnsafeURLError("无法解析目标地址", code="dns_failed")

    for address in addresses:
        try:
            ip = ipaddress.ip_address(address.split("%", 1)[0])
        except ValueError as exc:
            raise UnsafeURLError("目标地址无效", code="invalid_url") from exc
        if any(ip in network for network in FAKE_IP_NETWORKS):
            raise UnsafeURLError(
                "代理 DNS 返回 Fake-IP，解析器尚未访问源网站",
                code="proxy_fake_ip",
            )
        if not ip.is_global:
            raise UnsafeURLError(
                "不允许访问本机、局域网或保留地址",
                code="blocked_address",
            )

    return parsed.geturl()


def safe_request(method, target_url, *, max_redirects=4, **kwargs):
    current_url = validate_public_url(target_url)
    for _ in range(max_redirects + 1):
        response = requests.request(
            method,
            current_url,
            allow_redirects=False,
            **kwargs,
        )
        if response.status_code not in REDIRECT_STATUSES:
            return response

        location = response.headers.get("Location")
        response.close()
        if not location:
            raise requests.RequestException("上游返回了无效重定向")
        current_url = validate_public_url(urljoin(current_url, location))

    raise requests.TooManyRedirects("上游重定向次数过多")


def read_limited_response(response, limit):
    content_length = response.headers.get("Content-Length")
    if content_length and int(content_length) > limit:
        raise ValueError("上游内容过大")

    chunks = []
    total = 0
    for chunk in response.iter_content(chunk_size=64 * 1024):
        total += len(chunk)
        if total > limit:
            raise ValueError("上游内容过大")
        chunks.append(chunk)
    return b"".join(chunks)


def clean_text(value, max_length):
    if not isinstance(value, str):
        return ""
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value).strip()
    return value[:max_length]


def valid_room_id(value):
    return bool(isinstance(value, str) and ROOM_ID_PATTERN.fullmatch(value))


def validate_client_media_url(value):
    """Validate a URL that is handed back to the browser without fetching it."""
    if not isinstance(value, str) or len(value) > 4096:
        raise UnsafeURLError("链接格式无效", code="invalid_url")

    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise UnsafeURLError("仅支持 http 或 https 链接", code="invalid_url")
    if parsed.username or parsed.password:
        raise UnsafeURLError("链接中不能包含账号密码", code="invalid_url")

    hostname = parsed.hostname.rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith(".local"):
        raise UnsafeURLError("不允许使用本机或局域网地址", code="blocked_address")
    try:
        literal_ip = ipaddress.ip_address(hostname.split("%", 1)[0])
    except ValueError:
        literal_ip = None
    if literal_ip and (
        not literal_ip.is_global
        or any(literal_ip in network for network in FAKE_IP_NETWORKS)
    ):
        raise UnsafeURLError("不允许使用本机、局域网或保留地址", code="blocked_address")
    return parsed.geturl()


def hostname_matches(hostname, domain):
    return hostname == domain or hostname.endswith(f".{domain}")


def hostname_allowed(hostname, rules):
    try:
        normalized = hostname.rstrip(".").lower().encode("idna").decode("ascii")
    except (AttributeError, UnicodeError):
        return False
    for rule in rules:
        if rule.startswith("*."):
            if normalized.endswith(f".{rule[2:]}"):
                return True
        elif normalized == rule:
            return True
    return False


def identify_video_provider(target_url):
    parsed = urlparse(target_url)
    hostname = (parsed.hostname or "").rstrip(".").lower()
    for provider in KNOWN_VIDEO_PROVIDERS:
        if not any(hostname_matches(hostname, domain) for domain in provider["domains"]):
            continue
        media_id = None
        pattern = provider.get("id_pattern")
        if pattern:
            match = pattern.search(target_url)
            if match:
                media_id = match.group(1)
                if provider["key"] == "bilibili":
                    media_id = f"BV{media_id[2:]}"
        return provider, media_id
    return None, None


def is_direct_media_url(target_url):
    suffix = Path(urlparse(target_url).path).suffix.lower()
    return suffix in DIRECT_MEDIA_EXTENSIONS


def resolve_media_source(raw_url):
    if APP_ENV == "production" and not PUBLIC_LAUNCH_READY:
        raise UnsafeURLError(
            "生产环境的运营者与投诉渠道尚未配置完成",
            code="compliance_setup_required",
            status_code=503,
        )
    target_url = validate_client_media_url(raw_url)
    parsed = urlparse(target_url)
    hostname = (parsed.hostname or "").rstrip(".").lower()

    if is_direct_media_url(target_url):
        if parsed.scheme != "https":
            raise UnsafeURLError(
                "已授权媒体只允许使用 HTTPS 链接",
                code="media_requires_https",
                status_code=400,
            )
        if not hostname_allowed(hostname, AUTHORIZED_MEDIA_HOSTS):
            raise UnsafeURLError(
                "该媒体域名未登记为自有或已授权来源",
                code="media_host_not_authorized",
                status_code=403,
            )
        return {
            "mode": "direct_media",
            "provider_key": "direct",
            "provider_name": "已授权媒体",
            "media_id": None,
            "title": Path(parsed.path).name or "已授权视频",
            "page_url": target_url,
            "media_url": target_url,
            "requires_companion": False,
            "capabilities": {
                "play": True,
                "pause": True,
                "seek": True,
                "speed": True,
            },
        }

    provider, media_id = identify_video_provider(target_url)
    if not provider and not hostname_allowed(hostname, AUTHORIZED_PAGE_HOSTS):
        raise UnsafeURLError(
            "该网页不是受支持的官方视频页面，也未被管理员登记",
            code="page_host_not_authorized",
            status_code=403,
        )
    provider_key = provider["key"] if provider else "authorized-website"
    provider_name = provider["name"] if provider else f"已授权网页（{hostname}）"
    return {
        "mode": "official_page",
        "provider_key": provider_key,
        "provider_name": provider_name,
        "media_id": media_id,
        "title": f"{provider_name}官方视频页面",
        "page_url": target_url,
        "media_url": None,
        "requires_companion": True,
        "capabilities": {
            "play": True,
            "pause": True,
            "seek": True,
            "speed": True,
        },
    }


def sanitize_media_source(value):
    if not isinstance(value, dict):
        return None
    mode = clean_text(value.get("mode"), 32)
    if mode not in MEDIA_SOURCE_MODES:
        return None
    if mode == "direct_media":
        candidate = value.get("media_url") or value.get("page_url")
    else:
        candidate = value.get("page_url")
    try:
        canonical_source = resolve_media_source(candidate)
    except UnsafeURLError:
        return None
    if canonical_source["mode"] != mode:
        return None
    return canonical_source


def sanitize_video_source(value):
    if not isinstance(value, str) or not (1 <= len(value) <= 4096):
        return None
    value = value.strip()
    if value.startswith(("/static/uploads/", "/proxy?", "/hls_proxy?")):
        return value
    parsed = urlparse(value)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return value
    return None


last_upload_cleanup = 0.0
upload_cleanup_lock = threading.Lock()
transcode_jobs = {}
transcode_lock = threading.RLock()
transcode_executor = ThreadPoolExecutor(
    max_workers=HLS_MAX_CONCURRENT_JOBS,
    thread_name_prefix="hls-transcode",
)
parse_executor = ThreadPoolExecutor(
    max_workers=PARSE_MAX_WORKERS,
    thread_name_prefix="video-parse",
)


def hls_root():
    return UPLOAD_DIR / "hls"


def transcode_available():
    return bool(
        ENABLE_HLS_TRANSCODE
        and FFMPEG_BIN
        and FFPROBE_BIN
        and not app.config.get("TESTING")
    )


def public_transcode_job(job):
    return {
        key: job.get(key)
        for key in (
            "id",
            "status",
            "progress",
            "stage",
            "message",
            "status_url",
            "hls_url",
            "source_url",
            "qualities",
        )
    }


def update_transcode_job(job_id, **changes):
    with transcode_lock:
        job = transcode_jobs.get(job_id)
        if not job:
            return
        job.update(changes, updated_at=time.time())


def probe_video(source_path):
    result = subprocess.run(
        [
            str(FFPROBE_BIN),
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
            str(source_path),
        ],
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    payload = json.loads(result.stdout)
    streams = payload.get("streams") or []
    if not streams:
        raise ValueError("视频中没有可用画面")
    width = int(streams[0].get("width") or 0)
    height = int(streams[0].get("height") or 0)
    duration = float((payload.get("format") or {}).get("duration") or 0)
    if width < 2 or height < 2 or not math.isfinite(duration) or duration <= 0:
        raise ValueError("无法读取视频尺寸或时长")
    return {"width": width, "height": height, "duration": duration}


def select_hls_variants(width, height):
    variants = [dict(item) for item in HLS_LADDER if item["height"] <= height]
    max_output_height = max(
        2,
        (min(height, HLS_LADDER[-1]["height"]) // 2) * 2,
    )
    if not variants or variants[-1]["height"] != max_output_height:
        reference = next(
            (
                item
                for item in HLS_LADDER
                if item["height"] >= max_output_height
            ),
            HLS_LADDER[-1],
        )
        variants.append(
            {
                "height": max_output_height,
                "video_kbps": reference["video_kbps"],
                "audio_kbps": reference["audio_kbps"],
            }
        )

    aspect_ratio = width / height
    normalized = []
    for item in variants:
        output_width = max(2, int(round(item["height"] * aspect_ratio / 2) * 2))
        normalized.append(
            {
                **item,
                "width": output_width,
                "label": f'{item["height"]}p',
            }
        )
    return normalized


def write_master_playlist(output_dir, variants):
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-INDEPENDENT-SEGMENTS",
    ]
    for variant in variants:
        bandwidth = int(
            (variant["video_kbps"] + variant["audio_kbps"]) * 1000 * 1.15
        )
        average_bandwidth = int(
            (variant["video_kbps"] + variant["audio_kbps"]) * 1000
        )
        lines.extend(
            [
                (
                    "#EXT-X-STREAM-INF:"
                    f"BANDWIDTH={bandwidth},"
                    f"AVERAGE-BANDWIDTH={average_bandwidth},"
                    f'RESOLUTION={variant["width"]}x{variant["height"]}'
                ),
                f'{variant["label"]}.m3u8',
            ]
        )
    (output_dir / "master.m3u8").write_text(
        "\n".join(lines) + "\n",
        encoding="utf-8",
    )


def run_ffmpeg_variant(job_id, source_path, output_dir, variant, index, total, duration):
    label = variant["label"]
    segment_pattern = output_dir / f"{label}_%05d.ts"
    playlist_path = output_dir / f"{label}.m3u8"
    command = [
        str(FFMPEG_BIN),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source_path),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        (
            f'scale={variant["width"]}:{variant["height"]}:'
            "force_original_aspect_ratio=decrease"
        ),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-profile:v",
        "main",
        "-pix_fmt",
        "yuv420p",
        "-b:v",
        f'{variant["video_kbps"]}k',
        "-maxrate",
        f'{int(variant["video_kbps"] * 1.07)}k',
        "-bufsize",
        f'{int(variant["video_kbps"] * 1.5)}k',
        "-sc_threshold",
        "0",
        "-force_key_frames",
        f"expr:gte(t,n_forced*{HLS_SEGMENT_SECONDS})",
        "-c:a",
        "aac",
        "-b:a",
        f'{variant["audio_kbps"]}k',
        "-ac",
        "2",
        "-ar",
        "48000",
        "-f",
        "hls",
        "-hls_time",
        str(HLS_SEGMENT_SECONDS),
        "-hls_playlist_type",
        "vod",
        "-hls_flags",
        "independent_segments+temp_file",
        "-hls_segment_filename",
        str(segment_pattern),
        "-progress",
        "pipe:1",
        "-nostats",
        str(playlist_path),
    ]
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    started_at = time.monotonic()
    last_output = deque(maxlen=12)
    try:
        for raw_line in iter(process.stdout.readline, ""):
            line = raw_line.strip()
            if line:
                last_output.append(line)
            if time.monotonic() - started_at > HLS_TRANSCODE_TIMEOUT_SECONDS:
                process.kill()
                raise TimeoutError("视频转码超时")
            if line.startswith(("out_time_us=", "out_time_ms=")):
                try:
                    rendered_seconds = int(line.split("=", 1)[1]) / 1_000_000
                except (TypeError, ValueError):
                    continue
                variant_progress = min(0.99, rendered_seconds / duration)
                overall = int(((index + variant_progress) / total) * 100)
                update_transcode_job(
                    job_id,
                    progress=min(99, overall),
                    stage=f"正在生成 {label}",
                )
        return_code = process.wait()
    finally:
        if process.stdout:
            process.stdout.close()
    if return_code != 0:
        app.logger.warning(
            "FFmpeg failed for %s/%s: %s",
            job_id,
            label,
            " | ".join(last_output),
        )
        raise RuntimeError(f"{label} 转码失败")


def transcode_upload(job_id, source_path):
    output_dir = hls_root() / job_id
    try:
        output_dir.mkdir(parents=True, exist_ok=False)
        update_transcode_job(
            job_id,
            status="processing",
            progress=1,
            stage="正在分析视频",
            message="正在准备自适应清晰度",
        )
        metadata = probe_video(source_path)
        variants = select_hls_variants(metadata["width"], metadata["height"])
        estimated_output_bytes = (
            metadata["duration"]
            * sum(
                variant["video_kbps"] + variant["audio_kbps"]
                for variant in variants
            )
            * 1000
            / 8
            * 1.2
        )
        if estimated_output_bytes > HLS_MAX_ESTIMATED_OUTPUT_BYTES:
            max_gb = HLS_MAX_ESTIMATED_OUTPUT_BYTES / 1024**3
            raise ValueError(f"预计转码文件超过 {max_gb:.1f} GB 上限")
        qualities = [variant["label"] for variant in variants]
        update_transcode_job(job_id, qualities=qualities)

        for index, variant in enumerate(variants):
            run_ffmpeg_variant(
                job_id,
                source_path,
                output_dir,
                variant,
                index,
                len(variants),
                metadata["duration"],
            )

        write_master_playlist(output_dir, variants)
        update_transcode_job(
            job_id,
            status="ready",
            progress=100,
            stage="自适应清晰度已就绪",
            message="已根据每位成员的网络自动选择清晰度",
            hls_url=f"/static/uploads/hls/{job_id}/master.m3u8",
        )
    except Exception as exc:
        app.logger.exception("Unable to transcode upload %s", job_id)
        if output_dir.exists():
            shutil.rmtree(output_dir, ignore_errors=True)
        update_transcode_job(
            job_id,
            status="failed",
            stage="自适应转码失败",
            message=f"{clean_text(str(exc), 120) or '转码失败'}，继续播放原文件",
        )


def queue_transcode(source_path, source_url, filename):
    if not transcode_available():
        return {
            "status": "unavailable",
            "message": "服务器未启用 FFmpeg，继续播放原文件",
        }

    with transcode_lock:
        active_jobs = sum(
            job.get("status") in {"queued", "processing"}
            for job in transcode_jobs.values()
        )
        if active_jobs >= HLS_MAX_QUEUED_JOBS:
            return {
                "status": "busy",
                "message": "转码队列繁忙，当前先播放原文件",
            }

        job_id = source_path.stem
        job = {
            "id": job_id,
            "status": "queued",
            "progress": 0,
            "stage": "等待转码",
            "message": "上传完成，正在排队生成多档清晰度",
            "status_url": f"/transcode/{job_id}",
            "hls_url": None,
            "source_url": source_url,
            "filename": filename,
            "qualities": [],
            "created_at": time.time(),
            "updated_at": time.time(),
        }
        transcode_jobs[job_id] = job

    transcode_executor.submit(transcode_upload, job_id, source_path)
    return public_transcode_job(job)


def cleanup_expired_uploads():
    global last_upload_cleanup
    if UPLOAD_TTL_SECONDS <= 0:
        return

    now = time.time()
    with upload_cleanup_lock:
        if now - last_upload_cleanup < 10 * 60:
            return
        last_upload_cleanup = now

        for path in UPLOAD_DIR.iterdir():
            try:
                if path.is_file() and now - path.stat().st_mtime > UPLOAD_TTL_SECONDS:
                    path.unlink()
            except OSError:
                app.logger.warning("Unable to clean expired upload: %s", path)

        output_root = hls_root()
        if output_root.exists():
            for output_dir in output_root.iterdir():
                if (
                    output_dir.is_dir()
                    and TRANSCODE_ID_PATTERN.fullmatch(output_dir.name)
                ):
                    try:
                        if now - output_dir.stat().st_mtime > UPLOAD_TTL_SECONDS:
                            shutil.rmtree(output_dir)
                            with transcode_lock:
                                transcode_jobs.pop(output_dir.name, None)
                    except OSError:
                        app.logger.warning(
                            "Unable to clean expired HLS output: %s",
                            output_dir,
                        )


@app.after_request
def add_security_headers(response):
    authorized_media_sources = " ".join(
        f"https://{rule}" for rule in AUTHORIZED_MEDIA_HOSTS
    )
    media_src = f"media-src 'self' blob: {authorized_media_sources};"
    connect_src = f"connect-src 'self' ws: wss: {authorized_media_sources};"
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(self), geolocation=(), payment=()",
    )
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        f"{media_src} "
        f"{connect_src} "
        "worker-src 'self' blob:; "
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    )
    if request.is_secure:
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=31536000; includeSubDomains",
        )
    return response


@app.errorhandler(413)
def upload_too_large(_error):
    max_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
    return jsonify({"error": f"文件过大，单个视频不能超过 {max_mb} MB"}), 413


@app.route("/")
def index():
    return render_template(
        "index.html",
        legal_notice_version=LEGAL_NOTICE_VERSION,
        show_deployment_warning=(
            APP_ENV == "production" and not PUBLIC_LAUNCH_READY
        ),
    )


@app.route("/terms")
def terms():
    return render_template(
        "terms.html",
        legal_notice_version=LEGAL_NOTICE_VERSION,
        copyright_contact_email=(
            COPYRIGHT_CONTACT_EMAIL if COPYRIGHT_CONTACT_CONFIGURED else None
        ),
        service_operator_name=SERVICE_OPERATOR_NAME or None,
    )


@app.route("/privacy")
def privacy():
    return render_template(
        "privacy.html",
        legal_notice_version=LEGAL_NOTICE_VERSION,
        copyright_contact_email=(
            COPYRIGHT_CONTACT_EMAIL if COPYRIGHT_CONTACT_CONFIGURED else None
        ),
        service_operator_name=SERVICE_OPERATOR_NAME or None,
        room_retention_hours=max(1, math.ceil(ROOM_TTL_SECONDS / 3600)),
    )


@app.route("/copyright")
def copyright_notice():
    return render_template(
        "copyright.html",
        legal_notice_version=LEGAL_NOTICE_VERSION,
        copyright_contact_email=(
            COPYRIGHT_CONTACT_EMAIL if COPYRIGHT_CONTACT_CONFIGURED else None
        ),
        service_operator_name=SERVICE_OPERATOR_NAME or None,
    )


@app.route("/room/<room_id>")
def room(room_id):
    if not valid_room_id(room_id):
        return render_template(
            "error.html",
            title="房间号无效",
            message="房间号需为 4–64 位，只能包含文字、数字、下划线或短横线。",
        ), 404
    return render_template(
        "room.html",
        room_id=room_id,
        authorized_media_enabled=bool(AUTHORIZED_MEDIA_HOSTS),
        legal_notice_version=LEGAL_NOTICE_VERSION,
        show_deployment_warning=(
            APP_ENV == "production" and not PUBLIC_LAUNCH_READY
        ),
    )


@app.route("/health")
def health():
    with room_lock:
        active_rooms = sum(
            bool(members)
            for members in room_members.values()
        )
        connected_clients = len(sid_membership)
    return jsonify(
        {
            "status": "ok",
            "version": APP_VERSION,
            "uptime_seconds": round(max(0, time.time() - APP_STARTED_AT), 1),
            "active_rooms": active_rooms,
            "connected_clients": connected_clients,
            "compliance_mode": True,
            "legacy_media_pipeline": ENABLE_LEGACY_MEDIA_PIPELINE,
            "authorized_media_enabled": bool(AUTHORIZED_MEDIA_HOSTS),
            "authorized_page_hosts": len(AUTHORIZED_PAGE_HOSTS),
            "copyright_contact_configured": COPYRIGHT_CONTACT_CONFIGURED,
            "service_operator_configured": SERVICE_OPERATOR_CONFIGURED,
            "public_launch_ready": PUBLIC_LAUNCH_READY,
            "turn_configured": TURN_CONFIGURED,
            "companion_archive": COMPANION_EXTENSION_ARCHIVE.is_file(),
        }
    )


@app.route("/companion-extension.zip")
def download_companion_extension():
    if not COMPANION_EXTENSION_ARCHIVE.is_file():
        return jsonify({"error": "观影伴侣安装包尚未生成"}), 404
    return send_file(
        COMPANION_EXTENSION_ARCHIVE,
        as_attachment=True,
        download_name="together-watch-companion.zip",
        mimetype="application/zip",
        conditional=True,
        max_age=0,
    )


def legacy_media_pipeline_disabled(feature):
    return jsonify(
        {
            "error": f"{feature}已停用",
            "code": "legacy_media_pipeline_disabled",
            "stage": "安全播放模式",
            "reason": "本站只识别视频来源并同步播放状态，不再提取、上传或代理第三方视频。",
            "suggestion": "请粘贴受支持的官方视频网页；自有或已授权媒体需由管理员登记域名。",
        }
    ), 410


@app.route("/upload", methods=["POST"])
@rate_limit("upload", limit=10, window_seconds=15 * 60)
def upload_file():
    if not ENABLE_LEGACY_MEDIA_PIPELINE:
        return legacy_media_pipeline_disabled("服务器视频上传")
    cleanup_expired_uploads()

    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "请选择视频文件"}), 400

    safe_name = secure_filename(file.filename)
    extension = Path(safe_name or file.filename).suffix.lower()
    if extension not in ALLOWED_VIDEO_EXTENSIONS:
        return jsonify({"error": "仅支持 MP4、WebM、OGG 或 M4V 视频"}), 415
    if file.mimetype and not (
        file.mimetype.startswith("video/")
        or file.mimetype == "application/octet-stream"
    ):
        return jsonify({"error": "文件类型不是可播放的视频"}), 415

    stored_name = f"{uuid.uuid4().hex}{extension}"
    destination = UPLOAD_DIR / stored_name
    file.save(destination)

    original_name = Path(file.filename).name[:128]
    source_url = url_for("static", filename=f"uploads/{stored_name}")
    transcode = queue_transcode(destination, source_url, original_name)
    return jsonify(
        {
            "url": source_url,
            "filename": original_name,
            "transcode": transcode,
        }
    ), 201


@app.route("/transcode/<job_id>")
@rate_limit("transcode-status", limit=240, window_seconds=60)
def transcode_status(job_id):
    if not ENABLE_LEGACY_MEDIA_PIPELINE:
        return legacy_media_pipeline_disabled("服务器视频转码")
    if not TRANSCODE_ID_PATTERN.fullmatch(job_id):
        return jsonify({"error": "转码任务编号无效"}), 404

    with transcode_lock:
        job = transcode_jobs.get(job_id)
        if job:
            return jsonify(public_transcode_job(job))

    master_path = hls_root() / job_id / "master.m3u8"
    if master_path.is_file():
        return jsonify(
            {
                "id": job_id,
                "status": "ready",
                "progress": 100,
                "stage": "自适应清晰度已就绪",
                "message": "已根据每位成员的网络自动选择清晰度",
                "status_url": f"/transcode/{job_id}",
                "hls_url": f"/static/uploads/hls/{job_id}/master.m3u8",
                "source_url": None,
                "qualities": [],
            }
        )
    return jsonify({"error": "找不到该转码任务"}), 404


def extract_media_url_from_html(html):
    patterns = [
        r"""["']?(https?://[^"'<> \t\r\n]+\.m3u8[^"'<> \t\r\n]*)["']?""",
        r"""["']?(https?://[^"'<> \t\r\n]+\.mp4[^"'<> \t\r\n]*)["']?""",
    ]
    found_urls = []
    for pattern in patterns:
        found_urls.extend(re.findall(pattern, html, re.IGNORECASE))

    normalized = list(dict.fromkeys(url.replace("\\/", "/") for url in found_urls))
    hls_urls = [url for url in normalized if ".m3u8" in url.lower()]
    mp4_urls = [url for url in normalized if ".mp4" in url.lower()]
    return (hls_urls or mp4_urls or [None])[0]


def parse_success(url, title, method, reason):
    return {
        "ok": True,
        "url": url,
        "title": clean_text(title or "网页视频", 200),
        "method": method,
        "reason": reason,
        "reachable": True,
    }


def parse_failure(name, error=None, *, code=None, reachable=False):
    return {
        "ok": False,
        "reachable": reachable,
        "attempt": parser_attempt(name, error, code=code),
    }


def parse_with_ytdlp(target_url):
    try:
        import yt_dlp

        ydl_opts = {
            "format": "best",
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "socket_timeout": min(6, PARSE_FAST_TIMEOUT_SECONDS),
            "extractor_retries": 0,
            "retries": 0,
            "http_headers": {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36"
                ),
            },
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(target_url, download=False)
            video_url = info.get("url")
            if video_url:
                validate_public_url(video_url)
                return parse_success(
                    video_url,
                    info.get("title", "未知视频"),
                    "通用解析器",
                    "通用解析器已找到可播放媒体地址。",
                )
            return parse_failure(
                "通用解析器",
                code="parser_no_media",
                reachable=True,
            )
    except Exception as primary_error:
        app.logger.info("yt-dlp parsing failed: %s", primary_error)
        return parse_failure("通用解析器", primary_error)


def parse_dynamic_page(target_url):
    try:
        from selenium import webdriver
        from selenium.common.exceptions import TimeoutException
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service

        options = Options()
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--disable-extensions")
        options.add_argument("--disable-background-networking")
        options.add_experimental_option(
            "prefs",
            {"profile.managed_default_content_settings.images": 2},
        )
        options.page_load_strategy = "eager"

        chrome_bin = os.environ.get("CHROME_BIN")
        if chrome_bin:
            options.binary_location = chrome_bin

        driver_path = os.environ.get("CHROMEDRIVER_PATH")
        service = Service(driver_path) if driver_path else Service()
        driver = webdriver.Chrome(service=service, options=options)
        try:
            driver.set_page_load_timeout(PARSE_BROWSER_TIMEOUT_SECONDS)
            driver.set_script_timeout(PARSE_BROWSER_TIMEOUT_SECONDS)
            try:
                driver.get(target_url)
            except TimeoutException:
                app.logger.info("Dynamic page load reached the time budget: %s", target_url)

            media_url = None
            scan_deadline = time.monotonic() + 1.2
            while time.monotonic() < scan_deadline:
                for element in driver.find_elements(
                    "css selector",
                    "video[src], video source[src]",
                ):
                    source = element.get_attribute("src")
                    if source and source.startswith(("http://", "https://")):
                        media_url = source
                        break
                media_url = media_url or extract_media_url_from_html(
                    driver.page_source
                )
                if media_url:
                    break
                time.sleep(0.2)

            if media_url:
                validate_public_url(media_url)
                return parse_success(
                    media_url,
                    driver.title or "网页视频",
                    "动态网页解析器",
                    "动态网页解析器已找到可播放媒体地址。",
                )
            return parse_failure(
                "动态网页解析器",
                code="parser_no_media",
                reachable=True,
            )
        finally:
            driver.quit()
    except Exception as selenium_error:
        app.logger.info("Selenium parsing failed: %s", selenium_error)
        return parse_failure("动态网页解析器", selenium_error)


def parse_static_page(target_url):
    try:
        response = safe_request(
            "GET",
            target_url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": "text/html,application/xhtml+xml",
            },
            timeout=(3, 6),
            stream=True,
        )
        try:
            response.raise_for_status()
            html = read_limited_response(response, 2 * 1024 * 1024).decode(
                response.encoding or "utf-8",
                errors="replace",
            )
        finally:
            response.close()

        media_url = extract_media_url_from_html(html)
        if media_url:
            validate_public_url(media_url)
            return parse_success(
                media_url,
                "网页视频",
                "静态网页检查",
                "静态网页检查已找到可播放媒体地址。",
            )
        return parse_failure(
            "静态网页检查",
            code="parser_no_media",
            reachable=True,
        )
    except Exception as scrape_error:
        app.logger.info("Static parsing failed: %s", scrape_error)
        return parse_failure("静态网页检查", scrape_error)


def run_parse_tasks(task_specs, timeout_seconds):
    future_names = {
        parse_executor.submit(task, target_url): name
        for name, task, target_url in task_specs
    }
    pending = set(future_names)
    results = []
    deadline = time.monotonic() + timeout_seconds

    while pending:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        completed, pending = wait(
            pending,
            timeout=remaining,
            return_when=FIRST_COMPLETED,
        )
        if not completed:
            break

        for future in completed:
            name = future_names[future]
            try:
                result = future.result()
            except Exception as error:
                app.logger.exception("%s crashed", name)
                result = parse_failure(name, error)
            results.append(result)
            if result.get("ok"):
                for unfinished in pending:
                    unfinished.cancel()
                return result, results

    for unfinished in pending:
        unfinished.cancel()
        results.append(
            parse_failure(
                future_names[unfinished],
                code="parser_timeout",
            )
        )
    return None, results


def parse_success_response(result, started_at):
    elapsed_ms = round((time.monotonic() - started_at) * 1000)
    return jsonify(
        {
            "url": result["url"],
            "title": result["title"],
            "diagnostic": {
                "code": "parsed",
                "stage": "媒体提取",
                "reason": result["reason"],
                "method": result["method"],
                "elapsed_ms": elapsed_ms,
            },
        }
    )


@app.route("/resolve_source", methods=["POST"])
@app.route("/parse_url", methods=["POST"])
@rate_limit("source", limit=30, window_seconds=60)
def parse_url():
    started_at = time.monotonic()
    data = request.get_json(silent=True) or {}
    try:
        source = resolve_media_source(data.get("url"))
    except UnsafeURLError as exc:
        return unsafe_url_response(exc)

    if source["mode"] == "direct_media":
        diagnostic = diagnostic_payload(
            "direct_media_ready",
            error="已识别管理员登记的授权媒体",
            extra={
                "elapsed_ms": round((time.monotonic() - started_at) * 1000),
            },
        )
    else:
        diagnostic = diagnostic_payload(
            "official_page_ready",
            error=f"已识别 {source['provider_name']} 官方页面",
            extra={
                "elapsed_ms": round((time.monotonic() - started_at) * 1000),
            },
        )
    return jsonify({"ok": True, "source": source, "diagnostic": diagnostic})


@app.route("/probe_media", methods=["POST"])
@rate_limit("probe", limit=20, window_seconds=60)
def probe_media():
    if not ENABLE_LEGACY_MEDIA_PIPELINE:
        return legacy_media_pipeline_disabled("服务器媒体探测")
    data = request.get_json(silent=True) or {}
    raw_url = data.get("url")
    try:
        target_url = validate_public_url(raw_url)
    except UnsafeURLError as exc:
        return unsafe_url_response(exc)

    try:
        upstream = safe_request(
            "GET",
            target_url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": (
                    "video/*,application/vnd.apple.mpegurl,"
                    "application/x-mpegURL,*/*"
                ),
                "Accept-Encoding": "identity",
                "Range": "bytes=0-0",
            },
            stream=True,
            timeout=(5, 15),
        )
        try:
            status_code = upstream.status_code
            content_type = upstream.headers.get("Content-Type", "").split(";", 1)[0]
        finally:
            upstream.close()
    except UnsafeURLError as exc:
        return unsafe_url_response(exc)
    except requests.RequestException as exc:
        code = classify_parser_error(exc)
        if code == "parser_no_media":
            code = "network_error"
        return jsonify(
            diagnostic_payload(
                code,
                error="服务器无法连接该媒体地址",
                extra={"ok": False},
            )
        ), 502

    if status_code in {401, 403}:
        code = "auth_required" if status_code == 401 else "access_blocked"
        return jsonify(
            diagnostic_payload(
                code,
                error=f"源网站返回 HTTP {status_code}",
                extra={"ok": False, "status_code": status_code},
            )
        ), 422
    if status_code == 404:
        return jsonify(
            diagnostic_payload(
                "source_not_found",
                error="源网站返回 HTTP 404",
                extra={"ok": False, "status_code": status_code},
            )
        ), 422
    if status_code == 429:
        return jsonify(
            diagnostic_payload(
                "source_rate_limited",
                error="源网站返回 HTTP 429",
                extra={"ok": False, "status_code": status_code},
            )
        ), 422
    if status_code >= 400:
        return jsonify(
            diagnostic_payload(
                "network_error",
                error=f"源网站返回 HTTP {status_code}",
                extra={"ok": False, "status_code": status_code},
            )
        ), 502

    content_type_lower = content_type.lower()
    if "text/html" in content_type_lower:
        return jsonify(
            diagnostic_payload(
                "direct_not_media",
                error="该直链返回了网页内容",
                extra={
                    "ok": False,
                    "status_code": status_code,
                    "content_type": content_type,
                },
            )
        ), 422

    return jsonify(
        diagnostic_payload(
            "media_ready",
            error="媒体地址可以访问",
            extra={
                "ok": True,
                "status_code": status_code,
                "content_type": content_type or "未知",
            },
        )
    )


@app.route("/proxy")
@rate_limit("proxy", limit=600, window_seconds=60)
def proxy_video():
    if not ENABLE_LEGACY_MEDIA_PIPELINE:
        return legacy_media_pipeline_disabled("服务器视频代理")
    target_url = request.args.get("url")
    if not target_url:
        return jsonify({"error": "缺少视频地址"}), 400

    upstream_headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*",
        "Accept-Encoding": "identity",
    }
    if request.headers.get("Range"):
        upstream_headers["Range"] = request.headers["Range"]

    try:
        upstream = safe_request(
            "GET",
            target_url,
            headers=upstream_headers,
            stream=True,
            timeout=(5, 30),
        )
    except UnsafeURLError as exc:
        return jsonify({"error": str(exc)}), 400
    except requests.RequestException:
        return jsonify({"error": "视频源暂时无法访问"}), 502

    response_headers = {}
    for header in (
        "Content-Type",
        "Content-Length",
        "Accept-Ranges",
        "Content-Range",
        "Cache-Control",
        "ETag",
        "Last-Modified",
    ):
        if header in upstream.headers:
            response_headers[header] = upstream.headers[header]

    def generate():
        try:
            for chunk in upstream.iter_content(chunk_size=64 * 1024):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    response = app.response_class(
        stream_with_context(generate()),
        status=upstream.status_code,
        headers=response_headers,
        direct_passthrough=True,
    )
    response.call_on_close(upstream.close)
    return response


def is_playlist_url(value):
    return urlparse(value).path.lower().endswith(".m3u8")


def proxied_media_url(value, *, playlist=False):
    endpoint = "hls_proxy" if playlist or is_playlist_url(value) else "proxy_video"
    return url_for(endpoint, url=value)


def rewrite_hls_tag_uris(line, base_url):
    playlist_tag = line.startswith(("#EXT-X-MEDIA:", "#EXT-X-I-FRAME-STREAM-INF:"))

    def replace(match):
        quote_char, raw_uri = match.groups()
        absolute = urljoin(base_url, raw_uri)
        rewritten = proxied_media_url(absolute, playlist=playlist_tag)
        return f"URI={quote_char}{rewritten}{quote_char}"

    return re.sub(r"""URI=(["'])(.*?)\1""", replace, line, flags=re.IGNORECASE)


@app.route("/hls_proxy")
@rate_limit("hls", limit=120, window_seconds=60)
def hls_proxy():
    if not ENABLE_LEGACY_MEDIA_PIPELINE:
        return legacy_media_pipeline_disabled("HLS 代理")
    target_url = request.args.get("url")
    if not target_url:
        return jsonify({"error": "缺少播放列表地址"}), 400

    try:
        upstream = safe_request(
            "GET",
            target_url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
            },
            stream=True,
            timeout=(5, 15),
        )
        try:
            upstream.raise_for_status()
            content = read_limited_response(upstream, MAX_PLAYLIST_BYTES).decode(
                upstream.encoding or "utf-8",
                errors="replace",
            )
            final_url = upstream.url
        finally:
            upstream.close()
    except UnsafeURLError as exc:
        return jsonify({"error": str(exc)}), 400
    except (requests.RequestException, ValueError):
        return jsonify({"error": "HLS 播放列表暂时无法访问"}), 502

    rewritten_lines = []
    next_uri_is_playlist = False
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            rewritten_lines.append(line)
            continue
        if line.startswith("#"):
            rewritten_lines.append(rewrite_hls_tag_uris(line, final_url))
            next_uri_is_playlist = line.startswith("#EXT-X-STREAM-INF:")
            continue

        absolute = urljoin(final_url, line)
        rewritten_lines.append(
            proxied_media_url(
                absolute,
                playlist=next_uri_is_playlist or is_playlist_url(absolute),
            )
        )
        next_uri_is_playlist = False

    return app.response_class(
        "\n".join(rewritten_lines),
        mimetype="application/vnd.apple.mpegurl",
        headers={"Cache-Control": "no-store"},
    )


room_states = {}
room_members = defaultdict(dict)
sid_membership = {}
sid_roles = {}
sid_client_keys = {}
room_activity = {}
socket_message_times = defaultdict(deque)
call_members = defaultdict(dict)
room_buffering = defaultdict(set)
rooms_paused_for_buffering = set()
room_lock = threading.RLock()


def cleanup_stale_rooms():
    cutoff = time.time() - ROOM_TTL_SECONDS
    with room_lock:
        stale_rooms = [
            room_id
            for room_id, last_active in room_activity.items()
            if last_active < cutoff and not room_members.get(room_id)
        ]
        for room_id in stale_rooms:
            room_states.pop(room_id, None)
            room_activity.pop(room_id, None)
            room_members.pop(room_id, None)
            call_members.pop(room_id, None)
            room_buffering.pop(room_id, None)
            rooms_paused_for_buffering.discard(room_id)


def ensure_room_state(room_id, now=None):
    now = now or time.time()
    return room_states.setdefault(
        room_id,
        {
            "video_src": None,
            "media_source": None,
            "time": 0.0,
            "playing": False,
            "speed": 1.0,
            "updated_at": now,
            "resume_at": None,
            "revision": 0,
        },
    )


def current_room_state(room_id):
    with room_lock:
        state = room_states.get(room_id)
        if not state or not (state.get("media_source") or state.get("video_src")):
            return None
        snapshot = dict(state)

    now = time.time()
    if snapshot.get("playing"):
        elapsed = max(0.0, now - snapshot.get("updated_at", now))
        snapshot["time"] = max(
            0.0,
            snapshot.get("time", 0.0) + elapsed * snapshot.get("speed", 1.0),
        )
    snapshot["server_time"] = now
    return snapshot


def broadcast_presence(room_id):
    with room_lock:
        members = [
            {
                "id": sid,
                "username": username,
                "in_call": sid in call_members.get(room_id, {}),
            }
            for sid, username in room_members.get(room_id, {}).items()
            if sid_roles.get(sid, "member") != "companion"
        ]
        users = [member["username"] for member in members]
    socketio.emit(
        "presence",
        {"count": len(users), "users": users, "members": members},
        to=room_id,
    )


def broadcast_call_presence(room_id):
    with room_lock:
        members = [
            {
                "id": sid,
                "username": state["username"],
                "muted": state.get("muted", False),
            }
            for sid, state in call_members.get(room_id, {}).items()
        ]
    socketio.emit(
        "call_presence",
        {"count": len(members), "members": members},
        to=room_id,
    )


def remove_call_member(sid, room_id=None):
    with room_lock:
        membership = sid_membership.get(sid)
        room_id = room_id or (membership[0] if membership else None)
        if not room_id:
            return
        member = call_members.get(room_id, {}).pop(sid, None)
    if not member:
        return

    socketio.emit(
        "call_member_left",
        {"id": sid, "username": member["username"]},
        to=room_id,
    )
    broadcast_call_presence(room_id)
    broadcast_presence(room_id)


def release_buffering_member(sid, room_id):
    resume_payload = None
    remaining_payload = None
    with room_lock:
        buffers = room_buffering.get(room_id)
        if not buffers or sid not in buffers:
            return
        buffers.discard(sid)
        if buffers:
            remaining_payload = {
                "active": True,
                "buffering_users": [
                    room_members.get(room_id, {}).get(member_sid, "成员")
                    for member_sid in buffers
                ],
            }
        elif room_id in rooms_paused_for_buffering:
            now = time.time()
            resume_at = now + 0.8
            state = ensure_room_state(room_id, now)
            state.update(playing=True, updated_at=resume_at, resume_at=resume_at)
            state["revision"] += 1
            rooms_paused_for_buffering.discard(room_id)
            resume_payload = {
                "active": False,
                "playing": True,
                "time": state["time"],
                "speed": state["speed"],
                "revision": state["revision"],
                "server_time": now,
                "resume_at": resume_at,
            }
        else:
            now = time.time()
            state = ensure_room_state(room_id, now)
            resume_payload = {
                "active": False,
                "playing": False,
                "time": state["time"],
                "speed": state["speed"],
                "revision": state["revision"],
                "server_time": now,
                "resume_at": None,
            }
    if remaining_payload:
        socketio.emit("buffering_state", remaining_payload, to=room_id)
    elif resume_payload:
        socketio.emit("buffering_state", resume_payload, to=room_id)


def remove_member(sid, announce=True):
    membership = sid_membership.get(sid)
    if membership:
        remove_call_member(sid, membership[0])
        release_buffering_member(sid, membership[0])

    with room_lock:
        membership = sid_membership.pop(sid, None)
        if not membership:
            return
        room_id, username = membership
        role = sid_roles.pop(sid, "member")
        client_key = sid_client_keys.pop(sid, "")
        room_members[room_id].pop(sid, None)
        room_activity[room_id] = time.time()

    if announce and role != "companion":
        socketio.emit(
            "status",
            {"msg": f"{username} 离开了房间"},
            to=room_id,
        )
    if role == "companion" and client_key:
        notify_companion_presence(room_id, client_key)
    broadcast_presence(room_id)


def socket_identity(data):
    membership = sid_membership.get(request.sid)
    if not membership:
        return None
    room_id, username = membership
    if not isinstance(data, dict) or data.get("room") != room_id:
        return None
    return room_id, username


def notify_companion_presence(room_id, client_key):
    if not client_key:
        return
    with room_lock:
        members = room_members.get(room_id, {})
        companion_count = sum(
            sid_roles.get(sid) == "companion"
            and sid_client_keys.get(sid) == client_key
            for sid in members
        )
        human_sids = [
            sid
            for sid in members
            if sid_roles.get(sid, "member") != "companion"
            and sid_client_keys.get(sid) == client_key
        ]
    payload = {
        "connected": companion_count > 0,
        "count": companion_count,
    }
    for sid in human_sids:
        socketio.emit("companion_presence", payload, to=sid)


@socketio.on("join")
def on_join(data):
    cleanup_stale_rooms()
    if not isinstance(data, dict):
        emit("app_error", {"message": "进房参数无效"})
        return

    username = clean_text(data.get("username"), 32)
    room_id = clean_text(data.get("room"), 64)
    role = "companion" if data.get("role") == "companion" else "member"
    client_key = clean_text(data.get("client_key"), 96)
    if client_key and not re.fullmatch(r"[A-Za-z0-9_-]{16,96}", client_key):
        client_key = ""
    if not username or not valid_room_id(room_id):
        emit("app_error", {"message": "昵称或房间号无效"})
        return

    previous = sid_membership.get(request.sid)
    with room_lock:
        current_members = room_members.get(room_id, {})
        human_count = sum(
            sid_roles.get(sid, "member") != "companion"
            for sid in current_members
        )
        room_is_full = (
            request.sid not in current_members
            and (
                len(current_members) >= MAX_ROOM_MEMBERS * 2
                or (role != "companion" and human_count >= MAX_ROOM_MEMBERS)
            )
        )
    if room_is_full:
        emit(
            "app_error",
            {"message": f"房间人数已达上限（{MAX_ROOM_MEMBERS} 人）"},
        )
        return

    if previous and previous != (room_id, username):
        old_room = previous[0]
        leave_room(old_room)
        remove_member(request.sid)

    is_new_member = previous != (room_id, username)
    join_room(room_id)
    with room_lock:
        sid_membership[request.sid] = (room_id, username)
        sid_roles[request.sid] = role
        sid_client_keys[request.sid] = client_key
        room_members[room_id][request.sid] = username
        room_activity[room_id] = time.time()

    if is_new_member and role != "companion":
        emit("status", {"msg": f"{username} 加入了房间"}, to=room_id)
    broadcast_presence(room_id)
    if client_key:
        notify_companion_presence(room_id, client_key)

    state = current_room_state(room_id)
    if state:
        emit("room_state", state)


@socketio.on("leave")
def on_leave(_data=None):
    membership = sid_membership.get(request.sid)
    if membership:
        leave_room(membership[0])
        remove_member(request.sid)


@socketio.on("disconnect")
def on_disconnect(_reason=None):
    remove_member(request.sid)
    socket_message_times.pop(request.sid, None)


@socketio.on("request_room_state")
def request_room_state(data):
    identity = socket_identity(data)
    if not identity:
        return
    state = current_room_state(identity[0])
    if state:
        emit("room_state", state)


@socketio.on("companion_command")
def companion_command(data):
    identity = socket_identity(data)
    if not identity or sid_roles.get(request.sid, "member") == "companion":
        return
    room_id, _username = identity
    if data.get("command") != "set_volume":
        return
    try:
        volume = float(data.get("value"))
    except (TypeError, ValueError):
        return
    if not math.isfinite(volume) or not 0 <= volume <= 1:
        return

    client_key = sid_client_keys.get(request.sid, "")
    if not client_key:
        return
    with room_lock:
        targets = [
            sid
            for sid in room_members.get(room_id, {})
            if sid_roles.get(sid) == "companion"
            and sid_client_keys.get(sid) == client_key
        ]
    for sid in targets:
        socketio.emit(
            "companion_command",
            {"command": "set_volume", "value": volume},
            to=sid,
        )


@socketio.on("sync_ping")
def sync_ping(data):
    identity = socket_identity(data)
    if not identity:
        return
    client_time = data.get("client_time")
    if not isinstance(client_time, (int, float)):
        return
    emit(
        "sync_pong",
        {
            "client_time": client_time,
            "server_time": time.time(),
        },
    )


@socketio.on("buffering_event")
def handle_buffering_event(data):
    identity = socket_identity(data)
    if not identity:
        return
    room_id, username = identity
    active = bool(data.get("active"))

    if not active:
        release_buffering_member(request.sid, room_id)
        return

    try:
        event_time = float(data.get("time", 0))
    except (TypeError, ValueError):
        return
    if not math.isfinite(event_time) or event_time < 0:
        return

    now = time.time()
    with room_lock:
        buffers = room_buffering[room_id]
        was_buffering = request.sid in buffers
        buffers.add(request.sid)
        state = ensure_room_state(room_id, now)

        if state.get("playing") and not was_buffering:
            authoritative_time = state.get("time", event_time)
            authoritative_time += max(0.0, now - state.get("updated_at", now)) * state.get(
                "speed",
                1.0,
            )
            state.update(
                time=max(0.0, authoritative_time),
                playing=False,
                updated_at=now,
                resume_at=None,
            )
            state["revision"] += 1
            rooms_paused_for_buffering.add(room_id)

        payload = {
            "active": True,
            "username": username,
            "time": state.get("time", event_time),
            "speed": state.get("speed", 1.0),
            "revision": state.get("revision", 0),
            "server_time": now,
            "buffering_users": [
                room_members.get(room_id, {}).get(member_sid, "成员")
                for member_sid in buffers
            ],
        }
        room_activity[room_id] = now

    emit("buffering_state", payload, to=room_id)


@socketio.on("call_join")
def handle_call_join(data):
    identity = socket_identity(data)
    if not identity:
        emit("call_error", {"message": "请先重新加入房间"})
        return
    room_id, username = identity

    with room_lock:
        members = call_members[room_id]
        if request.sid not in members and len(members) >= MAX_CALL_MEMBERS:
            emit(
                "call_error",
                {"message": f"语音通话最多支持 {MAX_CALL_MEMBERS} 人"},
            )
            return
        existing = [
            {
                "id": sid,
                "username": state["username"],
                "muted": state.get("muted", False),
            }
            for sid, state in members.items()
            if sid != request.sid
        ]
        is_new = request.sid not in members
        members[request.sid] = {"username": username, "muted": False}

    emit(
        "call_ready",
        {
            "self_id": request.sid,
            "members": existing,
            "ice_servers": ICE_SERVERS,
            "turn_configured": TURN_CONFIGURED,
            "max_members": MAX_CALL_MEMBERS,
        },
    )
    if is_new:
        emit(
            "call_member_joined",
            {"id": request.sid, "username": username, "muted": False},
            to=room_id,
            include_self=False,
        )
    broadcast_call_presence(room_id)
    broadcast_presence(room_id)


@socketio.on("call_leave")
def handle_call_leave(data):
    identity = socket_identity(data)
    if identity:
        remove_call_member(request.sid, identity[0])


@socketio.on("call_mute")
def handle_call_mute(data):
    identity = socket_identity(data)
    if not identity:
        return
    room_id, _username = identity
    muted = bool(data.get("muted"))
    with room_lock:
        member = call_members.get(room_id, {}).get(request.sid)
        if not member:
            return
        member["muted"] = muted
    emit(
        "call_member_updated",
        {"id": request.sid, "muted": muted},
        to=room_id,
    )
    broadcast_call_presence(room_id)


def relay_webrtc_description(data, event_name):
    identity = socket_identity(data)
    if not identity:
        return
    room_id, username = identity
    target = data.get("target")
    description = data.get("description")
    if not isinstance(target, str) or not isinstance(description, dict):
        return
    try:
        serialized = json.dumps(description)
    except (TypeError, ValueError):
        return
    if len(serialized) > 120_000:
        return

    with room_lock:
        allowed = (
            request.sid in call_members.get(room_id, {})
            and target in call_members.get(room_id, {})
            and sid_membership.get(target, (None,))[0] == room_id
        )
    if not allowed:
        return
    socketio.emit(
        event_name,
        {
            "from": request.sid,
            "username": username,
            "description": description,
        },
        to=target,
    )


@socketio.on("webrtc_offer")
def relay_webrtc_offer(data):
    relay_webrtc_description(data, "webrtc_offer")


@socketio.on("webrtc_answer")
def relay_webrtc_answer(data):
    relay_webrtc_description(data, "webrtc_answer")


@socketio.on("webrtc_ice")
def relay_webrtc_ice(data):
    identity = socket_identity(data)
    if not identity:
        return
    room_id, _username = identity
    target = data.get("target")
    candidate = data.get("candidate")
    if not isinstance(target, str) or not isinstance(candidate, dict):
        return
    try:
        serialized = json.dumps(candidate)
    except (TypeError, ValueError):
        return
    if len(serialized) > 20_000:
        return

    with room_lock:
        allowed = (
            request.sid in call_members.get(room_id, {})
            and target in call_members.get(room_id, {})
            and sid_membership.get(target, (None,))[0] == room_id
        )
    if allowed:
        socketio.emit(
            "webrtc_ice",
            {"from": request.sid, "candidate": candidate},
            to=target,
        )


@socketio.on("video_event")
def handle_video_event(data):
    identity = socket_identity(data)
    if not identity:
        emit("app_error", {"message": "请重新加入房间"})
        return
    room_id, username = identity

    event_type = data.get("type")
    if event_type not in CONTROL_EVENTS:
        return

    try:
        event_time = float(data.get("time", 0))
    except (TypeError, ValueError):
        return
    if not math.isfinite(event_time) or not 0 <= event_time <= 7 * 24 * 60 * 60:
        return

    if event_type == "play":
        with room_lock:
            buffering_users = len(room_buffering.get(room_id, set()))
        if buffering_users:
            emit(
                "app_error",
                {"message": f"还有 {buffering_users} 位成员正在缓冲，请稍等"},
            )
            state = current_room_state(room_id)
            if state:
                emit("room_state", state)
            return

    now = time.time()
    with room_lock:
        state = ensure_room_state(room_id, now)

        outgoing = {
            "room": room_id,
            "username": username,
            "type": event_type,
            "time": event_time,
        }

        if event_type == "change_source":
            media_source = sanitize_media_source(data.get("source"))
            if not media_source:
                legacy_source = sanitize_video_source(data.get("src"))
                if legacy_source and ENABLE_LEGACY_MEDIA_PIPELINE:
                    media_source = {
                        "mode": "direct_media",
                        "provider_key": "legacy",
                        "provider_name": "兼容媒体源",
                        "media_id": None,
                        "title": "兼容媒体源",
                        "page_url": legacy_source,
                        "media_url": legacy_source,
                        "requires_companion": False,
                        "capabilities": {
                            "play": True,
                            "pause": True,
                            "seek": True,
                            "speed": True,
                        },
                    }
                else:
                    return
            source = media_source.get("media_url") or media_source["page_url"]
            if not source:
                return
            preserve_position = bool(data.get("preserve_position"))
            resume_playing = preserve_position and bool(data.get("resume_playing"))
            source_time = event_time if preserve_position else 0.0
            source_speed = state.get("speed", 1.0) if preserve_position else 1.0
            state.update(
                video_src=source,
                media_source=media_source,
                time=source_time,
                playing=resume_playing,
                speed=source_speed,
                resume_at=None,
            )
            room_buffering[room_id].clear()
            rooms_paused_for_buffering.discard(room_id)
            outgoing.update(
                src=source,
                source=media_source,
                time=source_time,
                playing=resume_playing,
                speed=source_speed,
                preserve_position=preserve_position,
            )
        elif event_type == "play":
            state.update(time=event_time, playing=True, resume_at=None)
        elif event_type == "pause":
            state.update(time=event_time, playing=False, resume_at=None)
            rooms_paused_for_buffering.discard(room_id)
        elif event_type == "seek":
            state["time"] = event_time
        elif event_type == "speed":
            try:
                speed = float(data.get("speed", 1))
            except (TypeError, ValueError):
                return
            if not math.isfinite(speed) or not 0.25 <= speed <= 4:
                return
            state.update(time=event_time, speed=speed)
            outgoing["speed"] = speed

        state["updated_at"] = now
        state["revision"] += 1
        outgoing.update(
            revision=state["revision"],
            server_time=now,
        )
        room_activity[room_id] = now

    emit("sync_video", outgoing, to=room_id, include_self=False)


@socketio.on("chat_message")
def handle_chat(data):
    identity = socket_identity(data)
    if not identity:
        emit("app_error", {"message": "请重新加入房间"})
        return
    room_id, username = identity

    now = time.monotonic()
    bucket = socket_message_times[request.sid]
    while bucket and now - bucket[0] > 10:
        bucket.popleft()
    if len(bucket) >= 20:
        emit("app_error", {"message": "消息发送太快，请稍等一下"})
        return

    message = clean_text(data.get("message"), 500)
    if not message:
        return
    bucket.append(now)
    room_activity[room_id] = time.time()
    emit(
        "chat_message",
        {
            "room": room_id,
            "username": username,
            "message": message,
            "sent_at": int(time.time() * 1000),
        },
        to=room_id,
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(
        app,
        host="0.0.0.0",
        port=port,
        debug=os.environ.get("FLASK_DEBUG") == "1",
        allow_unsafe_werkzeug=True,
    )
