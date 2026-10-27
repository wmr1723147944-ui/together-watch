'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname,'../src/player-agent.js'),'utf8');
function harness() {
    const listeners = new Map(), docListeners = new Map(); let now=100000;
    const v = {isConnected:true,currentTime:0,duration:100,playbackRate:1,readyState:4,paused:true,ended:false,seeking:false,parentElement:null,
        getBoundingClientRect:()=>({left:0,top:0,right:800,bottom:450,width:800,height:450}),
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

test('hold fast-forward preserves room speed then emits exactly one seek on release',()=>{
    const h=harness();h.v.paused=false;h.v.currentTime=10;h.v.playbackRate=1.5;
    assert.equal(h.agent.beginHold(200,100),true);assert.equal(h.v.playbackRate,2);
    h.intent();h.event('ratechange');h.v.currentTime=22;
    const during=h.agent.sample();assert.equal(during.speed,1.5);assert.equal(during.time,19);
    assert.equal(during.visualTime,22);assert.equal(during.visualSpeed,2);assert.equal(during.events.length,0);
    h.agent.endHold(true);h.intent('pointerup');h.event('ratechange');h.event('seeked');
    const end=h.agent.sample();assert.equal(h.v.playbackRate,1.5);assert.equal(end.time,22);
    assert.equal(end.events.length,1);assert.equal(end.events[0].type,'seek');assert.equal(end.events[0].speed,1.5);
    h.agent.endHold(true);assert.equal(h.agent.sample().events.length,0);
    h.intent();h.v.pause();assert.equal(h.agent.sample().events[0].type,'pause','a real tap immediately after release must still work');
});

test('hold refuses paused, loading, pending seek and seek-bar gestures',()=>{
    const h=harness();assert.equal(h.agent.beginHold(100,100),false);
    h.v.paused=false;assert.equal(h.agent.beginHold(100,440),false);
    assert.equal(h.agent.beginHold(-1,100),false);h.v.readyState=2;assert.equal(h.agent.beginHold(100,100),false);
    h.v.readyState=4;h.agent.apply({type:'state',id:1,time:40,speed:1,playing:true,seek:true,issuedAt:100000});
    assert.equal(h.agent.beginHold(100,100),false);
});

test('remote pause and cancellation restore original rate without echoing a seek',()=>{
    const h=harness();h.v.paused=false;h.v.currentTime=10;h.agent.beginHold(100,100);h.v.currentTime=22;
    h.agent.apply({type:'state',id:1,time:16,speed:1,playing:false,seek:false,issuedAt:100000});
    assert.equal(h.v.currentTime,16);assert.equal(h.v.playbackRate,1);assert.equal(h.v.paused,true);
    h.agent.endHold(true);assert.equal(h.agent.sample().events.length,0);
    h.advance(1000);h.v.paused=false;h.agent.beginHold(100,100);h.v.currentTime=24;h.agent.endHold(false);
    assert.equal(h.v.currentTime,20);assert.equal(h.agent.sample().events.length,0);
});

test('metadata changes or buffering terminate temporary speed safely',()=>{
    const h=harness();h.v.paused=false;h.v.currentTime=10;h.agent.beginHold(100,100);h.event('loadedmetadata');
    assert.equal(h.v.playbackRate,1);assert.equal(h.agent.sample().holding,false);
    h.agent.beginHold(100,100);h.v.currentTime=20;h.v.readyState=2;
    assert.equal(h.agent.sample().holding,false);assert.equal(h.v.playbackRate,1);assert.equal(h.v.currentTime,15);
});

test('NativeSync accepts projected hold samples without resetting speed or broadcasting 2x',()=>{
    const NativeSync=require('../../static/js/native-sync.js'),h=harness(),sent=[];
    let now=100000;
    const sync=new NativeSync({emit:(name,payload)=>sent.push([name,payload]),command:command=>h.agent.apply(command),now:()=>now});
    sync.session=1;sync.initialized=true;h.v.paused=false;h.v.currentTime=10;
    h.agent.beginHold(100,100);h.v.currentTime=22;now+=6000;
    let sample={...h.agent.sample(),session:1};sync.receive(sample,sample.events);
    assert.equal(sent.find(([n])=>n==='playback_snapshot')[1].speed,1);
    assert.equal(sent.find(([n])=>n==='playback_snapshot')[1].time,16);
    sync.state({revision:1,time:16,speed:1,playing:true,server_time:now/1000});assert.equal(h.v.playbackRate,2);
    h.agent.endHold(true);sample={...h.agent.sample(),session:1};sync.receive(sample,sample.events);
    const seeks=sent.filter(([n])=>n==='video_event');assert.equal(seeks.length,1);
    assert.equal(seeks[0][1].type,'seek');assert.equal(seeks[0][1].time,22);assert.equal(seeks[0][1].speed,1);
});

test('fast-forward reaching the end keeps the ending instead of jumping backwards',()=>{
    const h=harness();h.v.paused=false;h.v.currentTime=90;h.agent.beginHold(100,100);
    h.v.currentTime=100;h.v.ended=true;const end=h.agent.sample();
    assert.equal(end.time,100);assert.equal(end.speed,1);assert.equal(end.holding,false);
    assert.equal(end.events.length,1);assert.equal(end.events[0].type,'seek');
});
