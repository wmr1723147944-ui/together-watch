"""Bounded, fixed-provider title/episode metadata. Never fetch media or execute scripts."""

from collections import OrderedDict
from copy import deepcopy
from html.parser import HTMLParser
import ipaddress
import json
import re
import socket
import threading
import time
from urllib.parse import quote, urlencode, urljoin, urlsplit

import certifi
import urllib3

from source_discovery import OPEN_FILMS, normalize_query
import catalog_sources
from poster_policy import poster_url


SEARCH_VERSION = "20261024-source-cleanup"
# Withdrawn from discovery and new room selection. Keep old identity parsers
# readable so existing room records do not become corrupt or change source.
RETIRED_PROVIDERS = frozenset({"ddys", "fcma"})
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
    "yhdmoe": {"id": "yhdmoe", "name": "樱花动漫 · yhdmoe.com", "host": "yhdmoe.com",
               "path": "/search", "param": "q", "kind": "third_party_index",
               "note": "已核对公开目录与集数；同名主体关系、授权、画质及实际播放未核实。"},
    "fcma": {"id": "fcma", "name": "风车动漫 · fcma.cc", "host": "www.fcma.cc",
             "path": "/public/auto/search1.html", "param": "keyword", "kind": "third_party_index",
             "note": "已核对公开目录与选集链接；同名主体关系、授权、画质及实际播放未核实。"},
    "ddys": {"id": "ddys", "name": "低端影视 · ddys.io", "host": "ddys.io",
             "path": "/api/v1/search", "param": "q", "kind": "third_party_index",
             "note": "公开 API 目录；进入原站选择线路和集数。与其他同名站的关系、内容授权及画质未核实。"},
}
PROVIDERS.update(catalog_sources.PROVIDERS)
MAX_BYTES = 1024 * 1024
MAX_RESULTS = 12
MAX_EPISODES = 6000
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
            for p in PROVIDERS.values() if p["id"] not in disabled and p["id"] not in RETIRED_PROVIDERS]


def _text(value, limit=160):
    if not isinstance(value, str):
        return ""
    # Also remove directional overrides from untrusted result titles.
    return re.sub(r"[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]", " ",
                  " ".join(value.split()))[:limit].strip()


def detail_url(provider, value):
    if provider['id'] == 'kanju':
        item = catalog_sources.detail_item('kanju', value)
        return 'https://www.kanju.ai/player/' + quote(item, safe='-_') if item else None
    if provider['id'] in catalog_sources.PROVIDERS:
        return ('https://' + provider['host'] + catalog_sources.public_path(provider['id'], value)
                if catalog_sources.detail_item(provider['id'], value) else None)
    if not isinstance(value, str) or len(value) > 500 or "\\" in value:
        return None
    try:
        parsed = urlsplit(urljoin("https://" + provider["host"], value))
        if (parsed.scheme != "https" or parsed.netloc != provider["host"]
                or parsed.query or parsed.fragment):
            return None
        patterns = {"huarw": r"/movie/[0-9]+", "cupfox": r"/vod-detail/[0-9]+\.html",
                    "yhdmoe": r"/watch/[0-9]{1,20}", "fcma": r"/v/[0-9]{1,20}/[0-9]{1,5}",
                    "blender": r"/videos/watch/[0-9a-f-]{36}",
                    "ddys": r"/movie/[a-z0-9][a-z0-9-]{0,119}"}
        return parsed.geturl() if re.fullmatch(patterns[provider["id"]], parsed.path) else None
    except ValueError:
        return None


def _fetch(provider, query):
    params = {provider["param"]: query}
    if provider["id"] == "blender":
        params.update(count=30, start=0)
    if provider["id"] == "ddys":
        params.update(type="movie", per_page=MAX_RESULTS)
    path = provider["path"] + "?" + urlencode(params)
    return _fetch_path(provider, path)


def _fetch_path(provider, path, *, expect_json=None):
    """Only callers with code-owned hosts and validated paths may use this transport."""
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
    expects_json = provider["id"] in {"blender", "ddys"} if expect_json is None else expect_json
    deadline = time.monotonic() + 8
    try:
        response = pool.urlopen("GET", path, headers={
            "Host": host, "User-Agent": "TogetherWatch-MetadataSearch/1.0",
            "Accept": "application/json" if expects_json else "text/html",
            "Accept-Encoding": "identity",
        }, timeout=urllib3.Timeout(connect=3, read=3), redirect=False, retries=False,
            preload_content=False, decode_content=False)
        if response.status != 200:
            raise SearchFailure("upstream_unavailable")
        content_type = response.headers.get("Content-Type", "").lower()
        expected = "application/json" if expects_json else "text/html"
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
        if attrs.get("id") == "search_list" or "module-card-items" in classes:
            self.saw_results = True
        source = self.provider["id"]
        is_card = {"cupfox": "movie-list-item" in classes,
                   "huarw": "public-list-box" in classes and "search-box" in classes,
                   "yhdmoe": "card" in classes and any(a.get("id") == "search_list" for _, a in self.stack),
                   "fcma": "module-card-item" in classes}.get(source, False)
        if self.card is None and is_card:
            self.card = {"depth": len(self.stack), "title": [], "year": [], "episode": [], "links": [], "poster": None}
        if self.card is not None and tag == "img" and not self.card["poster"]:
            self.card["poster"] = next((url for key in ('data-original', 'data-src', 'data-lazy-src', 'src')
                                       if (url := poster_url(attrs.get(key), 'https://' + self.provider['host']))), None)
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
        if any(tag == "h3" or set(attrs.get("class", "").split()) & {"movie-title", "age-anime-title", "module-card-item-title"} for tag, attrs in entries):
            self.card["title"].append(data)
        if any(attrs.get("href", "").startswith("/search/year/") for _, attrs in entries):
            self.card["year"].append(data)
        if any(set(attrs.get("class", "").split()) & {"public-list-prb", "module-item-note"} for _, attrs in entries):
            self.card["episode"].append(data)

    def handle_endtag(self, tag):
        index = next((i for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if index is None:
            return
        del self.stack[index:]
        if self.card is not None and len(self.stack) <= self.card["depth"]:
            self.cards.append(self.card)
            self.card = None


def _row(provider, title, url, year=None, episode="", duration=None, poster=None):
    return {"title": title, "page_url": url, "year": year, "episode_label": episode,
            "duration_seconds": duration, "source_id": provider["id"], "source_name": provider["name"],
            "playback_verified": False, "synchronization_verified": False,
            "quality": "未核实", "access": "以原站为准", "kind": provider["kind"],
            "poster_url": poster_url(poster, 'https://' + provider['host'])}


def parse_results(provider, body, query):
    if provider['id'] in catalog_sources.PROVIDERS:
        status, rows = catalog_sources.search_rows(provider['id'], body, query)
        if status != 'ok':
            raise SearchFailure(status)
        return rows
    if provider["id"] == "ddys":
        payload = json.loads(body)
        if not isinstance(payload, dict) or payload.get("success") is not True or not isinstance(payload.get("data"), list):
            raise SearchFailure("layout_changed")
        rows, seen = [], set()
        for item in payload["data"][:50]:
            if not isinstance(item, dict):
                continue
            title = _text(item.get("title"))
            searchable = (title + " " + _text(item.get("aka"))).casefold()
            url = detail_url(provider, item.get("url"))
            slug = item.get("slug")
            if (not title or not url or not isinstance(slug, str) or urlsplit(url).path != "/movie/" + slug
                    or url in seen or not all(word in searchable for word in query.casefold().split())):
                continue
            seen.add(url)
            year = str(item.get("year", ""))
            rows.append(_row(provider, title, url, year if re.fullmatch(r"(?:19|20)[0-9]{2}", year) else None,
                             "原站选集 · " + _text(item.get("type"), 16), poster=item.get('poster')))
        return rows[:MAX_RESULTS]
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
                rows.append(_row(provider, title, url, duration=duration if type(duration) is int and 0 < duration < 86400 else None,
                                 poster=video.get('thumbnailPath')))
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
                         _text("".join(card["episode"]), 50), poster=card['poster']))
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
    if source_id == 'kanju':
        # The original application signs its own requests. Never emulate that
        # signature or forward a user's credentials through our server.
        return dict(source_id=source_id, query=query, status='client_required', results=[], cached=False)
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
    except SearchFailure as exc:
        result['status'] = str(exc) if str(exc) in {'verification_required', 'access_blocked'} else 'unavailable'
    except (urllib3.exceptions.HTTPError, OSError, ValueError, TypeError, RecursionError):
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


def selection_path(source, item, episode):
    """Local handoff, not a media URL; the installed client opens its own video view."""
    if not isinstance(item, str) or not isinstance(episode, str):
        return None
    if source in catalog_sources.PROVIDERS:
        return f'/discover/play/{source}/{item}/{episode}' if catalog_sources.selection(source, item, episode) else None
    if source == "cupfox" and re.fullmatch(r"[0-9]{1,20}", item) and re.fullmatch(r"ep[0-9]{1,5}", episode):
        return f"/discover/play/{source}/{item}/{episode}"
    if source == "huarw" and re.fullmatch(r"[0-9]{1,20}", item) and re.fullmatch(re.escape(item) + r"(?:-[0-9]{1,5}){1,3}", episode):
        return f"/discover/play/{source}/{item}/{episode}"
    if source == "blender" and re.fullmatch(r"[0-9a-f-]{36}", item) and episode == "video":
        return f"/discover/play/{source}/{item}/{episode}"
    if source == "yhdmoe" and re.fullmatch(r"[0-9]{1,20}", item) and re.fullmatch(r"EP[0-9]{1,5}(?:\.[0-9]{1,2})?", episode):
        return f"/discover/play/{source}/{item}/{episode}"
    if source == "fcma" and re.fullmatch(r"[0-9]{1,20}-[0-9]{1,5}", item) and re.fullmatch(r"[0-9]{1,20}", episode):
        return f"/discover/play/{source}/{item}/{episode}"
    if source == "ddys" and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,119}", item) and episode == "page":
        return f"/discover/play/{source}/{item}/{episode}"
    return None


def selection_page(source, item, episode):
    if not selection_path(source, item, episode):
        return None
    if source in catalog_sources.PROVIDERS:
        return catalog_sources.selection(source, item, episode)
    return {"cupfox": f"https://www.cupfox.in/vod-detail/{item}.html",
            "huarw": f"https://huarw.com/play/{episode}",
            "yhdmoe": f"https://yhdmoe.com/watch/{item}#play_ep_{episode}",
            "fcma": f"https://www.fcma.cc/p/{item.replace('-', '/')}/{episode}",
            "ddys": f"https://ddys.io/movie/{item}",
            "blender": f"https://video.blender.org/videos/watch/{item}"}[source]


class _PlainDescription(HTMLParser):
    """Plain visible text only, never return API-provided HTML to the browser."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.ignored = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.ignored += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.ignored = max(0, self.ignored - 1)

    def handle_data(self, value):
        if not self.ignored:
            self.parts.append(value)


class _EpisodeMetadata(HTMLParser):
    """Keep only description/title and public episode controls; discard all scripts."""
    def __init__(self, source, item):
        super().__init__(convert_charrefs=True)
        self.source, self.item = source, item
        self.title, self.description, self.episodes = [], "", []
        self.in_title, self.active, self.ignored = False, None, 0
        self.seen, self.line, self.truncated = set(), "", False
        self.line_index, self.line_names = 0, []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in {"script", "style"}:
            self.ignored += 1
        if self.ignored:
            return
        if tag == "title":
            self.in_title = True
        if tag == "meta" and attrs.get("name") == "description":
            self.description = _text(attrs.get("content"), 500)
        token = None
        if self.source == "fcma" and "module-tab-item" in attrs.get("class", "").split():
            self.line_names.append(_text(attrs.get("data-dropdown-value"), 20))
        if self.source == "fcma" and "module-list" in attrs.get("class", "").split() and re.fullmatch(r"panel[0-9]+", attrs.get("id", "")):
            # Upstream repeats id="panel1" on every line; use document order.
            self.line_index += 1
            name = self.line_names[self.line_index - 1] if self.line_index <= len(self.line_names) else ""
            self.line = "线路 " + str(self.line_index) + (" · " + name if name else "")
        if self.source == "yhdmoe" and tag == "a" and "my-episode" in attrs.get("class", "").split():
            candidate = attrs.get("play_ep", "")
            if attrs.get("href") == "#play_ep_" + candidate:
                token = candidate
        if self.source == "fcma" and tag == "a" and "module-play-list-link" in attrs.get("class", "").split():
            url = urlsplit(urljoin("https://www.fcma.cc", attrs.get("href", "")))
            prefix = "/p/" + self.item.replace("-", "/") + "/"
            if url.scheme == "https" and url.netloc == "www.fcma.cc" and not url.query and not url.fragment and url.path.startswith(prefix):
                token = url.path.removeprefix(prefix)
        if self.source == "cupfox" and tag == "span" and "play-btn" in attrs.get("class", "").split():
            token = attrs.get("ep_slug", "")
        if self.source == "huarw" and tag == "a":
            url = urlsplit(urljoin("https://huarw.com", attrs.get("href", "")))
            if url.scheme == "https" and url.netloc == "huarw.com" and not url.query and not url.fragment and url.path.startswith("/play/"):
                token = url.path.removeprefix("/play/")
        if token and selection_path(self.source, self.item, token):
            self.active = {"tag": tag, "id": token, "text": [], "line": self.line}

    def handle_data(self, value):
        if self.ignored:
            return
        if self.in_title:
            self.title.append(value)
        if self.active:
            self.active["text"].append(value)

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.ignored = max(0, self.ignored - 1)
        if tag == "title":
            self.in_title = False
        if self.active and tag == self.active["tag"]:
            token = self.active["id"]
            title = _text("".join(self.active["text"]), 60)
            if title and token not in self.seen:
                self.seen.add(token)
                if len(self.episodes) < MAX_EPISODES:
                    self.episodes.append({"id": token, "title": title, "line": self.active["line"],
                                          "launch_path": selection_path(self.source, self.item, token)})
                else:
                    self.truncated = True
            self.active = None


def load_detail(source, page):
    provider = PROVIDERS[source]
    page = detail_url(provider, page)
    if not page:
        raise ValueError("invalid detail")
    item = (catalog_sources.detail_item(source, page) if source in catalog_sources.PROVIDERS else
            "-".join(urlsplit(page).path.split("/")[2:]) if source == "fcma" else page.rsplit("/", 1)[-1].removesuffix(".html"))
    key = ("detail", source, item)
    now = time.monotonic()
    base = {"source_id": source, "item_id": item, "page_url": page, "status": "ok", "title": "",
            "description": "", "episodes": [], "truncated": False, "cached": False, "playback_verified": False}
    if source == 'kanju':
        return {**base, 'status': 'client_required'}
    with _lock:
        for old in [k for k, (expiry, _) in _cache.items() if expiry <= now]:
            del _cache[old]
        if key in _cache:
            return {**deepcopy(_cache[key][1]), "cached": True}
        if key in _inflight or not _slots.acquire(blocking=False):
            return {**base, "status": "busy"}
        _inflight.add(key)
    try:
        if source in catalog_sources.PROVIDERS:
            base.update(catalog_sources.detail_rows(source, item, _fetch_path(provider, urlsplit(page).path)))
        elif source == "ddys":
            payload = json.loads(_fetch_path(provider, "/api/v1/movies/" + item))
            if not isinstance(payload, dict) or payload.get("success") is not True:
                raise SearchFailure("layout_changed")
            data = payload.get("data")
            if (not isinstance(data, dict) or data.get("slug") != item
                    or detail_url(provider, data.get("url")) != page):
                raise SearchFailure("unexpected_item")
            description = _PlainDescription()
            description.feed(data.get("intro") if isinstance(data.get("intro"), str) else "")
            count = data.get("online_sources_count")
            base.update(title=_text(data.get("title")), description=_text(" ".join(description.parts), 260),
                        selection_mode="original_page")
            if type(count) is int and count > 0:
                base["episodes"] = [{"id": "page", "title": "进入原站选择线路 / 集数",
                                     "launch_path": selection_path(source, item, "page")}]
            else:
                base["status"] = "no_episodes"
        elif source == "blender":
            data = json.loads(_fetch_path(provider, "/api/v1/videos/" + item))
            channel = data.get("channel") or {}
            if channel.get("name") != "blender_open_movies" or channel.get("host") != provider["host"]:
                raise SearchFailure("unexpected_channel")
            base.update(title=_text(data.get("name")), description=_text(data.get("description"), 500),
                        episodes=[{"id": "video", "title": "打开视频", "launch_path": selection_path(source, item, "video")}])
        else:
            parser = _EpisodeMetadata(source, item)
            parser.feed(_fetch_path(provider, urlsplit(page).path))
            base.update(title=_text("".join(parser.title)), description=parser.description, episodes=parser.episodes, truncated=parser.truncated)
            if source == "cupfox":
                base["episodes"].sort(key=lambda e: int(e["id"][2:]))
            if source == "yhdmoe":
                base["episodes"].sort(key=lambda e: float(e["id"][2:]))
            if not base["episodes"]:
                base["status"] = "no_episodes"
    except (SearchFailure, urllib3.exceptions.HTTPError, OSError, ValueError, TypeError, AttributeError, RecursionError):
        base["status"] = "unavailable"
    finally:
        with _lock:
            _inflight.discard(key)
            _cache[key] = (time.monotonic() + (CACHE_TTL if base["status"] == "ok" else FAILURE_TTL), deepcopy(base))
            while len(_cache) > MAX_CACHE_KEYS:
                _cache.popitem(last=False)
        _slots.release()
    return base
