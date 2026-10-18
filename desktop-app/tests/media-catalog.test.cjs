'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MediaCatalog, mediaKind, preferWeb } = require('../src/media-catalog.cjs');
const page = 'https://video.example.com/episode/1';
test('candidate types require a public HTTPS address and a complete media resource', () => {
    assert.equal(mediaKind('https://cdn.example.com/a.MP4?t=secret'), 'mp4');
    assert.equal(mediaKind('https://cdn.example.com/stream', 'application/vnd.apple.mpegurl; charset=utf-8'), 'hls');
    assert.equal(mediaKind('https://cdn.example.com/a.webm'), 'webm');
    for (const u of ['http://cdn.example.com/a.mp4', 'blob:https://example.com/video', 'file:///a.mp4',
        'https://127.0.0.1/a.mp4', 'https://[::1]/a.mp4','https://u:p@cdn.example.com/a.mp4',
        'https://cdn.example.com/a.m4s','https://cdn.example.com/a.ts','https://cdn.example.com/a.mpd',
        'https://cdn.example.com/key.key','https://example.com/page.html','https://host.local/a.mp4']) assert.equal(mediaKind(u), '', u);
});
test('protected platforms use exact domains and subdomains, not misleading substrings', () => {
    assert.equal(preferWeb('https://v.qq.com/a'), true);
    assert.equal(preferWeb('https://qq.com./a'), true);
    assert.equal(preferWeb('https://qq.com.example.com/a'), false);
});
test('catalog bounds, deduplication, opaque IDs and labels without query secrets', () => {
    const c = new MediaCatalog();
    const a = c.add('https://cdn.example.com/a.mp4?signature=secret#fragment', page);
    assert.equal(c.add('https://cdn.example.com/a.mp4?signature=secret', page).id, a.id);
    assert.doesNotMatch(JSON.stringify(c.summaries()), /signature|secret|https:/);
    for (let i = 0; i < 50; i++) c.add(`https://cdn.example.com/${i}.mp4`, page);
    assert.equal(c.items.size, 24);
    assert.equal(c.get(a.id), a);
    c.reset(); assert.equal(c.get(a.id), null);
});
test('DOM candidates keep current position and rank playing video first, not network ads', () => {
    const c = new MediaCatalog();
    c.add('https://cdn.example.com/ad.mp4', page);
    const a = c.add('https://cdn.example.com/film.mp4', page, '', { dom: true, active: true, position: 128, duration: 3600 });
    assert.equal(c.summaries()[0].id, a.id); assert.equal(a.position, 128);
    c.add(a.url, page); assert.equal(a.position, 128);
    c.add(a.url, page, '', { dom: true, active: false, position: 130, duration: 3600 });
    assert.equal(a.active, false); assert.equal(a.position, 130);
});
test('DRM detection invalidates every candidate until the page changes', () => {
    const c = new MediaCatalog();
    const a = c.add('https://cdn.example.com/a.mp4', page);
    c.block(); assert.equal(c.get(a.id), null); assert.deepEqual(c.summaries(), []);
    assert.equal(c.add(a.url, page), null);
    c.reset(); assert.ok(c.add(a.url, page));
    assert.equal(c.add(a.url, 'https://v.qq.com/a'), null);
});
