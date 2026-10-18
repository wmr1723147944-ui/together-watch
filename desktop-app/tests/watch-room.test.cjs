'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/policy.cjs');
test('share only selected episode identities, never arbitrary media tokens', () => {
    assert.deepEqual(p.programSelection(p.SERVER+'/discover/play/cupfox/123/ep2'), {source:'cupfox',item:'123',episode:'ep2'});
    assert.equal(p.programSelection('https://cdn.example.com/video.mp4?token=secret'),null);
    assert.equal(p.programSelection('https://evil.test/discover/play/cupfox/123/ep2'),null);
    const k = p.programSelection('https://www.kanju.ai/player/public_id-123?from=home');
    assert.deepEqual(k,{source:'kanju',item:'public_id-123',episode:'page'});
    assert.equal(p.programSelection('https://www.kanju.ai.evil.test/player/public'),null);
});
test('untrusted server response cannot redirect invitee to an arbitrary URL', () => {
    const data = {revision:1,program:{source:'cupfox',item:'123',episode:'ep2',page:'https://www.cupfox.in/vod-detail/123.html',exact_episode:true}};
    assert.equal(p.programTarget(data).page,data.program.page);
    assert.equal(p.programTarget({...data,program:{...data.program,page:'https://evil.example/steal'}}),null);
    assert.equal(p.programTarget({...data,revision:'1'}),null);
    assert.equal(p.programTarget({...data,program:{...data.program,item:'../admin'}}),null);
});
