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

test('Huarw native search preserves existing public episode and invitation identities',()=>{
    const req=a.request('search',{source:'huarw',q:'海贼王'});
    assert.equal(req.url,'https://huarw.com/search?wd='+encodeURIComponent('海贼王'));
    assert.ok(a.expectedPage(req,req.url));
    for(const wrong of ['https://huarw.com/','https://huarw.com/search?wd=other','https://huarw.com.evil.test/search'])assert.equal(a.expectedPage(req,wrong),false);
    const s=a.selection('huarw','179144','179144-1');
    assert.equal(s.page,'https://huarw.com/play/179144-1');
    assert.equal(ui.safeLaunchPath('huarw','179144',s.episode,s.path),s.path);
    assert.deepEqual(a.fromPage(s.page),s);
    assert.equal(policy.playSelection(policy.SERVER+s.path).page,s.page);
    assert.deepEqual(policy.programSelection(s.page),{source:'huarw',item:'179144',episode:'179144-1'});
    for(const bad of ['123-1','179144-1?sid=2','179144-1/other','179144-999999']) assert.equal(a.selection('huarw','179144',bad),null);
    for(const bad of ['https://huarw.com/movie/1?cookie=x','https://user@huarw.com/movie/1','https://huarw.com:444/movie/1'])assert.equal(a.detail('huarw',bad),null);
});

test('Huarw card badge is not mistaken for title and covers and years stay with their film',()=>{
    const req=a.request('search',{source:'huarw',q:'海贼王'});
    const anchor=(href,label,heading,poster,year)=>({textContent:label,
        getAttribute:k=>k==='href'?href:null,
        querySelectorAll:()=>poster?[{getAttribute:k=>k==='data-src'?poster:null}]:[],
        closest:selector=>selector==='h3'?(heading?{}:null):{querySelector:()=>({textContent:year})}});
    const links=[anchor('/movie/179144','更新至1180集',false,'https://www.lufys.com/a.jpg','1999'),
        anchor('/movie/179144','海贼王',true,null,'1999'),anchor('/movie/179144','播放正片',false),
        anchor('/movie/365817','海贼王剧场版',true,null,'2006')];
    const doc={title:'搜索结果',body:{textContent:''},querySelectorAll:()=>links};
    const data=a.readDocument(doc,req);
    assert.deepEqual(data.results.map(r=>[r.title,r.year,r.poster_url]),[
        ['海贼王','1999','https://www.lufys.com/a.jpg'],['海贼王剧场版','2006',null]]);
    const detail=a.normalizeResult(a.request('detail',{source:'huarw',page_url:'https://huarw.com/movie/179144'}),
        {status:'ok',episodes:[{id:'179144-1',title:'第1集'},{id:'123-1',title:'其他影片'}]});
    assert.equal(detail.episodes.length,1);assert.equal(detail.episodes[0].line,'原站默认线路');
});

test('new client adapters require advertised capability and old clients retain server search',async()=>{
    const saved=global.twSourceMetadata;let calls=0;
    try {
        global.twSourceMetadata={supportedSources:['233dm','pkavi','kanju'],request:()=>{throw Error('old client must not receive Huarw');}};
        assert.equal(ui.nativeMetadata('huarw'),false);
        await ui.metadataRequest('search',{source:'huarw',q:'测试'},async()=>{calls++;return {ok:true};},new AbortController().signal);
        assert.equal(calls,1);
        global.twSourceMetadata.supportedSources.push('huarw');assert.equal(ui.nativeMetadata('huarw'),true);
        global.twSourceMetadata.supportedSources=[];assert.equal(ui.nativeMetadata('pkavi'),false);
        delete global.twSourceMetadata.supportedSources;assert.equal(ui.nativeMetadata('pkavi'),true);assert.equal(ui.nativeMetadata('huarw'),false);
    } finally {global.twSourceMetadata=saved;}
});

test('explicit access denial is not presented as a solvable captcha',()=>{
    const req=a.request('search',{source:'pkavi',q:'测试'});
    const doc={title:'Attention Required! | Cloudflare',body:{textContent:'Sorry, you have been blocked. You are unable to access pkavi.com'}};
    assert.equal(a.readDocument(doc,req).status,'access_blocked');
    assert.equal(a.normalizeResult(req,a.readDocument(doc,req)).status,'access_blocked');
    doc.title='系统安全验证';doc.body.textContent='请输入验证码';
    assert.equal(a.readDocument(doc,req).status,'verification_required');
    doc.title='请稍候…';doc.body.textContent='正在进行安全验证。验证您不是自动程序。';
    assert.equal(a.readDocument(doc,req).status,'verification_required');
});
