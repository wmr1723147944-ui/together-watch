const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const H=require('../static/js/watch-history.js'),A=require('../static/js/catalog-adapters.js');
const p={source:'kanju',item:'av-public',episode:'ep-one'},q={...p,episode:'ep-two'};
function harness(){
    let clock=100000;const rows=new Map(),elements=new Map(),events=new Map(),handlers={},seeks=[],messages=[];
    const storage={getItem:k=>rows.get(k),setItem:(k,v)=>rows.set(k,v)};
    const store=H.createStore(storage,()=>clock);
    const socket={connected:false,on:(name,fn)=>handlers[name]=fn,emit(){}};
    const context={Date:{now:()=>clock},localStorage:storage,AbortController,
        fetch:()=>new Promise(()=>{}),TogetherWatchHistory:{...H,store},
        TogetherWatchDanmaku:{Timeline:class{set(){}at(){return[];}}},
        document:{getElementById(id){if(!elements.has(id))elements.set(id,{value:'',replaceChildren(){}});return elements.get(id);}},
        addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key)};
    vm.runInNewContext(fs.readFileSync(require.resolve('../static/js/room-experience.js'),'utf8'),context);
    const experience=context.createRoomExperience({socket,room:'test',addMessage:s=>messages.push(s),seek:t=>{seeks.push(t);return true;}});
    experience.program({revision:1,program:p});experience.context({owner:true});handlers.presence({count:1});
    const receive=(time,extra={})=>experience.receive({active:true,ready:true,playing:true,time,duration:1200,...extra},true);
    return {store,experience,receive,seeks,messages,context,handlers,events,advance:n=>clock+=n,now:()=>clock};
}
test('resume does not overwrite last position until the player reaches it',()=>{
    const h=harness();h.store.record(p,{ready:true,time:380});h.store.prepare(p);h.advance(6000);
    h.receive(10);assert.deepEqual(h.seeks,[380]);assert.equal(h.store.list()[0].time,380);
    h.experience.destroy();assert.equal(h.store.list()[0].time,380);
});
test('resume retries then accepts confirmed position or explicit manual seek',()=>{
    const h=harness();h.store.record(p,{ready:true,time:380});h.store.prepare(p);
    h.receive(10);h.advance(5000);h.receive(15);assert.equal(h.seeks.length,2);
    h.advance(400);h.receive(380.4);assert.equal(h.store.list()[0].time,380.4);
    h.advance(6000);h.receive(90,{events:[{type:'seek'}]});assert.equal(h.store.list()[0].time,90);
});
test('missing presence/ownership cannot save the startup position over history',()=>{
    const h=harness();h.store.record(p,{ready:true,time:300});h.store.prepare(p);h.handlers.presence({count:0});
    h.advance(6000);h.receive(12);assert.equal(h.store.list()[0].time,300);
    h.handlers.presence({count:1});h.receive(13);assert.deepEqual(h.seeks,[300]);
});
test('friend room follows host progress and never resumes personal history',()=>{
    const h=harness();h.store.record(p,{ready:true,time:300});h.store.prepare(p);h.experience.context({owner:false});h.handlers.presence({count:2});
    h.advance(1000);h.receive(60);assert.deepEqual(h.seeks,[]);assert.equal(h.store.list()[0].time,60);
});
test('original-site next episode saves actual episode and its own time',()=>{
    const h=harness();h.receive(390,{history_context:{program:p,title:'测试',label:'第1集'}});h.advance(2000);
    h.receive(15,{history_context:{program:q,title:'测试',label:'第2集'}});
    assert.equal(h.store.list()[0].episode,q.episode);assert.equal(h.store.list()[0].label,'第2集');
    assert.equal(h.store.list()[0].time,15);assert.equal(h.store.list()[1].time,390);
    h.experience.program({revision:2,program:q});h.advance(400);h.receive(16,{history_context:{program:q}});
    assert.equal(h.store.list()[0].episode,q.episode);
});
test('ambiguous page identity and buffering frames cannot corrupt history',()=>{
    const h=harness();h.receive(300);h.advance(7000);h.receive(10,{history_context:null});h.receive(30,{seeking:true});
    h.experience.destroy();assert.equal(h.store.list()[0].time,300);assert.equal(h.store.list()[0].updated,100000);
});
test('a new selected button cannot borrow the previous video session position',()=>{
    const h=harness();h.receive(390,{session:1,history_context:{program:p}});h.advance(6000);
    h.receive(391,{session:1,history_context:{program:q}});assert.equal(h.store.list().length,1);
    h.experience.program({revision:2,program:q});h.receive(392,{session:1,history_context:{program:q}});assert.equal(h.store.list().length,1);
    h.advance(400);h.receive(6,{session:2,history_context:{program:q}});assert.equal(h.store.list()[0].time,6);assert.equal(h.store.list()[0].episode,q.episode);
});
test('hiding the original episode panel keeps only the same confirmed media session',()=>{
    const h=harness();h.receive(100,{session:1,history_context:{program:p}});h.advance(6000);
    h.receive(106,{session:1,history_context:null});assert.equal(h.store.list()[0].time,106);
    h.advance(6000);h.receive(10,{session:2,history_context:null});h.experience.destroy();assert.equal(h.store.list()[0].time,106);
});
test('final save uses observed time and cannot override a newer room or reorder old episode',()=>{
    const h=harness();h.receive(100);h.advance(500);h.receive(101);h.advance(500);
    h.store.record(p,{ready:true,time:200});h.store.record(q,{ready:true,time:20});h.advance(10000);
    h.experience.destroy();assert.equal(h.store.list()[0].episode,q.episode);
    assert.equal(h.store.list().find(r=>r.episode===p.episode).time,200);
});
test('pause and leaving save latest valid sample before account flush; repeats are idempotent',()=>{
    const h=harness();h.receive(100);h.advance(400);h.receive(101,{playing:false});assert.equal(h.store.list()[0].time,101);
    h.advance(400);h.receive(102);h.events.get('tw-history-save')();assert.equal(h.store.list()[0].time,102);
    h.advance(6000);h.experience.destroy();assert.equal(h.store.list()[0].updated,100800);
});
test('an idle paused room cannot keep promoting an older episode over a newer viewing',()=>{
    const h=harness();h.receive(200,{playing:false});h.advance(1000);h.store.record(q,{ready:true,time:50});
    h.advance(6000);h.receive(200,{playing:false});h.experience.destroy();
    assert.equal(h.store.list()[0].episode,q.episode);assert.equal(h.store.list()[1].updated,100000);
});
function doc(episodes,source='kanju'){
    return {querySelector:()=>({textContent:'测试剧'}),querySelectorAll:()=>episodes.map(([id,label,active])=>({
        textContent:label,getAttribute:name=>name==='title'?label:name==='data-directory-episode'||name==='ep_slug'||name==='play_ep'?id:null,
        classList:{contains:cls=>active && ['movie-button-primary','on','disabled'].includes(cls)}
    }))};
}
test('Kanju history uses current UI episode not stale URL and excludes ambiguous selection',()=>{
    const page='https://www.kanju.ai/player/av-public?episode=one';
    const context=A.historyContext(doc([['one','第1集',false],['two','第2集',true]]),page);
    assert.deepEqual(context.program,q);assert.equal(context.label,'第2集');
    assert.equal(A.historyContext(doc([]),page),null);
    assert.equal(A.historyContext(doc([['one','1',true],['two','2',true]]),page),null);
});
test('other source identity comes from selected UI or canonical play URL only',()=>{
    assert.equal(A.historyContext(doc([['ep3','第3集',true]]),'https://www.cupfox.in/vod-detail/123.html').program.episode,'ep3');
    assert.equal(A.historyContext(doc([['EP5','第5集',true]]),'https://yhdmoe.com/watch/123').program.episode,'EP5');
    assert.equal(A.historyContext(doc([]),'https://www.pkavi.com/py/123-2-5.html').label,'线路 2 · 第5集');
    assert.equal(A.historyContext(doc([]),'https://evil.test/py/123-2-5.html'),null);
});
