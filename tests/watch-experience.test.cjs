const {test}=require('node:test');
const assert=require('node:assert/strict');
const {identity,createStore}=require('../static/js/watch-history.js');
const {Timeline,clean}=require('../static/js/danmaku-core.js');
const policy=require('../desktop-app/src/policy.cjs');
const p={source:'kanju',item:'av-public',episode:'ep-12',exact_episode:true};
function harness(){let now=100000;const data=new Map();const store=createStore({getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},()=>now);return{store,data,advance:n=>now+=n};}
test('history saves only public episode identity, title and bounded timing',()=>{
    const {store,data}=harness();store.remember(p,{title:'测试影片',label:'第12集',poster:'https://cdn.example/poster.jpg',cookie:'secret'});
    store.record({...p,owner:'secret',page:'https://video.example/?token=secret'},{ready:true,time:102,duration:500,token:'secret'});
    assert.equal(store.list()[0].title,'测试影片');assert.equal(store.list()[0].time,102);
    assert.ok(![...data.values()].join('').includes('secret'));
    assert.equal(identity({...p,episode:'page'}),'');assert.equal(identity({...p,item:'../admin'}),'');
});
test('unready, unconfirmed, malformed and seeking samples cannot overwrite history',()=>{
    const {store}=harness();store.record(p,{ready:true,time:80});
    for(const sample of [{ready:false,time:10},{ready:true,seeking:true,time:15},{ready:true,time:NaN},{ready:true,time:Infinity},{ready:true,time:0}])store.record(p,sample);
    store.record({...p,exact_episode:false},{ready:true,time:100});assert.equal(store.list()[0].time,80);
});
test('resume is one-shot, expires, and never takes control of a friend or occupied room',()=>{
    for(const [owner,alone,expected] of [[true,true,80],[false,true,null],[true,false,null]]){
        const {store}=harness();store.record(p,{ready:true,time:80});store.prepare(p);assert.equal(store.takeResume(p,owner,alone),expected);assert.equal(store.takeResume(p,true,true),null);
    }
    const h=harness();h.store.record(p,{ready:true,time:80});h.store.prepare(p);h.advance(120001);assert.equal(h.store.takeResume(p,true,true),null);
});
test('history supports pause, deletion tombstone, fresh selection and complete clear',()=>{
    const {store}=harness();store.record(p,{ready:true,time:80});store.setEnabled(false);store.record(p,{ready:true,time:90});assert.equal(store.list()[0].time,80);
    store.setEnabled(true);store.remove(p);store.record(p,{ready:true,time:92});assert.equal(store.list().length,0);
    store.remember(p,{title:'重新观看'});store.record(p,{ready:true,time:100});assert.equal(store.list().length,1);
    store.prepare(p);store.clear();assert.equal(store.list().length,0);assert.equal(store.takeResume(p,true,true),null);
});
test('history is bounded and unavailable storage cannot stop playback',()=>{
    const {store}=harness();for(let i=0;i<140;i++)store.record({...p,episode:'ep-'+i},{ready:true,time:80});assert.equal(store.list().length,100);
    const broken=createStore({getItem(){throw Error('disabled')},setItem(){throw Error('quota')}});assert.deepEqual(broken.list(),[]);assert.equal(broken.record(p,{ready:true,time:80}),false);
});
test('danmaku follows media time, seeks both ways and clears on episode switch',()=>{
    const t=new Timeline();t.set([{id:'a',time:10,text:'hello'},{id:'b',time:40,text:'later'}],[]);
    assert.equal(t.at(11)[0].text,'hello');assert.deepEqual(t.at(11),t.at(11));assert.equal(t.at(42)[0].text,'later');assert.equal(t.at(10)[0].text,'hello');assert.deepEqual(t.at(19),[]);
    t.set([],[]);assert.deepEqual(t.at(11),[]);
});
test('public and friend switches, offset, density and plain-text limits are independent',()=>{
    const t=new Timeline();const pub=[{id:'a',time:10,text:'public'}],friends=[{id:'b',time:10,text:'friend',kind:'room'}];
    t.set(pub,friends,{public:false});assert.equal(t.at(11)[0].text,'friend');
    t.set(pub,friends,{room:false,offset:5});assert.deepEqual(t.at(11),[]);assert.equal(t.at(16)[0].text,'public');
    t.set(Array.from({length:100},(_,i)=>({id:String(i),time:10,text:'x'})),[],{room:false});assert.equal(t.at(11).length,6);assert.equal(new Set(t.at(11).map(r=>r.lane)).size,6);
    t.set(Array.from({length:100},(_,i)=>({id:String(i),time:10,text:'public'})),[{id:'friend',time:11,text:'friend',kind:'room'}]);assert.ok(t.at(12).some(r=>r.text==='friend'));
    assert.equal(clean({time:10,text:'<img onerror=x>'}).text,'<img onerror=x>');assert.equal(clean({time:NaN,text:'x'}),null);
});
test('desktop renderer packets reject wrong player sessions, arbitrary properties and overflow',()=>{
    const raw={session:4,enabled:true,html:'evil',items:[{time:1,text:'x'.repeat(200),lane:0,url:'secret'},{time:1,text:'no',lane:99}]};
    assert.equal(policy.danmakuOverlay(raw,5),null);const clean=policy.danmakuOverlay(raw,4);assert.equal(clean.items.length,1);assert.equal(clean.items[0].text.length,80);assert.equal(clean.items[0].url,undefined);assert.equal(clean.html,undefined);
});
