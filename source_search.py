"""Bounded, fixed-provider metadata search. Never fetch player pages or media."""

from collections import OrderedDict
from copy import deepcopy
from html.parser import HTMLParser
import ipaddress
import json
import re
import socket
import threading
import time
from urllib.parse import urlencode, urljoin, urlsplit

import certifi
import urllib3

from source_discovery import OPEN_FILMS, normalize_query


SEARCH_VERSION = "20261016-auto-search"
PROVIDERS = {
    "blender": {"id": "blender", "name": "Blender 开放电影", "host": "video.blender.org",
                "path": "/api/v1/search/videos", "param": "search", "kind": "official_catalog",
                "note": "官方电影频道；目录命中不代表本设备已能播放。"},
    "huarw": {"id": "huarw", "name": "华人影院 · huarw.com", "host": "huarw.com",
              "path": "/search", "param": "wd", "kind": "third_party_index",
              "note": "第三方目录；免费范围、内容授权与播放兼容性未核实。"},
    "cupfox": {"id": "cupfox", "name": "茶杯狐 · cupfox.in", "host": "www.cupfox.in",
               "path": "/search", "param": "q", "kind": "third_party_index",
               "note": "同名站点主体关系未确认；免费范围、授权与播放兼容性未核实。"},
}
MAX_BYTES = 1024 * 1024
MAX_RESULTS = 12
CACHE_TTL = 300
FAILURE_TTL = 15
MAX_CACHE_KEYS = 128
_cache = OrderedDict()
_lock = threading.Lock()
_inflight = set()
_slots = threading.BoundedSemaphore(6)


class SearchFailure(Exception):
    pass


def provider_choices(disabled=()):
    return [{k: p[k] for k in ("id", "name", "kind", "note")}
            for p in PROVIDERS.values() if p["id"] not in disabled]


def _text(value, limit=160):
    if not isinstance(value, str):
        return ""
    # Also remove directional overrides from untrusted result titles.
    return re.sub(r"[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]", " ",
                  " ".join(value.split()))[:limit].strip()


def detail_url(provider, value):
    if not isinstance(value, str) or len(value) > 500 or "\\" in value:
        return None
    try:
        parsed = urlsplit(urljoin("https://" + provider["host"], value))
        if (parsed.scheme != "https" or parsed.netloc != provider["host"]
                or parsed.query or parsed.fragment):
            return None
        patterns = {"huarw": r"/movie/[0-9]+", "cupfox": r"/vod-detail/[0-9]+\.html",
                    "blender": r"/videos/watch/[0-9a-f-]{36}"}
        return parsed.geturl() if re.fullmatch(patterns[provider["id"]], parsed.path) else None
    except ValueError:
        return None


def _fetch(provider, query):
    """Pin a public DNS answer, preserving SNI/cert validation; refuse redirects."""
    params = {provider["param"]: query}
    if provider["id"] == "blender":
        params.update(count=30, start=0)
    path = provider["path"] + "?" + urlencode(params)
    host = provider["host"]  # Code-owned constant, never a request parameter.
    addresses = list(dict.fromkeys(row[4][0] for row in
                    socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)))
    if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):
        raise SearchFailure("blocked_address")
    # Prefer IPv4 where the VPS may lack IPv6 egress. No secondary DNS lookup.
    address = next((ip for ip in addresses if ":" not in ip), addresses[0])
    pool = urllib3.HTTPSConnectionPool(address, port=443, server_hostname=host,
                                      assert_hostname=host, cert_reqs="CERT_REQUIRED",
                                      ca_certs=certifi.where(), maxsize=1)
    response = None
    deadline = time.monotonic() + 8
    try:
        response = pool.urlopen("GET", path, headers={
            "Host": host, "User-Agent": "TogetherWatch-MetadataSearch/1.0",
            "Accept": "application/json" if provider["id"] == "blender" else "text/html",
            "Accept-Encoding": "identity",
        }, timeout=urllib3.Timeout(connect=3, read=3), redirect=False, retries=False,
            preload_content=False, decode_content=False)
        if response.status != 200:
            raise SearchFailure("upstream_unavailable")
        content_type = response.headers.get("Content-Type", "").lower()
        expected = "application/json" if provider["id"] == "blender" else "text/html"
        if expected not in content_type or response.headers.get("Content-Encoding", "identity") != "identity":
            raise SearchFailure("unexpected_response")
        length = response.headers.get("Content-Length", "")
        if length.isdigit() and int(length) > MAX_BYTES:
            raise SearchFailure("response_too_large")
        data = bytearray()
        while True:
            if time.monotonic() > deadline:
                raise SearchFailure("timeout")
            chunk = response.read1(min(16384, MAX_BYTES + 1 - len(data)), decode_content=False)
            if not chunk:
                break
            data.extend(chunk)
            if len(data) > MAX_BYTES:
                raise SearchFailure("response_too_large")
        return data.decode("utf-8", errors="replace")
    finally:
        if response is not None:
            response.close()
        pool.close()


class _Cards(HTMLParser):
    """Read text inside known result cards, never execute HTML or follow links."""
    def __init__(self, provider):
        super().__init__(convert_charrefs=True)
        self.provider = provider
        self.stack = []
        self.card = None
        self.cards = []
        self.saw_results = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()
        if "movie-list-body" in classes or "search-box" in classes:
            self.saw_results = True
        is_card = ("movie-list-item" in classes if self.provider["id"] == "cupfox"
                   else "public-list-box" in classes and "search-box" in classes)
        if self.card is None and is_card:
            self.card = {"depth": len(self.stack), "title": [], "year": [], "episode": [], "links": []}
        if self.card is not None and tag == "a":
            link = detail_url(self.provider, attrs.get("href", ""))
            if link:
                self.card["links"].append(link)
        if tag not in {"img", "br", "hr", "input", "meta", "link", "source", "wbr", "area", "embed"}:
            self.stack.append((tag, attrs))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_data(self, data):
        if self.card is None:
            return
        entries = self.stack[self.card["depth"]:]
        if any(tag in {"script", "style"} for tag, _ in entries):
            return
        if any(tag == "h3" or "movie-title" in attrs.get("class", "").split() for tag, attrs in entries):
            self.card["title"].append(data)
        if any(attrs.get("href", "").startswith("/search/year/") for _, attrs in entries):
            self.card["year"].append(data)
        if any("public-list-prb" in attrs.get("class", "").split() for _, attrs in entries):
            self.card["episode"].append(data)

    def handle_endtag(self, tag):
        index = next((i for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if index is None:
            return
        del self.stack[index:]
        if self.card is not None and len(self.stack) <= self.card["depth"]:
            self.cards.append(self.card)
            self.card = None


def _row(provider, title, url, year=None, episode="", duration=None):
    return {"title": title, "page_url": url, "year": year, "episode_label": episode,
            "duration_seconds": duration, "source_id": provider["id"], "source_name": provider["name"],
            "playback_verified": False, "synchronization_verified": False,
            "quality": "未核实", "access": "以原站为准", "kind": provider["kind"]}


def parse_results(provider, body, query):
    if provider["id"] == "blender":
        payload = json.loads(body)
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            raise SearchFailure("layout_changed")
        rows = []
        for video in payload["data"][:30]:
            if not isinstance(video, dict):
                continue
            channel = video.get("channel") or {}
            if not isinstance(channel, dict) or channel.get("name") != "blender_open_movies" or channel.get("host") != provider["host"]:
                continue
            title = _text(video.get("name"))
            if (not title or not all(word in title.casefold() for word in query.casefold().split())
                    or re.search(r"making.of|trailer|teaser|behind.the.scenes|showreel", title, re.I)):
                continue
            url = detail_url(provider, video.get("url"))
            duration = video.get("duration")
            if url:
                rows.append(_row(provider, title, url, duration=duration if type(duration) is int and 0 < duration < 86400 else None))
        return rows[:MAX_RESULTS]
    parser = _Cards(provider)
    parser.feed(body)
    if not parser.saw_results:
        # Explicit empty states are different from a login/captcha/layout change.
        if not any(marker in body for marker in ("没有找到", "暂无数据", "未找到", "没有相关", "暂无相关")):
            raise SearchFailure("layout_changed")
        return []
    rows, seen = [], set()
    for card in parser.cards:
        title = _text("".join(card["title"]))
        if not title or not card["links"]:
            continue
        url = card["links"][0]
        # Never include recommendations just because they occurred on a search page.
        if url in seen or not all(word in title.casefold() for word in query.casefold().split()):
            continue
        seen.add(url)
        year = _text("".join(card["year"]), 4)
        rows.append(_row(provider, title, url, year if re.fullmatch(r"(?:19|20)[0-9]{2}", year) else None,
                         _text("".join(card["episode"]), 50)))
    if parser.cards and not any(c["title"] and c["links"] for c in parser.cards):
        raise SearchFailure("layout_changed")
    return rows[:MAX_RESULTS]


def _provider_query(provider, query):
    if provider["id"] == "blender":
        for film in OPEN_FILMS:
            if query.casefold() == film["title"].casefold() or query in film["aliases"].split():
                return film["title"]
    return query


def search_provider(source_id, query):
    """One source per request, so the UI can show partial results immediately."""
    provider = PROVIDERS[source_id]
    query = normalize_query(query)
    if not query:
        raise ValueError("empty query")
    key = (source_id, query.casefold())
    now = time.monotonic()
    with _lock:
        for old in [k for k, (expiry, _) in _cache.items() if expiry <= now]:
            del _cache[old]
        if key in _cache:
            return {**deepcopy(_cache[key][1]), "cached": True}
        if key in _inflight or not _slots.acquire(blocking=False):
            return {"source_id": source_id, "query": query, "status": "busy", "results": [], "cached": False}
        _inflight.add(key)
    result = {"source_id": source_id, "query": query, "status": "ok", "results": [], "cached": False}
    try:
        remote_query = _provider_query(provider, query)
        result["results"] = parse_results(provider, _fetch(provider, remote_query), remote_query)
    except (SearchFailure, urllib3.exceptions.HTTPError, OSError, ValueError, TypeError, RecursionError):
        # Don't expose exception text, response HTML, request URLs or user queries in logs.
        result["status"] = "unavailable"
    finally:
        with _lock:
            _inflight.discard(key)
            _cache[key] = (time.monotonic() + (CACHE_TTL if result["status"] == "ok" else FAILURE_TTL), deepcopy(result))
            while len(_cache) > MAX_CACHE_KEYS:
                _cache.popitem(last=False)
        _slots.release()
    return result
