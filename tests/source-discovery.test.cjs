const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeQuery, matches, searchUrl, sourceMatches, safeResultUrl, createLiveSearch, init } = require('../static/js/source-discovery.js');

test('local title search normalizes Chinese aliases, width, case, whitespace and bounds', () => {
    assert.equal(normalizeQuery('  ＳＩＮＴＥＬ\n\t 春天\0 '), 'SINTEL 春天');
    assert.equal(normalizeQuery('春'.repeat(100)).length, 80);
    assert.equal(Array.from(normalizeQuery('😀'.repeat(100))).length, 80);
    assert.ok(matches('Big Buck Bunny 大雄兔', 'ｂｉｇ bunny'));
    assert.ok(matches('Sintel 辛特尔', '辛特尔'));
    assert.ok(matches('Sintel', ''));
    assert.equal(matches('Spring', 'Sintel'), false);
});

test('official search links encode untrusted text without leaking extra query parameters', () => {
    const query = '春天 &q=other # / ? <script> "';
    const result = new URL(searchUrl('https://search.bilibili.com/all', 'keyword', 'https://www.bilibili.com/', query));
    assert.equal(result.hostname, 'search.bilibili.com');
    assert.equal(result.searchParams.get('keyword'), query);
    assert.equal(result.searchParams.size, 1);
    assert.equal(result.hash, '');
    assert.equal(decodeURIComponent(searchUrl('https://so.youku.com/search_video/q_', '', '', query).split('q_')[1]), query);
    assert.equal(searchUrl('https://v.qq.com/x/search/', 'q', 'https://v.qq.com/', ''), 'https://v.qq.com/');
    assert.throws(() => searchUrl('javascript:alert(1)', 'q', '', 'film'));
});

test('4K filter needs explicit evidence and category matches whole identifiers', () => {
    assert.ok(sourceMatches('movie animation', 'animation', 'false', 'all'));
    assert.equal(sourceMatches('movie animation', 'series', 'true', 'all'), false);
    assert.equal(sourceMatches('movie animation', 'movie', undefined, '4k'), false);
    assert.equal(sourceMatches('movie animation', 'movie', 'false', '4k'), false);
    assert.equal(sourceMatches('movie animation', 'ani', 'true', 'all'), false);
    assert.ok(sourceMatches('series', 'all', 'true', '4k'));
});

function fixture() {
    const elements = new Map();
    const el = () => ({ dataset: {}, value: '', hidden: false, textContent: '', listeners: {},
        addEventListener(type, fn) { this.listeners[type] = fn; }, focus() { this.focused = true; }, select() { this.selected = true; } });
    for (const id of ['sourceDiscovery', 'discoveryQuery', 'discoveryForm', 'discoveryFeedback', 'discoveryCopyFallback',
        'discoveryClear', 'discoveryCopyValue', 'discoveryResultCount', 'discoveryEmpty', 'discoverySourceType',
        'discoveryQuality', 'discoverySourceCount', 'discoverySourceEmpty']) elements.set(id, el());
    elements.get('discoverySourceType').value = 'all';
    elements.get('discoveryQuality').value = 'all';
    const cards = ['Sintel 辛特尔', 'Big Buck Bunny 大雄兔'].map((text, index) =>
        Object.assign(el(), { dataset: { searchText: text, has4k: index === 1 ? 'true' : 'false' } }));
    const sourceCards = [
        { sourceGenres: 'movie animation', has4k: 'false' },
        { sourceGenres: 'series', has4k: 'true' },
    ].map(dataset => Object.assign(el(), { dataset }));
    const copy = el();
    const link = Object.assign(el(), { href: '', dataset: { platformName: '哔哩哔哩', searchBase: 'https://search.bilibili.com/all', searchParam: 'keyword', searchHome: 'https://www.bilibili.com/' },
        parentElement: { querySelector() { return copy; } } });
    const sourceCopy = el();
    const sourceLink = Object.assign(el(), { href: 'https://tv.cctv.com/4K/index.shtml',
        parentElement: { querySelector() { return sourceCopy; } } });
    const collections = { '[data-search-text]': cards, '[data-search-base]': [link],
        '[data-source-genres]': sourceCards, '[data-copy-link]': [link, sourceLink] };
    elements.get('sourceDiscovery').querySelectorAll = selector => collections[selector] || [];
    const doc = { getElementById: id => elements.get(id) };
    init(doc);
    return { elements, cards, copy, link, doc, sourceCards, sourceCopy, sourceLink };
}

test('typing and clearing updates real local counts and official links without navigating or loading media', () => {
    const { elements, cards, link } = fixture();
    const query = elements.get('discoveryQuery');
    query.value = '辛特尔'; query.listeners.input();
    assert.deepEqual(cards.map(c => c.hidden), [false, true]);
    assert.equal(elements.get('discoveryResultCount').textContent, '本地目录匹配 1 / 2 部');
    assert.equal(new URL(link.href).searchParams.get('keyword'), '辛特尔');
    query.value = '<img onerror=x>'; query.listeners.input();
    assert.ok(elements.get('discoveryEmpty').hidden === false);
    assert.ok(cards.every(c => c.hidden));
    let prevented = false;
    elements.get('discoveryForm').listeners.submit({ preventDefault() { prevented = true; } });
    assert.ok(prevented);
    elements.get('discoveryClear').listeners.click();
    assert.equal(query.value, '');
    assert.ok(cards.every(c => !c.hidden));
    assert.equal(link.textContent, '打开哔哩哔哩');
});

test('clipboard failure gives a selected manual-copy address instead of a dead button', async () => {
    const { elements, copy, link } = fixture();
    await copy.listeners.click(); // Node has no usable Clipboard API.
    assert.equal(elements.get('discoveryCopyFallback').hidden, false);
    assert.equal(elements.get('discoveryCopyValue').value, link.href);
    assert.equal(elements.get('discoveryCopyValue').selected, true);
});

test('genre and quality filter navigation while title input keeps portals independent', () => {
    const { elements, cards, sourceCards, sourceLink } = fixture();
    const genre = elements.get('discoverySourceType');
    const quality = elements.get('discoveryQuality');
    genre.value = 'animation'; genre.listeners.change();
    assert.deepEqual(sourceCards.map(c => c.hidden), [false, true]);
    assert.ok(cards.every(c => !c.hidden)); // Genre applies only to portal navigation.
    quality.value = '4k'; quality.listeners.change();
    assert.ok(sourceCards.every(c => c.hidden));
    assert.equal(elements.get('discoverySourceCount').textContent, '导航显示 0 / 2 个入口');
    assert.equal(elements.get('discoverySourceEmpty').hidden, false);
    assert.deepEqual(cards.map(c => c.hidden), [true, false]);
    genre.value = 'series'; genre.listeners.change();
    assert.deepEqual(sourceCards.map(c => c.hidden), [true, false]);
    assert.equal(elements.get('discoverySourceEmpty').hidden, true);
    const query = elements.get('discoveryQuery');
    query.value = 'missing title'; query.listeners.input();
    assert.ok(cards.every(c => c.hidden));
    assert.deepEqual(sourceCards.map(c => c.hidden), [true, false]);
    assert.equal(sourceLink.href, 'https://tv.cctv.com/4K/index.shtml');
    elements.get('discoveryClear').listeners.click();
    assert.equal(genre.value, 'all');
    assert.equal(quality.value, 'all');
    assert.ok([...cards, ...sourceCards].every(c => !c.hidden));
    assert.equal(query.focused, true);
});

test('portal links get the same manual clipboard fallback as search links', async () => {
    const { elements, sourceCopy, sourceLink } = fixture();
    await sourceCopy.listeners.click();
    assert.equal(elements.get('discoveryCopyFallback').hidden, false);
    assert.equal(elements.get('discoveryCopyValue').value, sourceLink.href);
    assert.equal(elements.get('discoveryCopyValue').selected, true);
});

test('other pages without the component are unaffected', () => {
    assert.doesNotThrow(() => init({ getElementById() { return null; } }));
});

function liveFixture(fetcher) {
    const make = (tag = 'div') => ({ tag, dataset: {}, value: '', checked: true, hidden: false, children: [], textContent: '', listeners: {},
        append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; },
        addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute(name, value) { this[name] = value; }, focus() {}, select() { this.selected = true; } });
    const elements = new Map();
    for (const id of ['sourceDiscovery', 'discoveryLive', 'discoveryLiveResults', 'discoveryLiveStatus', 'discoveryQuery',
        'discoveryFeedback', 'discoveryCopyFallback', 'discoveryCopyValue']) elements.set(id, make());
    const choices = ['cupfox', 'huarw'].map(id => Object.assign(make('input'), { dataset: { liveSource: id, sourceName: id, sourceNote: '未验证播放' } }));
    elements.get('sourceDiscovery').querySelectorAll = () => choices;
    elements.get('discoveryLiveResults').dataset.linkTarget = '_self';
    const doc = { getElementById: id => elements.get(id), createElement: make };
    const live = createLiveSearch(doc, fetcher);
    return { elements, choices, live };
}
const foundResponse = (source, title = '开端') => ({ ok: true, json: async () => ({ source_id: source, status: 'ok', results: [{ title,
    page_url: source === 'cupfox' ? 'https://www.cupfox.in/vod-detail/202236115.html' : 'https://huarw.com/movie/85334' }] }) });
const flatten = node => [node, ...node.children.flatMap(flatten)];

test('result URLs reject media, credentials, redirects, lookalike hosts and script schemes', () => {
    for (const value of ['javascript:alert(1)', 'https://evil.test/vod-detail/1.html', 'https://www.cupfox.in.evil.test/vod-detail/1.html',
        'https://user@www.cupfox.in/vod-detail/1.html', 'https://www.cupfox.in/vod-detail/1.html?url=evil',
        'https://www.cupfox.in/vod-play/1.html', 'https://www.cupfox.in/movie.mp4']) assert.equal(safeResultUrl('cupfox', value), null);
    assert.equal(safeResultUrl('cupfox', 'https://www.cupfox.in/vod-detail/1.html'), 'https://www.cupfox.in/vod-detail/1.html');
});

test('live search fans out only on submit, with no credentials, and isolates failing providers', async () => {
    const calls = [];
    const f = liveFixture(async (url, options) => {
        calls.push({ url, options });
        const source = JSON.parse(options.body).source;
        if (source === 'huarw') throw new Error('unavailable');
        return foundResponse(source, '<img src=x onerror=alert(1)>');
    });
    assert.equal(calls.length, 0);
    f.elements.get('discoveryQuery').value = '开端';
    await f.live.run();
    assert.equal(calls.length, 2);
    for (const { url, options } of calls) {
        assert.equal(url, '/api/discover/search');
        assert.equal(options.method, 'POST');
        assert.equal(options.credentials, 'omit');
        assert.equal(options.referrerPolicy, 'no-referrer');
        assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), ['q', 'source']);
    }
    assert.match(f.elements.get('discoveryLiveStatus').textContent, /找到 1 个条目，1 个来源暂不可用/);
    const nodes = flatten(f.elements.get('discoveryLiveResults'));
    assert.ok(nodes.some(n => n.tag === 'h5' && n.textContent === '<img src=x onerror=alert(1)>'));
    assert.ok(nodes.every(n => !('innerHTML' in n)));
    const link = nodes.find(n => n.tag === 'a');
    assert.equal(link.target, '_self');
    assert.equal(link.rel, 'noopener noreferrer');
    await nodes.find(n => n.tag === 'button').listeners.click();
    assert.equal(f.elements.get('discoveryCopyValue').value, link.href);
    assert.equal(f.elements.get('discoveryCopyValue').selected, true);
    assert.equal(f.elements.get('discoveryLive')['aria-busy'], 'false');
});

test('late response cannot overwrite a changed query or newer results', async () => {
    let resolveOld;
    let calls = 0;
    const f = liveFixture(async () => {
        calls++;
        if (calls === 1) return new Promise(resolve => { resolveOld = resolve; });
        return foundResponse('cupfox', '新片');
    });
    f.choices[1].checked = false;
    f.elements.get('discoveryQuery').value = '旧片';
    const old = f.live.run();
    f.elements.get('discoveryQuery').value = '新片';
    await f.live.run();
    resolveOld(foundResponse('cupfox', '旧片'));
    await old;
    const text = flatten(f.elements.get('discoveryLiveResults')).map(n => n.textContent).join(' ');
    assert.ok(text.includes('新片'));
    assert.equal(text.includes('旧片'), false);
    assert.match(f.elements.get('discoveryLiveStatus').textContent, /新片/);
    f.live.cancel(true);
    assert.equal(f.elements.get('discoveryLive').hidden, true);
    assert.deepEqual(f.elements.get('discoveryLiveResults').children, []);
});

test('empty query and deselected sources never send requests; rate limits get retry guidance', async () => {
    let calls = 0;
    const f = liveFixture(async () => { calls++; return { ok: false, status: 429 }; });
    await f.live.run();
    assert.equal(calls, 0);
    f.elements.get('discoveryQuery').value = '开端';
    f.choices.forEach(c => { c.checked = false; });
    await f.live.run();
    assert.equal(calls, 0);
    assert.match(f.elements.get('discoveryLiveStatus').textContent, /至少勾选/);
    f.choices[0].checked = true;
    await f.live.run();
    assert.equal(calls, 1);
    assert.ok(flatten(f.elements.get('discoveryLiveResults')).some(n => /搜索较频繁/.test(n.textContent)));
});
