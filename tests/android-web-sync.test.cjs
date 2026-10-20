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
    main.w.eval=()=>{calls++;main.w.__twDesktopPlayer={sample:()=>null};};
    const bridge=start(main.w);assert.equal(bridge.sample('agent').active,false);bridge.sample('agent');assert.equal(calls,1);
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
