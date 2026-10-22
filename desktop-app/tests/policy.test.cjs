'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('room numbers, copied labels, shared text and web invites preserve room identity', () => {
    const p = require('../src/policy.cjs'), id = '0123456789abcdef01234567';
    for (const value of [id, id.toUpperCase(), '房间号：' + id, '房间 ' + id,
        p.SERVER + '/?room=' + id, p.SERVER + '/mobile-room/' + id + '/',
        '来一起看：' + p.SERVER + '/room/' + id + '。']) assert.equal(p.roomFrom(value), id, value);
    for (const value of [p.SERVER + '/?room=' + id + '&room=other', p.SERVER + '/other?room=' + id,
        'https://evil.example/?room=' + id, 'https://user@watchtogethernow.cloud/?room=' + id]) assert.equal(p.roomFrom(value), '');
});
const fs = require('node:fs');
const path = require('node:path');
const p = require('../src/policy.cjs');

test('episode handoffs only accept exact first-party routes and code-owned destinations', () => {
    const path = '/discover/play/cupfox/123/ep1';
    assert.deepEqual(p.playSelection(p.SERVER + path), { source: 'cupfox', episode: 'ep1', page: 'https://www.cupfox.in/vod-detail/123.html' });
    assert.deepEqual(p.playSelection(p.SERVER + '/discover/play/yhdmoe/123/EP10.5'), { source:'yhdmoe', episode:'EP10.5', page:'https://yhdmoe.com/watch/123#play_ep_EP10.5' });
    assert.deepEqual(p.playSelection(p.SERVER + '/discover/play/fcma/9102-229/1048459'), { source:'fcma', episode:'1048459', page:'https://www.fcma.cc/p/9102/229/1048459' });
    for (const url of ['https://evil.test' + path, p.SERVER + path + '?url=evil', p.SERVER + path + '#x',
        p.SERVER + '/discover/play/huarw/123/456-1', p.SERVER + '/discover/play/cupfox/123/%65p1',
        p.SERVER + '/discover/play/yhdmoe/123/EP1%23x', p.SERVER + '/discover/play/fcma/9102/229',
        'https://user@watchtogethernow.cloud' + path]) assert.equal(p.playSelection(url), null, url);
    assert.ok(p.isDiscoveryUrl(p.SERVER + '/discover?q=x'));
    assert.equal(p.isDiscoveryUrl(p.SERVER + '.evil.test/discover'), false);
    assert.equal(p.isDiscoveryUrl(p.SERVER + '/discover/play/x'), false);
});
test('HTTPS entry rejects local addresses, credentials, ports and executable schemes', () => {
    for (const url of ['http://example.com', 'javascript:alert(1)', 'file:///C:/test', 'https://user:pw@example.com', 'https://example.com:8443', 'https://127.0.0.1', 'https://2130706433', 'https://[::1]', 'https://host.local', 'https://localhost', 'tw-app://desktop/index.html']) assert.equal(p.publicHttps(url), '', url);
    assert.equal(p.publicHttps('https://www.example.com/play?id=1'), 'https://www.example.com/play?id=1');
});

test('DDYS only opens a fixed original-page selection, not arbitrary media or episode URLs', () => {
    const route = p.SERVER + '/discover/play/ddys/interstellar/page';
    assert.deepEqual(p.playSelection(route), { source:'ddys', episode:'page', page:'https://ddys.io/movie/interstellar' });
    for (const bad of [route + '?url=evil', route + '#x', route.replace('/page','/ep1'),
        route.replace('interstellar','%69nterstellar'), route.replace('interstellar','a'.repeat(121)),
        route.replace(p.SERVER,'https://evil.test')]) assert.equal(p.playSelection(bad), null, bad);
});
test('room links must belong to this service', () => {
    assert.equal(p.roomFrom('abcd_123'), 'abcd_123');
    assert.equal(p.roomFrom(p.SERVER + '/room/abcd_123'), 'abcd_123');
    assert.equal(p.roomFrom('https://evil.example/room/abcd_123'), '');
    assert.equal(p.roomFrom(p.SERVER + '/room/abc%2Fdef'), '');
    assert.equal(p.roomFrom('https://x:y@watchtogethernow.cloud/room/abcd_123'), '');
});
test('room bridge checks exact origin and room, not URL substrings', () => {
    assert.ok(p.isRoomUrl(p.SERVER + '/mobile-room/abcd', 'abcd'));
    for (const url of [p.SERVER + '.evil.example/mobile-room/abcd', p.SERVER + '/mobile-room/other', p.SERVER + '/room/abcd', 'https://x:y@watchtogethernow.cloud/mobile-room/abcd']) assert.equal(p.isRoomUrl(url, 'abcd'), false);
});
test('timing sanitizer cannot forward media URLs, credentials, or arbitrary fields', () => {
    const data = p.timingSample({time: 1,duration: 60,speed: 1,ready:true,playing:true,source:'secret',cookie:'secret', events:[{type:'seek',time:20,speed:1,source:'secret'},{type:'eval',time:1}]}, 7);
    assert.equal(JSON.stringify(data).includes('secret'), false);
    assert.equal(data.events.length, 1); assert.equal(data.session, 7);
    assert.equal(p.timingSample({time:NaN},1), null);
});

test('autoplay-blocked video cannot publish a paused frame as room authority', () => {
    const data = p.timingSample({time:0, ready:true, playing:false, blocked:true}, 1);
    assert.equal(data.ready, false);
    assert.ok(data.error);
});
test('commands are restricted to the current session and validated playback fields', () => {
    assert.equal(p.playbackCommand({type:'state',session:3,id:1,time:3,speed:1},2), null);
    assert.equal(p.playbackCommand({type:'eval',session:2,code:'x'},2), null);
    assert.equal(p.playbackCommand({type:'state',session:2,id:1,time:Infinity,speed:1},2), null);
    assert.deepEqual(p.playbackCommand({type:'volume',session:2,value:5,url:'secret'},2),{type:'volume',value:1});
});
test('fullscreen uses the entire content area with no room or toolbar gap', () => {
    assert.deepEqual(p.panelBounds(1920,1080,true),{video:{x:0,y:0,width:1920,height:1080},room:{x:1920,y:0,width:0,height:1080}});
    const b = p.panelBounds(1360,850,false); assert.equal(b.video.width+b.room.width,1360); assert.equal(b.video.y,128);
    assert.equal(p.panelBounds(1360,850,false,true).video.y,328);
    assert.equal(p.panelBounds(1360,850,true,true).video.y,0);
});
test('remote content has no preload, Node integration or disabled web security', () => {
    const main = fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8');
    assert.match(main,/app\.enableSandbox\(\)/);
    assert.match(main,/nodeIntegration: false/); assert.match(main,/contextIsolation: true/); assert.match(main,/webSecurity: true/);
    assert.doesNotMatch(main,/webSecurity: false|nodeIntegration: true|ignore-certificate-errors/);
    assert.match(main,/event\.senderFrame === win\.webContents\.mainFrame/);
    assert.match(main,/details\.mediaTypes\[0\] !== 'audio'/);
});
