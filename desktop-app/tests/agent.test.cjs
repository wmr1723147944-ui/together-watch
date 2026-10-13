'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname,'../src/player-agent.js'),'utf8');
function harness() {
    const listeners = new Map(), docListeners = new Map(); let now=100000;
    const v = {isConnected:true,currentTime:0,duration:100,playbackRate:1,readyState:4,paused:true,ended:false,seeking:false,parentElement:null,
        getBoundingClientRect:()=>({width:800,height:450}),
        addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k),
        play(){this.paused=false; listeners.get('play')?.();return Promise.resolve();},pause(){this.paused=true;listeners.get('pause')?.();},
        getAttribute:()=>null,removeAttribute(){},style:{cssText:'',setProperty(){}}};
    const document={querySelectorAll:q=>q==='video'?[v]:[],addEventListener:(k,f)=>docListeners.set(k,f),removeEventListener:k=>docListeners.delete(k)};
    const context=vm.createContext({window:{},document,Date:{now:()=>now},Promise}); vm.runInContext(source,context);
    const agent=context.window.__twDesktopPlayer; agent.sample();
    return {v,agent,event:k=>listeners.get(k)?.(),intent:(name='pointerdown')=>docListeners.get(name)?.({isTrusted:true}),advance:n=>{now+=n;}};
}
test('remote playback changes never echo as local user controls',async()=>{
    const h=harness(); h.agent.apply({type:'state',id:1,time:20,speed:1,playing:true,seek:true,issuedAt:100000});
    h.event('seeked'); assert.equal(h.agent.sample().events.length,0); assert.equal(h.v.currentTime,20);
    h.advance(2000); h.v.pause(); assert.equal(h.agent.sample().events.length,0);
});
test('real local seek and pause are captured while script-only adverts are ignored',()=>{
    const h=harness(); h.intent();h.v.currentTime=40;h.event('seeked');h.v.pause();
    const result=h.agent.sample();assert.equal(result.events[0].type,'seek');assert.equal(result.events[0].time,40);assert.equal(result.events[1].type,'pause');
    h.advance(2000);h.event('play');assert.equal(h.agent.sample().events.length,0);
});
test('newer remote state wins and volume does not cancel an in-flight seek',()=>{
    const h=harness();h.agent.apply({type:'state',id:5,time:25,speed:1,playing:false,seek:true,issuedAt:100000});
    h.agent.apply({type:'state',id:4,time:2,speed:1,playing:true,seek:true,issuedAt:100000});
    h.agent.apply({type:'volume',value:.3});assert.equal(h.v.currentTime,25);assert.equal(h.v.volume,.3);assert.equal(h.agent.sample().appliedCommand,5);
});
test('source metadata changes the player identity and drains old events',()=>{
    const h=harness();const before=h.agent.sample().serial;h.intent();h.event('play');h.event('loadedmetadata');
    const after=h.agent.sample();assert.ok(after.serial>before);assert.equal(after.events.length,0);
});
test('rejected autoplay is reported instead of silently claiming playback',async()=>{
    const h=harness();h.v.play=()=>Promise.reject(new Error('NotAllowedError'));
    h.agent.apply({type:'state',id:1,time:0,speed:1,playing:true,seek:false,issuedAt:100000});
    await Promise.resolve();await Promise.resolve();assert.equal(h.agent.sample().blocked,true);
});

test('releasing a long drag still records the user seek',()=>{
    const h=harness();h.intent();h.advance(4000);h.intent('pointerup');h.v.currentTime=35;h.event('seeked');
    assert.equal(h.agent.sample().events[0].time,35);
});

test('fullscreen adds usable controls then restores the source setting',()=>{
    const h=harness();h.v.controls=false;
    h.agent.focus(true,false);assert.equal(h.v.controls,true);
    h.agent.focus(false,false);assert.equal(h.v.controls,false);
});
