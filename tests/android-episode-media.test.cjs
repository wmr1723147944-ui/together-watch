const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const adapters=require('../static/js/catalog-adapters.js');
const guard=fs.readFileSync('android-app/app/src/main/assets/episode-media-guard.js','utf8');
const target={source:'kanju',item:'drama',episode:'ep-five'};
const candidate=(url='https://cdn.example/episode5.mp4',extra={})=>({url,visible:true,attached:true,duration:2700,...extra});
function harness(){
    let now=1000,actual=target,rows=[candidate()],busy=false,playerSources=[];
    const window={TogetherWatchCatalogAdapters:{historyContext:()=>actual?{program:actual}:null}};
    vm.runInNewContext(guard,{window,document:{querySelectorAll:()=>busy?[{getBoundingClientRect:()=>({width:640,height:360})}]:[]},location:{href:'https://www.kanju.ai/player/drama?episode=five'},Date:{now:()=>now}});
    return {read:(p=target)=>window.__twEpisodeMediaGuard.read(p,()=>({candidates:rows,longFormPlayers:1,readyBlobPlayers:1,playerSources})),
        advance:(ms=1600)=>{now+=ms;},select:p=>{actual=p;},media:r=>{rows=r;},busy:b=>{busy=b;},sources:s=>{playerSources=s;}};
}
test('episode 4 -> 5: a late default/final episode cannot inherit the fifth episode label',()=>{
    const h=harness(),last=candidate('https://cdn.example/last.mp4');
    h.read();h.advance();assert.equal(h.read().candidates.length,1);
    h.select({...target,episode:'ep-last'});h.media([last]);
    assert.equal(h.read().episodeMatched,false);assert.equal(h.read().episodeContext,null);
    h.select(target);h.advance();assert.equal(h.read().candidates.length,0,'highlight changed before the video');
    h.advance();assert.equal(h.read().candidates.length,0,'repeated wrong media never becomes trusted');
    h.media([candidate()]);h.read();h.advance();assert.equal(h.read().candidates[0].url,candidate().url);
    assert.equal(h.read().episodeContext.program.episode,'ep-five');
});
test('the final handoff rejects a changed episode or media URL even after stable detection',()=>{
    const h=harness();h.read();h.advance();assert.equal(h.read().episodeSettled,true);
    h.media([candidate('https://cdn.example/last.mp4')]);
    assert.equal(h.read().episodeSettled,false);
    h.select({...target,episode:'ep-last'});h.advance();assert.equal(h.read().candidates.length,0);
});
test('missing or ambiguous episode markers and not-yet-ready old video fail closed',()=>{
    const h=harness(),old=candidate('https://cdn.example/old.m3u8',{visible:false,duration:0});
    h.select(null);h.media([old]);assert.equal(h.read().episodeMatched,false);
    h.select(target);h.media([{...old,visible:true,duration:2700}]);h.read();h.advance();
    assert.equal(h.read().candidates.length,0);
});
test('new room selection resets evidence; traffic-only candidates never identify an episode',()=>{
    const h=harness();h.read();h.advance();h.read();
    const next={...target,episode:'ep-six'};h.select(next);h.media([candidate('https://cdn.example/six.mp4')]);
    assert.equal(h.read(next).episodeSettled,false);h.advance();assert.equal(h.read(next).episodeSettled,true);
    h.media([candidate('https://cdn.example/ad.m3u8',{visible:false,attached:false})]);h.advance();
    assert.equal(h.read(next).candidates.length,0);
});
test('the same handoff guard works with other providers and rejects a different show',()=>{
    for(const source of ['cupfox','yhdmoe','pkavi','233dm']){
        const h=harness(),p={source,item:'film',episode:'5'};
        h.select(p);h.read(p);h.advance();assert.equal(h.read(p).episodeSettled,true);
        h.select({...p,item:'other'});assert.equal(h.read(p).episodeMatched,false);
    }
});
test('Kanju confirmation rejects two different highlighted IDs, but permits mirrored copies of one',()=>{
    const button=id=>({getAttribute:k=>k==='data-directory-episode'?id:null,classList:{contains:()=>true}});
    const doc={querySelectorAll:()=>[button('five'),button('last')]};
    assert.equal(adapters.episodeReady(doc,'ep-five'),false);
    doc.querySelectorAll=()=>[button('five'),button('five')];
    assert.equal(adapters.episodeReady(doc,'ep-five'),true);
});

test('public loading overlay prevents early handoff even with a matching directory highlight',()=>{
    const h=harness();h.busy(true);h.read();h.advance();assert.equal(h.read().episodeSettled,false);
    h.busy(false);assert.equal(h.read().episodeSettled,false);h.advance();assert.equal(h.read().episodeSettled,true);
});
test('confirmed blob player remains available for manual web fallback, not for another episode',()=>{
    const h=harness();h.media([]);h.sources(['blob:https://www.kanju.ai/five']);h.read();h.advance();
    assert.equal(h.read().readyBlobPlayers,1);
    h.select({...target,episode:'ep-last'});assert.equal(h.read().readyBlobPlayers,0);
    h.select(target);h.read();h.advance();assert.equal(h.read().readyBlobPlayers,0);
});
