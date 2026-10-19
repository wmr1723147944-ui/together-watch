const {test}=require('node:test');
const assert=require('node:assert/strict');
const a=require('../static/js/catalog-adapters.js');
const ui=require('../static/js/source-discovery.js');
const policy=require('../desktop-app/src/policy.cjs');
const cases=[['233dm','251f681f349a5832bcb61768','https://www.233dm.com/anime/251f681f349a5832bcb61768.html'],
    ['pkavi','514960','https://www.pkavi.com/mv/514960.html']];
test('new adapters agree across search UI, launch, raw source selection and invitation',()=>{
    for(const [source,item,page] of cases){
        assert.equal(ui.safeResultUrl(source,page),page);
        const s=a.selection(source,item,'3-1');
        assert.equal(ui.safeLaunchPath(source,item,'3-1',s.path),s.path);
        assert.equal(policy.playSelection(policy.SERVER+s.path).page,s.page);
        assert.deepEqual(policy.programSelection(s.page),{source,item,episode:'3-1'});
        assert.equal(policy.programTarget({revision:1,program:{source,item,episode:'3-1',page:s.page,exact_episode:true}}).page,s.page);
        for(const url of [page+'?cookie=x',page+'#x',page.replace('https:','http:'),page.replace('.com','.com.evil.test')])assert.equal(ui.safeResultUrl(source,url),null);
        for(const e of ['0-1','1-0','1-1?token=x','1-999999'])assert.equal(a.selection(source,item,e),null);
    }
});
test('metadata requests are fixed-origin, bounded, reject extra headers/cookies/URLs',()=>{
    assert.equal(a.request('search',{source:'pkavi',q:'测试 &url=http://127.0.0.1'}).url,
        'https://www.pkavi.com/vs/-------------.html?wd='+encodeURIComponent('测试 &url=http://127.0.0.1'));
    for(const payload of [{source:'unknown',q:'x'},{source:['pkavi'],q:'x'},{source:'pkavi',q:'x',cookie:'secret'},{source:'pkavi',q:''}])assert.equal(a.request('search',payload),null);
    assert.equal(a.request('detail',{source:'pkavi',page_url:'https://127.0.0.1/'}),null);
    for(const source of ['constructor','__proto__','toString',['pkavi'],null]) {
        assert.equal(a.urlFor(source,'https://undefined/mv/1.html'),null);
        assert.equal(a.detail(source,'https://undefined/mv/1.html'),null);
        assert.equal(ui.safeResultUrl(source,'https://undefined/mv/1.html'),null);
    }
});
test('normalizer discards renderer extra fields, foreign links and mismatched episodes',()=>{
    const req=a.request('detail',{source:'pkavi',page_url:cases[1][2]});
    const r=a.normalizeResult(req,{status:'ok',cookie:'secret',title:'<b>title</b>',episodes:[{id:'1-1',title:'第1集',media_url:'secret'},{id:'1-1',title:'重复'},{id:'../x',title:'bad'}]});
    assert.equal(r.episodes.length,1);assert.equal(r.episodes[0].launch_path,'/discover/play/pkavi/514960/1-1');assert.ok(!JSON.stringify(r).includes('secret'));
    const s=a.normalizeResult(a.request('search',{source:'pkavi',q:'测试'}),{status:'ok',results:[{title:'无关',page_url:cases[1][2]},{title:'测试',page_url:'https://evil.test/mv/1.html'}]});
    assert.deepEqual(s.results,[]);
    assert.deepEqual(a.normalizeResult(req,{status:'verification_required',episodes:[{id:'1-1',title:'not ready'}]}).episodes,[]);
});
test('native metadata cancellation is forwarded without exposing raw cookies',async()=>{
    const saved=global.twSourceMetadata,controller=new AbortController();let cancelled;
    global.twSourceMetadata={request:async id=>{controller.abort();return {status:'cancelled'};},cancel:id=>{cancelled=id;}};
    try {await assert.rejects(ui.metadataRequest('search',{source:'pkavi',q:'测试'},()=>{throw Error('no server fetch');},controller.signal));assert.match(cancelled,/^catalog-/);}
    finally {global.twSourceMetadata=saved;}
});
