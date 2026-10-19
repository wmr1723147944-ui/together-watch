const {test}=require('node:test');
const assert=require('node:assert/strict');
const a=require('../static/js/catalog-adapters.js');
const ui=require('../static/js/source-discovery.js');
const policy=require('../desktop-app/src/policy.cjs');
const item='variant:test-123',episode='ep-episode:one';

test('Kanju uses an ordinary catalogue page, not signed private API calls',()=>{
    const r=a.request('search',{source:'kanju',q:'测试 &new=1'}),u=new URL(r.url);
    assert.equal(u.origin,'https://www.kanju.ai');assert.equal(u.pathname,'/collections/browse');
    assert.equal(u.searchParams.get('q'),'测试 &new=1');assert.equal(u.searchParams.get('path'),'/v1/browse/catalog');
    assert.ok(a.expectedPage(r,r.url));assert.ok(!a.expectedPage(r,'https://www.kanju.ai/collections/browse?q=other'));
    assert.equal(a.request('search',{source:'kanju',q:'test',token:'secret'}),null);
});
test('Kanju exact public identity agrees in direct pages, local handoff and invite',()=>{
    const s=a.selection('kanju',item,episode);
    assert.equal(s.page,'https://www.kanju.ai/player/variant%3Atest-123?episode=episode%3Aone');
    assert.equal(ui.safeLaunchPath('kanju',item,episode,s.path),s.path);
    assert.equal(policy.playSelection(policy.SERVER+s.path).page,s.page);
    assert.deepEqual(policy.programSelection(s.page+'&from=collection'),{source:'kanju',item,episode});
    assert.deepEqual(policy.programSelection(policy.SERVER+s.path),{source:'kanju',item,episode});
    assert.equal(policy.programTarget({revision:1,program:{source:'kanju',item,episode,page:s.page,exact_episode:true}}).page,s.page);
    assert.equal(a.detail('kanju',s.page).page,'https://www.kanju.ai/player/variant%3Atest-123');
    for(const e of ['ep-a.b.c','ep-https://evil.test','ep-a?token=x','ep-','ep-x/y'])assert.equal(a.selection('kanju',item,e),null);
    for(const u of [s.page+'&token=secret',s.page+'&episode=two',s.page.replace('.ai/','.ai.evil.test/'),s.page.replace('/player/','/player/%2F')])assert.equal(policy.programSelection(u),null);
});
test('Kanju reads public DOM attributes, with explicit partial-episode scope',()=>{
    const node=(attrs,body='')=>({getAttribute:k=>attrs[k]??null,textContent:body,classList:{contains:k=>attrs.class===k}});
    const anchor=node({href:'/player/variant%3Atest-123?from=catalog','aria-label':'打开播放器：测试动画'});
    const ep=node({'data-directory-episode':'episode:one',title:'第1集',class:'movie-button-primary'});
    const unsafe=node({'data-directory-episode':'a.b.c',title:'private token'});
    const doc={title:'看剧 AI',body:{textContent:''},querySelector:()=>null,querySelectorAll:q=>q==='a[href]'?[anchor]:[ep,ep,unsafe]};
    const search=a.readDocument(doc,a.request('search',{source:'kanju',q:'测试'}));
    assert.equal(search.results.length,1);assert.equal(search.results[0].title,'测试动画');
    const result=a.readDocument(doc,a.request('detail',{source:'kanju',page_url:search.results[0].page_url}));
    assert.equal(result.selection_scope,'loaded_page');assert.equal(result.episodes.length,1);
    assert.equal(result.episodes[0].id,episode);assert.ok(!JSON.stringify(result).includes('private token'));
    assert.equal(a.episodeReady(doc,episode),true);assert.equal(a.episodeReady(doc,'ep-other'),false);
    ep.classList.contains=()=>false;assert.equal(a.episodeReady(doc,episode),false);
    doc.querySelector=q=>q==='input[type="password"]'?{}:null;
    assert.equal(a.readDocument(doc,a.request('search',{source:'kanju',q:'测试'})).status,'verification_required');
});
test('Kanju on an old desktop bridge or browser falls back with explicit capability response',async()=>{
    const saved=global.twSourceMetadata;let called=false;
    global.twSourceMetadata={request:()=>{throw new Error('old native adapter must not run');}};
    try {
        const r=await ui.metadataRequest('search',{source:'kanju',q:'测试'},async()=>{called=true;return {ok:true};},new AbortController().signal);
        assert.ok(r.ok);assert.ok(called);
    } finally {global.twSourceMetadata=saved;}
});
