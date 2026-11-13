'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PageLoadRecovery}=require('../src/page-load-recovery.cjs');
const page='https://www.kanju.ai/player/show?episode=five';
test('transient main page failure retries exactly once and becomes usable only on success',()=>{
    let now=0;const r=new PageLoadRecovery(()=>now);r.begin(page);r.fail(page,-100);
    assert.equal(r.blocked,true);assert.equal(r.due(),'');now=1200;assert.equal(r.due(),page);
    r.loaded(page,200);assert.equal(r.blocked,false);assert.equal(r.message,'');
    r.fail(page,-101);assert.match(r.message,/加载失败/);now=10000;assert.equal(r.due(),'');
});
test('cancelled, subframe and old episode failures cannot poison a new target',()=>{
    const r=new PageLoadRecovery();r.begin(page);r.fail(page,-3);assert.equal(r.current.phase,'loading');
    r.fail('https://ad.example/frame',-100);assert.equal(r.current.code,0);
    r.begin(page+'&new=1');r.fail(page,-100);r.loaded(page,200);assert.equal(r.current.phase,'loading');
    r.clear();assert.equal(r.due(),'');assert.equal(r.blocked,false);
});
test('HTTP errors, login failures and certificate errors do not become successful empty documents',()=>{
    for(const code of [401,403,404,-200,-201,-202]){
        const r=new PageLoadRecovery();r.begin(page);code>0?r.loaded(page,code):r.fail(page,code);
        assert.equal(r.current.phase,'failed');assert.equal(r.due(),'');r.loaded(page,0);assert.equal(r.blocked,true);
    }
});
test('hanging document is bounded; manual reload starts a fresh budget; redirects preserve original target',()=>{
    let now=0;const r=new PageLoadRecovery(()=>now);r.begin(page);r.redirect(page+'&line=one');
    now=30001;assert.equal(r.due(),'');now+=1200;assert.equal(r.due(),page);
    now+=30001;r.due();assert.equal(r.current.phase,'failed');
    r.begin(page);assert.equal(r.current.attempts,0);r.loaded(page,200);assert.equal(r.blocked,false);
});
