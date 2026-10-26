"""Bounded public catalogue pages, not a ranking, media proxy or playback claim."""
from collections import OrderedDict
from copy import deepcopy
from html.parser import HTMLParser
import re
import threading
import time
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit

import urllib3
import source_search as search
from poster_policy import poster_candidates, poster_attribute_candidates

VERSION = '20261021-live-catalog'
MAX_PAGE = 1000
MAX_ROWS = 60
TTL, FAILURE_TTL, MAX_CACHE = 600, 20, 192
CATEGORIES = ('all', 'movie', 'series', 'animation', 'documentary')
FEEDS = {
    'ddys': dict(categories=CATEGORIES, paginated=True),
    'cupfox': dict(categories=('all', 'movie', 'series', 'animation'), paginated=False),
    'yhdmoe': dict(categories=('all', 'animation'), paginated=True),
}
_cache, _inflight, _lock = OrderedDict(), set(), threading.Lock()


def feed_choices(enabled):
    return [dict(id=p['id'], name=p['name'], categories=FEEDS[p['id']]['categories'])
            for p in enabled if p['id'] in FEEDS]


def page_path(source, category, page):
    if (source not in FEEDS or category not in FEEDS[source]['categories']
            or type(page) is not int or not 1 <= page <= MAX_PAGE):
        raise ValueError('invalid catalogue page')
    if source == 'ddys':
        base = {'all': '', 'movie': '/movie', 'series': '/series',
                'animation': '/anime', 'documentary': '/genre/documentary'}[category]
        return (base or '/') if page == 1 else base + '/page/' + str(page)
    if source == 'yhdmoe':
        return '/catalog?' + urlencode(dict(country_flag='', type='', year='', genre='', status='', sort='hot', page=page))
    if page != 1:
        raise ValueError('single-page catalogue')
    return {'all': '/', 'movie': '/type/movie/', 'series': '/type/tv/', 'animation': '/type/anime/'}[category]


def _equivalent_page(url, wanted):
    try:
        a, b = urlsplit(url), urlsplit(wanted)
        return (a.scheme == b.scheme == 'https' and a.netloc == b.netloc and not a.fragment
                and a.path == b.path and parse_qs(a.query, keep_blank_values=True) == parse_qs(b.query, keep_blank_values=True))
    except ValueError:
        return False


class CatalogueParser(HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self, source, category, page):
        super().__init__(convert_charrefs=True)
        self.source, self.category = source, category
        self.provider = search.PROVIDERS[source]
        self.origin = 'https://' + self.provider['host']
        self.stack, self.cards, self.card, self.titles = [], [], None, []
        self.recognized, self.empty, self.has_next = False, False, False
        self.next_url = (self.origin + page_path(source, category, page + 1)
                         if FEEDS[source]['paginated'] and page < MAX_PAGE else None)

    def handle_starttag(self, tag, attrs):
        attrs = {key: value or '' for key, value in attrs}
        if tag not in self.VOID:
            self.stack.append((tag, attrs))
        if any(t in ('script', 'style', 'template') for t, _ in self.stack):
            return
        classes = attrs.get('class', '').split()
        is_card = ((self.source == 'ddys' and 'movie-card' in classes)
                   or (self.source == 'cupfox' and 'movie-list-item' in classes)
                   or (self.source == 'yhdmoe' and 'card' in classes
                       and any(a.get('id') == 'catalog_list' for _, a in self.stack)))
        if is_card and self.card is None:
            self.recognized = True
            self.card = dict(depth=len(self.stack), title=[], text=[], page=None, poster=[])
        if attrs.get('id') == 'catalog_list' or 'movie-list-body' in classes:
            self.recognized = True
        if tag == 'a':
            href = attrs.get('href', '')
            if self.next_url and _equivalent_page(urljoin(self.origin, href), self.next_url):
                self.has_next = True
            if self.card is not None and self.card['page'] is None:
                self.card['page'] = search.detail_url(self.provider, href)
        if self.card is not None:
            self.card['poster'] = poster_candidates(self.card['poster'] + poster_attribute_candidates(attrs, self.origin), self.origin)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_data(self, data):
        if any(t in ('script', 'style', 'template') for t, _ in self.stack):
            return
        if any(t == 'title' for t, _ in self.stack):
            self.titles.append(data)
        if any(x in data for x in ('暂无数据', '没有找到', '暂无相关')):
            self.empty = True
        if self.card is not None:
            self.card['text'].append(data)
            if any(t in ('h3', 'h6') or 'movie-title' in a.get('class', '').split() for t, a in self.stack[self.card['depth']:]):
                self.card['title'].append(data)

    def handle_endtag(self, tag):
        index = next((i for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if index is None:
            return
        if self.card is not None and index < self.card['depth']:
            if len(self.cards) < 200:
                self.cards.append(self.card)
            self.card = None
        del self.stack[index:]


def parse_page(source, category, page, body):
    parser = CatalogueParser(source, category, page)
    parser.feed(body)
    title = ' '.join(parser.titles)
    if re.search(r'安全验证|安全检查|just a moment|security check|attention required', title, re.I):
        raise search.SearchFailure('verification_required')
    if not parser.recognized and not parser.empty:
        raise search.SearchFailure('layout_changed')
    rows, seen = [], set()
    for card in parser.cards:
        title, text, url = search._text(''.join(card['title'])), ' '.join(card['text']), card['page']
        if not title or not url or url in seen:
            continue
        seen.add(url)
        if source == 'yhdmoe' and re.search(r'播放状态\s*未播放', text):
            continue
        year_match = (re.search(r'年份\s*((?:19|20)\d{2})', text) if source == 'yhdmoe'
                      else re.search(r'\b((?:19|20)\d{2})\s*·', text))
        year = year_match[1] if year_match else None
        genre = '动漫' if source == 'yhdmoe' else ''
        if source == 'ddys':
            match = re.search(r'\b(?:19|20)\d{2}\s*·\s*(电影|剧集|动漫|纪录片|综艺)', text)
            genre = match[1] if match else ''
        row = search._row(parser.provider, title, url, year, poster=card['poster'])
        row.update(category=category, genre=genre)
        rows.append(row)
    if parser.cards and not seen:
        raise search.SearchFailure('layout_changed')
    if len(rows) > MAX_ROWS:
        raise search.SearchFailure('page_too_large')
    return rows, parser.has_next


def load_page(source, category, page):
    path = page_path(source, category, page)
    key, now = (source, category, page), time.monotonic()
    base = dict(source_id=source, category=category, page=page, status='ok', results=[],
                has_more=False, next_page=None, cached=False, version=VERSION, page_limit=False)
    with _lock:
        for old in [k for k, (expiry, _) in _cache.items() if expiry <= now]:
            del _cache[old]
        if key in _cache:
            return {**deepcopy(_cache[key][1]), 'cached': True}
        if key in _inflight or not search._slots.acquire(blocking=False):
            return {**base, 'status': 'busy'}
        _inflight.add(key)
    try:
        body = search._fetch_path(search.PROVIDERS[source], path, expect_json=False)
        rows, more = parse_page(source, category, page, body)
        base.update(results=rows, has_more=more, next_page=page + 1 if more else None,
                    page_limit=page == MAX_PAGE, fetched_at=int(time.time()))
    except search.SearchFailure as exc:
        base['status'] = 'verification_required' if str(exc) == 'verification_required' else 'unavailable'
    except (urllib3.exceptions.HTTPError, OSError, ValueError, TypeError, RecursionError):
        base['status'] = 'unavailable'
    finally:
        with _lock:
            _inflight.discard(key)
            _cache[key] = (time.monotonic() + (TTL if base['status'] == 'ok' else FAILURE_TTL), deepcopy(base))
            while len(_cache) > MAX_CACHE:
                _cache.popitem(last=False)
        search._slots.release()
    return base
