"""Public catalogue/episode adapters; never inspect or fetch media URLs."""
import re
from html.parser import HTMLParser
from urllib.parse import quote, unquote, urljoin, urlsplit
from poster_policy import poster_url

PROVIDERS = {
    'kanju': dict(id='kanju', name='看剧 AI · Windows', host='www.kanju.ai', path='/collections/browse', param='q',
                  kind='third_party_index', note='Windows 0.6.0 本机读取原站目录和已加载集数；网页端不代签请求。实际片源与播放待原站确认。'),
    '233dm': dict(id='233dm', name='233 动漫', host='www.233dm.com', path='/search/-------------.html', param='wd',
                  kind='third_party_index', note='已适配搜索、选集和邀请同集；Windows 0.5.0 支持原站验证后继续查询，实际播放待核实。'),
    'pkavi': dict(id='pkavi', name='七味网', host='www.pkavi.com', path='/vs/-------------.html', param='wd',
                  kind='third_party_index', note='已适配搜索、选集和邀请同集；Windows 0.5.0 支持原站验证后继续查询，实际播放待核实。'),
}
PUBLIC_ID = r'[A-Za-z0-9_-]{1,160}(?::[A-Za-z0-9_-]{1,80})?'
DETAIL = {'233dm': r'/anime/([a-f0-9]{24})\.html', 'pkavi': r'/mv/([1-9][0-9]{0,19})\.html',
          'kanju': r'/player/(' + PUBLIC_ID + ')'}
PLAY = {'233dm': r'/anime/([a-f0-9]{24})/play/([1-9][0-9]{0,4})/([1-9][0-9]{0,4})\.html',
        'pkavi': r'/py/([1-9][0-9]{0,19})-([1-9][0-9]{0,4})-([1-9][0-9]{0,4})\.html'}


def clean(value, size=160):
    return re.sub(r'[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]', ' ', ' '.join(value.split()))[:size] if isinstance(value, str) else ''


def public_path(source, value):
    if source not in PROVIDERS or not isinstance(value, str) or len(value) > 1024 or '\\' in value:
        return None
    try:
        url = urlsplit(urljoin('https://' + PROVIDERS[source]['host'], value))
        return url.path if url.scheme == 'https' and url.netloc == PROVIDERS[source]['host'] and not url.query and not url.fragment else None
    except ValueError:
        return None


def detail_item(source, value):
    path = public_path(source, value)
    match = re.fullmatch(DETAIL[source], unquote(path) if source == 'kanju' else path) if path else None
    return match[1] if match else None


def selection(source, item, episode):
    if source not in PROVIDERS or not isinstance(item, str) or not isinstance(episode, str):
        return None
    if source == 'kanju':
        if not re.fullmatch(PUBLIC_ID, item) or not episode.startswith('ep-') or not re.fullmatch(PUBLIC_ID, episode[3:]):
            return None
        return f'https://www.kanju.ai/player/{quote(item, safe="-_")}?episode={quote(episode[3:], safe="-_")}'
    if not re.fullmatch(r'[1-9][0-9]{0,4}-[1-9][0-9]{0,4}', episode):
        return None
    line, number = episode.split('-')
    if source == '233dm' and re.fullmatch(r'[a-f0-9]{24}', item):
        return f'https://www.233dm.com/anime/{item}/play/{line}/{number}.html'
    if source == 'pkavi' and re.fullmatch(r'[1-9][0-9]{0,19}', item):
        return f'https://www.pkavi.com/py/{item}-{line}-{number}.html'
    return None


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self.anchor, self.title, self.description = [], None, [], ''
        self.ignored, self.in_title, self.empty = 0, False, False
        self.blocked_text = False
        self.challenge_text = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style'): self.ignored += 1
        if self.ignored: return
        if tag == 'title': self.in_title = True
        if tag == 'meta' and attrs.get('name') == 'description': self.description = clean(attrs.get('content'), 500)
        if tag == 'a': self.anchor = dict(href=attrs.get('href', ''), title=attrs.get('title', ''), text=[], images=[])
        if tag == 'img' and self.anchor is not None:
            self.anchor['images'].extend(attrs.get(k) for k in ('data-original', 'data-src', 'data-lazy-src', 'src'))
            if not self.anchor['title']: self.anchor['title'] = attrs.get('alt', '')

    def handle_data(self, data):
        if self.ignored: return
        if self.in_title: self.title.append(data)
        if self.anchor is not None: self.anchor['text'].append(data)
        if any(s in data for s in ('没有找到', '暂无数据', '没有相关', '暂无相关')): self.empty = True
        if re.search(r'sorry, you have been blocked|you are unable to access|access denied|访问被拒绝', data, re.I): self.blocked_text = True
        if re.search(r'正在进行安全验证|验证您不是自动程序', data): self.challenge_text = True

    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.ignored = max(0, self.ignored - 1)
        if self.ignored: return
        if tag == 'title': self.in_title = False
        if tag == 'a' and self.anchor is not None:
            if len(self.links) < 15000: self.links.append(self.anchor)
            self.anchor = None

    @property
    def blocked(self):
        return self.blocked_text and bool(re.search(r'attention required|access denied|访问被拒绝', ''.join(self.title), re.I))

    @property
    def challenge(self):
        title = ''.join(self.title)
        return bool(re.search(r'系统安全验证|安全检查|just a moment|security check|attention required', title, re.I)
                    or self.challenge_text and '请稍候' in title)


def search_rows(source, body, query):
    p = Metadata(); p.feed(body)
    if p.blocked: return 'access_blocked', []
    if p.challenge: return 'verification_required', []
    rows, seen, recognized = [], set(), False
    # A poster anchor and a title anchor may be separate links to the same film.
    covers = {}
    for a in p.links:
        item = detail_item(source, a['href'])
        cover = next((url for v in a['images'] if (url := poster_url(v, 'https://' + PROVIDERS[source]['host']))), None)
        if item and cover: covers.setdefault(item, cover)
    for a in p.links:
        item = detail_item(source, a['href'])
        if not item: continue
        recognized = True
        title = clean(a['title'] or ''.join(a['text']))
        if not title or item in seen or not all(t in title.casefold() for t in query.casefold().split()): continue
        seen.add(item)
        rows.append(dict(title=title, page_url='https://' + PROVIDERS[source]['host'] + public_path(source, a['href']),
                         source_id=source, source_name=PROVIDERS[source]['name'], playback_verified=False,
                         synchronization_verified=False, quality='未核实', access='以原站为准', kind='third_party_index',
                         poster_url=covers.get(item)))
        if len(rows) >= 12: break
    return ('ok' if recognized or p.empty else 'unavailable'), rows


def detail_rows(source, item, body):
    p = Metadata(); p.feed(body)
    result = dict(title=clean(''.join(p.title)), description=p.description, episodes=[], status='no_episodes')
    if p.blocked: return {**result, 'status': 'access_blocked'}
    if p.challenge: return {**result, 'status': 'verification_required'}
    seen = set()
    for a in p.links:
        path = public_path(source, a['href'])
        match = re.fullmatch(PLAY[source], path) if path else None
        if not match or match[1] != item: continue
        episode = match[2] + '-' + match[3]
        label = clean(''.join(a['text']), 60)
        if not label or episode in seen or re.search('立即播放|马上播放', label): continue
        seen.add(episode)
        result['episodes'].append(dict(id=episode, title=label, line='线路 ' + match[2],
                                      launch_path=f'/discover/play/{source}/{item}/{episode}'))
        if len(result['episodes']) >= 6000: break
    if result['episodes']: result['status'] = 'ok'
    return result
