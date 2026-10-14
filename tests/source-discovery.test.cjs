const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeQuery, matches, searchUrl, init } = require('../static/js/source-discovery.js');

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

function fixture() {
    const elements = new Map();
    const el = () => ({ dataset: {}, value: '', hidden: false, textContent: '', listeners: {},
        addEventListener(type, fn) { this.listeners[type] = fn; }, focus() { this.focused = true; }, select() { this.selected = true; } });
    for (const id of ['sourceDiscovery', 'discoveryQuery', 'discoveryForm', 'discoveryFeedback', 'discoveryCopyFallback',
        'discoveryClear', 'discoveryCopyValue', 'discoveryResultCount', 'discoveryEmpty']) elements.set(id, el());
    const cards = ['Sintel 辛特尔', 'Spring 春天'].map(text => Object.assign(el(), { dataset: { searchText: text } }));
    const copy = el();
    const link = Object.assign(el(), { href: '', dataset: { platformName: '哔哩哔哩', searchBase: 'https://search.bilibili.com/all', searchParam: 'keyword', searchHome: 'https://www.bilibili.com/' },
        parentElement: { querySelector() { return copy; } } });
    elements.get('sourceDiscovery').querySelectorAll = selector => selector === '[data-search-text]' ? cards : [link];
    const doc = { getElementById: id => elements.get(id) };
    init(doc);
    return { elements, cards, copy, link, doc };
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

test('other pages without the component are unaffected', () => {
    assert.doesNotThrow(() => init({ getElementById() { return null; } }));
});
