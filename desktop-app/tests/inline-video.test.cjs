'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../src/inline-video.js'),'utf8');
function setup(){
    const attrs=new Map(),events=new Map(),root=new Map();
    const v={isConnected:true,currentSrc:'blob:https://www.kanju.ai/fixture',duration:2400,readyState:4,controls:false,
        getBoundingClientRect:()=>({width:800,height:450}),getAttribute:k=>attrs.get(k),setAttribute:(k,s)=>attrs.set(k,s),removeAttribute:k=>attrs.delete(k),
        addEventListener:(k,f)=>events.set(k,f),removeEventListener:k=>events.delete(k)};
    let ready=true,modal=false,videos=[v];
    const context=vm.createContext({window:{TogetherWatchCatalogAdapters:{episodeReady:(_d,ep)=>ready&&ep==='ep-1'}},document:{querySelector:()=>modal,querySelectorAll:()=>videos,
        documentElement:{getAttribute:k=>root.get(k),setAttribute:(k,v)=>root.set(k,v),removeAttribute:k=>root.delete(k)}}});
    const run=(mode,token='test',ep='ep-1')=>vm.runInContext(code+'('+JSON.stringify(mode)+','+JSON.stringify(token)+','+JSON.stringify(ep)+')',context);
    return {v,run,events,root,selected:b=>{ready=b;},modal:b=>{modal=b;},multiple:()=>{videos=[v,{...v}];}};
}
test('video-only compatibility keeps the original decoder and restores controls on exit',()=>{
    const t=setup();assert.equal(t.run('start'),true);assert.equal(t.v.controls,true);assert.equal(t.run('check'),true);
    assert.equal(t.run('check','stale'),false);t.run('restore','stale');assert.equal(t.run('check'),true);
    t.run('restore');assert.equal(t.v.controls,false);assert.equal(t.events.size,0);assert.equal(!!t.run('check'),false);
    assert.equal(t.root.size,0);
});
test('wrong episode, modal, multiple videos, short preview and DRM cannot be adopted',()=>{
    for(const change of [t=>t.selected(false),t=>t.modal(true),t=>t.multiple(),t=>t.v.duration=30,t=>t.v.mediaKeys={},t=>t.v.readyState=1]){
        const t=setup();change(t);assert.equal(t.run('start'),false);
    }
});
test('changed episode, changed URL, replacement and encryption invalidate video-only state',()=>{
    for(const change of [t=>t.selected(false),t=>t.v.currentSrc+='changed',t=>t.v.isConnected=false,t=>t.events.get('encrypted')(),t=>t.events.get('loadstart')()]){
        const t=setup();t.run('start');change(t);assert.equal(t.run('check'),false);
    }
});
