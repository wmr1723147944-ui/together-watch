"""Optional, bounded access to the official Dandanplay API; no client secrets."""
import base64
import hashlib
import json
import os
import re
import threading
import time
from collections import OrderedDict
from urllib.parse import urljoin, urlparse

import requests

_cache = OrderedDict()
_lock = threading.RLock()
MAX_BYTES = 3 * 1024 * 1024


class DanmakuError(Exception):
    pass


def configured():
    return bool(os.environ.get("DANDANPLAY_APP_ID", "").strip()
                and os.environ.get("DANDANPLAY_APP_SECRET", "").strip())


def _get(path, params):
    app_id = os.environ.get("DANDANPLAY_APP_ID", "").strip()
    secret = os.environ.get("DANDANPLAY_APP_SECRET", "").strip()
    if not app_id or not secret:
        raise DanmakuError("管理员尚未配置公共弹幕服务；好友弹幕仍可使用。")
    key = (app_id, path, tuple(sorted(params.items())))
    with _lock:
        cached = _cache.get(key)
        if cached and cached[0] > time.monotonic():
            _cache.move_to_end(key)
            return cached[1]
    stamp = str(int(time.time()))
    signature = base64.b64encode(hashlib.sha256((app_id + stamp + path + secret).encode()).digest()).decode()
    try:
        url = "https://api.dandanplay.net" + path
        headers = {"X-AppId": app_id, "X-Timestamp": stamp, "X-Signature": signature,
                   "Accept": "application/json", "Accept-Encoding": "gzip"}
        for hop in range(3):
            with requests.get(url, params=params if hop == 0 else None, headers=headers,
                              timeout=(4, 8), allow_redirects=False, stream=True) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    target = urljoin(url, response.headers.get("Location", ""))
                    parsed = urlparse(target)
                    if (hop == 2 or len(target) > 8192 or not path.startswith('/api/v2/comment/') or parsed.scheme != 'https'
                            or parsed.hostname not in {'cas.dandanplay.net', 'api.dandanplay.net'}
                            or parsed.port not in (None, 443) or parsed.username or parsed.password
                            or not re.fullmatch(r'/api/(?:v2/)?comment/[1-9][0-9]{0,18}', parsed.path)):
                        raise DanmakuError("弹幕服务返回了未支持的跳转，请稍后重试。")
                    # Official comments redirect to the acceleration service.
                    # Never forward developer authentication headers to that host.
                    url, headers = target, {"Accept": "application/json", "Accept-Encoding": "gzip"}
                    continue
                if response.status_code != 200:
                    raise DanmakuError("公共弹幕服务暂不可用，请稍后重试或检查服务额度。")
                raw = bytearray()
                for part in response.iter_content(65536):
                    raw.extend(part)
                    if len(raw) > MAX_BYTES:
                        raise DanmakuError("这集弹幕数据过大，暂未加载。")
                data = json.loads(raw)
                break
        if not isinstance(data, dict) or data.get("success") is False:
            raise DanmakuError("公共弹幕服务没有返回可用结果。")
    except (requests.RequestException, ValueError) as exc:
        raise DanmakuError("公共弹幕加载失败，不影响视频播放。") from exc
    with _lock:
        _cache[key] = (time.monotonic() + 600, data)
        while len(_cache) > 4:
            _cache.popitem(last=False)
    return data


def search(query):
    query = " ".join(str(query).split())[:80]
    if len(query) < 2:
        return []
    data = _get("/api/v2/search/episodes", {"anime": query, "v2": "true"})
    rows = []
    animes = data.get("animes") or []
    if not isinstance(animes, list):
        raise DanmakuError("公共弹幕搜索结果格式异常，请稍后重试。")
    for anime in animes[:30]:
        if not isinstance(anime, dict):
            continue
        episodes = anime.get("episodes") or []
        if not isinstance(episodes, list):
            continue
        for episode in episodes[:300]:
            if not isinstance(episode, dict):
                continue
            ident = str(episode.get("episodeId", ""))
            if re.fullmatch(r"[1-9][0-9]{0,18}", ident):
                rows.append({"id": ident, "title": str(anime.get("animeTitle", ""))[:120],
                             "episode": str(episode.get("episodeTitle", ""))[:80]})
            if len(rows) >= 500:
                return rows
    return rows


def comments(episode_id):
    if not re.fullmatch(r"[1-9][0-9]{0,18}", episode_id):
        raise DanmakuError("弹幕集数编号无效。")
    data = _get("/api/v2/comment/" + episode_id, {"withRelated": "true"})
    rows = []
    entries = data.get("comments") or []
    if not isinstance(entries, list):
        raise DanmakuError("公共弹幕数据格式异常，请稍后重试。")
    for entry in entries[:30000]:
        if not isinstance(entry, dict):
            continue
        parts = str(entry.get("p", "")).split(",")
        try:
            position = float(parts[0])
        except (ValueError, IndexError):
            continue
        text = str(entry.get("m", "")).strip()[:80]
        if text and 0 <= position <= 604800:
            rows.append({"id": "public-" + str(len(rows)), "time": position, "text": text, "kind": "public"})
        if len(rows) >= 10000:
            break
    return rows
