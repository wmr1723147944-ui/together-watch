const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('android-app/app/src/main/assets/android-web-sync.js','utf8');
function frame(area=0){
    const commands=[];let serial=1;
    const w={frames:[],document:{querySelectorAll:()=>[]},eval(){},
        __twDesktopPlayer:{sample:()=>area?{area,serial,time:12,ready:true}:null,apply:c=>commands.push(c)}};
    return {w,commands,replace(){serial++},resize(n){area=n}};
}
function start(w){const ctx=vm.createContext({window:w,document:w.document});vm.runInContext(code,ctx);return w.__twAndroidPage;}
test('Android selects the largest reachable video and ignores cross-origin frames',()=>{
    const main=frame(100),child=frame(500),cross={};
    Object.defineProperty(cross,'document',{get(){throw Error('cross origin')}});
    main.w.frames=[cross,child.w];const bridge=start(main.w);
    const sample=bridge.sample('agent');assert.equal(sample.area,500);assert.equal(sample.active,true);
    bridge.apply({session:sample.session,type:'state'});assert.equal(child.commands.length,1);assert.equal(main.commands.length,0);
});
test('replaced player and selected frame both invalidate stale commands',()=>{
    const main=frame(100),child=frame(500);main.w.frames=[child.w];const bridge=start(main.w);
    const one=bridge.sample('agent');child.replace();const two=bridge.sample('agent');assert.notEqual(one.session,two.session);
    bridge.apply({session:one.session});assert.equal(child.commands.length,0);
    child.resize(0);const three=bridge.sample('agent');assert.notEqual(two.session,three.session);
    bridge.apply({session:three.session});assert.equal(main.commands.length,1);
});
test('missing player stays inactive and injection runs only once per frame',()=>{
    const main=frame();delete main.w.__twDesktopPlayer;let calls=0;
    main.w.eval=()=>{throw Error('CSP forbids eval');};
    const install=w=>{calls++;w.__twDesktopPlayer={sample:()=>null};};
    const bridge=start(main.w);assert.equal(bridge.sample(install).active,false);bridge.sample(install);assert.equal(calls,1);
});
test('compiled installer receives each same-origin frame, never calls page eval',()=>{
    const main=frame(),child=frame();main.w.frames=[child.w];
    for(const f of [main,child]){delete f.w.__twDesktopPlayer;f.w.eval=()=>{throw Error('CSP forbids eval');};}
    const installed=[];
    const sample=start(main.w).sample(w=>{installed.push(w);w.__twDesktopPlayer={sample:()=>({area:500,time:2,serial:1})};});
    assert.equal(sample.active,true);assert.deepEqual(installed,[main.w,child.w]);
});
test('diagnostics distinguish absent video, blocked child frames and adapter failure',()=>{
    const main=frame(),bridge=start(main.w);
    assert.equal(bridge.sample(()=>{}).reason,'no_video');
    const child={};Object.defineProperty(child,'document',{get(){throw Error('cross origin');}});
    main.w.frames=[child];assert.equal(bridge.sample(()=>{}).reason,'cross_origin_frame');
    delete main.w.__twDesktopPlayer;
    assert.equal(bridge.sample(()=>{throw Error('private error details');}).reason,'adapter_error');
    assert.ok(!JSON.stringify(bridge.sample(()=>{throw Error('secret');})).includes('secret'));
});
test('losing all reachable players invalidates delayed commands and reacquisition session',()=>{
    const main=frame(100),bridge=start(main.w),one=bridge.sample(()=>{});
    main.resize(0);assert.equal(bridge.sample(()=>{}).active,false);
    bridge.apply({session:one.session,type:'state'});assert.equal(main.commands.length,0);
    main.resize(100);assert.notEqual(bridge.sample(()=>{}).session,one.session);
});
test('pause stops accessible audio/video without accessing account data',()=>{
    const main=frame(),child=frame();let pauses=0;main.w.frames=[child.w];
    for(const f of [main,child]){f.w.document.querySelectorAll=()=>[{pause(){pauses++}}];Object.defineProperty(f.w.document,'cookie',{get(){throw Error('must not read')}});}
    start(main.w).pause();assert.equal(pauses,2);
});
test('episode confirmation clicks only requested episode and requires selected marker',()=>{
    const main=frame();let selected=false,clicks=0;
    main.w.document.querySelectorAll=()=>[{getAttribute:()=> 'ep2',classList:{contains:()=>selected},click(){clicks++}}];
    const bridge=start(main.w);assert.equal(bridge.confirm('cupfox','ep1'),false);assert.equal(clicks,0);
    assert.equal(bridge.confirm('cupfox','ep2'),false);assert.equal(clicks,1);
    selected=true;assert.equal(bridge.confirm('cupfox','ep2'),true);assert.equal(clicks,1);
});
test('Kanju confirms the original selected marker, never trusts only the URL',()=>{
    const main=frame(),bridge=start(main.w);assert.equal(bridge.confirm('kanju','ep-2'),false);
    main.w.TogetherWatchCatalogAdapters={episodeReady:(_d,e)=>e==='ep-2'};
    assert.equal(bridge.confirm('kanju','ep-3'),false);assert.equal(bridge.confirm('kanju','ep-2'),true);
});

test('Android host shares exactly one confirmed episode, not a bare player page',()=>{
    const main=frame(),bridge=start(main.w);
    main.w.document.querySelectorAll=()=>[{getAttribute:()=> 'part:1'}, {getAttribute:()=> 'part:2'}];
    assert.equal(bridge.currentEpisode('kanju'),'');
    main.w.TogetherWatchCatalogAdapters={episodeReady:(_d,id)=>id==='ep-part:2'};
    assert.equal(bridge.currentEpisode('kanju'),'ep-part:2');
    main.w.TogetherWatchCatalogAdapters.episodeReady=()=>true;
    assert.equal(bridge.currentEpisode('kanju'),'','ambiguous selections must not create a guessed invitation');
    assert.equal(bridge.currentEpisode('unknown'),'');
});

test('Android hold targets the selected frame and maps touches without cross-origin access',()=>{
    const main=frame(100),child=frame(500),calls=[];
    main.w.frames=[child.w];main.w.innerWidth=800;main.w.innerHeight=600;
    child.w.parent=main.w;child.w.frameElement={getBoundingClientRect:()=>({left:100,top:80})};
    child.w.__twDesktopPlayer.canHold=(...args)=>{calls.push(args);return true;};
    child.w.__twDesktopPlayer.beginHold=(...args)=>{calls.push(args);return true;};
    child.w.__twDesktopPlayer.endHold=commit=>calls.push(commit);
    const bridge=start(main.w);bridge.sample(()=>{});
    assert.equal(bridge.holdAt('canHold',.5,.5,false),true);assert.deepEqual(calls.pop(),[300,220,false]);
    assert.equal(bridge.holdAt('beginHold',.5,.5,true),true);assert.deepEqual(calls.pop(),[300,220,true]);
    assert.equal(bridge.holdAt('unknown',.5,.5,true),false);bridge.endHold(true);assert.equal(calls.pop(),true);
    child.resize(0);bridge.sample(()=>{});assert.equal(calls.pop(),false);
});
