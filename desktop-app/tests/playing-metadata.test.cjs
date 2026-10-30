const {test}=require('node:test'),assert=require('node:assert/strict');
const {api}=require('../src/catalog-adapters.cjs');
const {readPlayingMetadata}=require('../src/playing-metadata.cjs');
const req=api.request('detail',{source:'kanju',page_url:'https://www.kanju.ai/player/test'});
function fixture(){
    let url=req.url+'?episode=one',valid=true;
    const calls=[];
    const wc={isDestroyed:()=>false,getURL:()=>url,debugger:{isAttached:()=>true,async sendCommand(name,params){
        calls.push({name,params});
        if(name==='Page.getFrameTree')return {frameTree:{frame:{id:'main',url}}};
        if(name==='Page.createIsolatedWorld')return {executionContextId:9};
        return {result:{value:{status:'ok',title:'测试',cookie:'never-forward',episodes:[{id:'ep-one',title:'第一集',media_url:'secret'},{id:'ep-../bad',title:'bad'}]}}};
    }}};
    return {wc,calls,alive:()=>valid,navigate:value=>url=value,cancel:()=>valid=false};
}
test('reads public same-title DOM in isolated world and normalizes response',async()=>{
    const f=fixture(),r=await readPlayingMetadata(f.wc,req,f.alive);
    assert.equal(r.status,'ok');assert.equal(r.episodes.length,1);assert.equal(r.episodes[0].id,'ep-one');
    assert.ok(!JSON.stringify(r).includes('secret'));assert.equal(r.cookie,undefined);
    assert.equal(f.calls[1].params.grantUniveralAccess,false);
    assert.ok(!f.calls[2].params.expression.includes('sessionStorage'));
});
test('foreign page, another movie, cancellation and search never inspect current DOM',async()=>{
    for(const url of ['https://evil.test/player/test','https://www.kanju.ai/player/other']){
        const f=fixture();f.navigate(url);assert.equal((await readPlayingMetadata(f.wc,req,f.alive)).status,'unavailable');assert.equal(f.calls.length,0);
    }
    const f=fixture();f.cancel();assert.equal((await readPlayingMetadata(f.wc,req,f.alive)).status,'unavailable');assert.equal(f.calls.length,0);
    assert.equal((await readPlayingMetadata(f.wc,api.request('search',{source:'kanju',q:'x'}))).status,'unavailable');
});
test('late result after navigation or picker cancellation is discarded',async()=>{
    for(const invalidate of [f=>f.navigate('https://www.kanju.ai/player/other'),f=>f.cancel()]){
        const f=fixture(),send=f.wc.debugger.sendCommand;
        f.wc.debugger.sendCommand=async(...args)=>{const value=await send(...args);if(args[0]==='Runtime.evaluate')invalidate(f);return value;};
        assert.equal((await readPlayingMetadata(f.wc,req,f.alive)).status,'unavailable');
    }
});
