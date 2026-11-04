const {test}=require('node:test'),assert=require('node:assert/strict');
const H=require('../static/js/watch-history.js'),create=require('../static/js/account.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const p={source:'kanju',item:'av-test',episode:'ep1'},q={...p,episode:'ep2'};
function harness(existing){
    const map=existing||new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
    const local=H.createStore(storage),db=new Map();let current=null,offline=false,csrf='csrf-guest';const calls=[];
    const empty=()=>({rows:[],deleted:[],enabled:true,revision:0});
    const response=(status,data)=>({ok:status<400,status,json:async()=>clone(data)});
    async function fetch(path,options){
        if(offline)throw Error('offline');
        const name=path.split('/').at(-1),data=options.body?JSON.parse(options.body):{};calls.push({name,options,data});
        if(name==='session')return response(200,{user:current,csrf});
        if(name==='register'||name==='login'){
            current={id:data.username,username:data.username,display_name:data.username};csrf='csrf-'+current.id;
            if(!db.has(current.id))db.set(current.id,empty());return response(200,{user:current,csrf});
        }
        if(!current)return response(401,{code:'unauthenticated'});
        if(options.headers['X-Account-ID']!==current.id)return response(409,{code:'account_changed'});
        if(name==='logout'){current=null;csrf='guest-again';return response(200,{user:null,csrf});}
        if(name==='history'){
            const history=db.get(current.id);
            if(options.method==='GET')return response(200,history);
            if(data.revision!==history.revision)return response(409,{code:'history_conflict',history});
            if(data.clear){history.deleted=history.rows.map(H.identity);history.rows=[];}
            for(const key of data.deletes||[]){history.rows=history.rows.filter(r=>H.identity(r)!==key);history.deleted.push(key);}
            if('enabled' in data)history.enabled=data.enabled;
            if(history.enabled)for(const row of data.upserts||[]){history.rows=[row,...history.rows.filter(r=>H.identity(r)!==H.identity(row))].slice(0,100);history.deleted=history.deleted.filter(k=>k!==H.identity(row));}
            history.revision++;return response(200,history);
        }
        throw Error('unexpected '+name);
    }
    const env={storage,fetch,notify(){}},api=create({...H,localStore:local},env);
    return {api,map,local,db,calls,env,setOffline:v=>offline=v,setUser:v=>current=v};
}
const record=(store,program=p,time=40)=>store.record(program,{ready:true,time,duration:300});

test('account history groups legacy episodes from different devices, syncs a whole-card deletion, and preserves guest history',async()=>{
    const h=harness(),other={...p,item:'other'};
    record(h.local,p,30);await h.api.refresh();await h.api.authenticate('login',{username:'alice'});
    const snap=h.db.get('alice'),clock=Date.now()-10000;
    snap.rows=[{...q,time:160,updated:clock},{...other,time:50,updated:clock+500},{...p,time:31,updated:clock+1000}];
    snap.revision++;await h.api.sync(false);
    const titles=H.listTitles(h.api.store.list());assert.deepEqual(titles.map(H.identity),[H.identity(p),H.identity(other)]);
    h.api.store.prepare(titles[0]);assert.equal(h.api.store.takeResume(p,true,true),31);
    h.setOffline(true);h.api.store.removeTitle(p);assert.deepEqual(h.api.store.list().map(H.identity),[H.identity(other)]);
    // A stale write for an old episode and a concurrent change to a different
    // title must neither resurrect the deleted show nor erase the other title.
    assert.equal(record(h.api.store,q,170),false);
    snap.rows[1].time=61;snap.revision++;
    h.setOffline(false);await h.api.flush();await h.api.flush();await h.api.sync(false);
    assert.deepEqual(snap.rows.map(H.identity),[H.identity(other)]);assert.equal(snap.rows[0].time,61);
    assert.equal(h.local.list()[0].time,30);assert.deepEqual(new Set(snap.deleted),new Set([H.identity(p),H.identity(q)]));
});

test('guest stays local, login does not silently import, explicit import keeps guest original',async()=>{
    const h=harness();await h.api.refresh();h.api.store.remember(p,{title:'本地作品',label:'第一集'});record(h.api.store);
    assert.equal(h.calls.some(c=>c.name==='history'),false);
    const before=h.map.get(H.KEY);await h.api.authenticate('register',{username:'alice',password:'not-saved'});
    assert.deepEqual(h.api.store.list(),[]);assert.equal(h.map.get(H.KEY),before);
    assert.equal(await h.api.importLocal(),1);assert.equal(h.db.get('alice').rows[0].time,40);
    assert.equal(h.map.get(H.KEY),before);assert.ok(![...h.map.values()].join('').includes('not-saved'));
    assert.ok(![...h.map.values()].join('').includes('csrf-alice'));
});

test('a full title deletion behind queued work never silently drops episode deletions at the API limit',async()=>{
    const h=harness();await h.api.refresh();await h.api.authenticate('login',{username:'batch'});
    const snap=h.db.get('batch');
    snap.rows=Array.from({length:100},(_,i)=>({...p,episode:'ep'+i,time:10,updated:100+i}));
    snap.revision++;await h.api.sync(false);
    h.api.store.setEnabled(true);
    h.api.store.removeTitle(p);
    await h.api.flush();assert.equal(snap.rows.length,1,'the remaining delete must stay queued');
    await h.api.flush();assert.equal(snap.rows.length,0);
    const posts=h.calls.filter(c=>c.name==='history'&&c.options.method==='POST');
    assert.deepEqual(posts.map(c=>c.data.deletes.length),[99,1]);
    assert.equal(new Set(snap.deleted).size,100);
});

test('logout restores guest data and removes account cache; another account is isolated',async()=>{
    const h=harness();record(h.local,p,20);await h.api.refresh();await h.api.authenticate('login',{username:'alice'});
    h.api.store.remember(q,{title:'账号作品'});record(h.api.store,q,100);await h.api.flush();
    assert.equal(h.local.list()[0].time,20);assert.equal(h.api.store.list()[0].time,100);
    await h.api.logout();assert.equal(h.api.store.list()[0].time,20);assert.equal(h.map.has(h.api.prefix+'alice'),false);
    await h.api.authenticate('login',{username:'bob'});assert.deepEqual(h.api.store.list(),[]);
    record(h.api.store,p,30);await h.api.flush();assert.equal(h.db.get('alice').rows[0].time,100);
});

test('offline account samples remain isolated and upload after reconnect',async()=>{
    const h=harness();await h.api.refresh();await h.api.authenticate('login',{username:'alice'});
    h.setOffline(true);record(h.api.store);await h.api.flush();assert.equal(h.api.store.list()[0].time,40);assert.deepEqual(h.local.list(),[]);
    await assert.rejects(h.api.logout(),/未同步/);
    h.setOffline(false);await h.api.refresh();assert.equal(h.db.get('alice').rows[0].time,40);
    await h.api.logout();assert.deepEqual(h.local.list(),[]);
});

test('remote delete conflicts do not resurrect old progress; explicit fresh selection may record again',async()=>{
    const h=harness();await h.api.refresh();await h.api.authenticate('login',{username:'alice'});record(h.api.store);await h.api.flush();
    const remote=h.db.get('alice');remote.rows=[];remote.deleted=[H.identity(p)];remote.revision++;
    record(h.api.store,p,60);await h.api.flush();assert.deepEqual(h.api.store.list(),[]);assert.deepEqual(remote.rows,[]);
    assert.equal(record(h.api.store,p,65),false);
    h.api.store.remember(p,{title:'重新打开'});record(h.api.store,p,70);await h.api.flush();assert.equal(remote.rows[0].time,70);
});

test('unrelated remote edits do not discard current episode progress on conflict',async()=>{
    const h=harness();await h.api.refresh();await h.api.authenticate('login',{username:'alice'});
    record(h.api.store,p,180);const remote=h.db.get('alice');remote.rows=[{...q,time:30,updated:1}];remote.revision++;
    await h.api.flush();assert.equal(h.api.store.list().find(r=>H.identity(r)===H.identity(p)).time,180);
    await h.api.flush();assert.equal(remote.rows.find(r=>H.identity(r)===H.identity(p)).time,180);
});
test('newer backward seek wins conflict while newer remote observation and disabled history win',async()=>{
    const h=harness();await h.api.refresh();await h.api.authenticate('login',{username:'alice'});
    record(h.api.store,p,30);const remote=h.db.get('alice');remote.rows=[{...p,time:180,updated:1}];remote.revision++;
    await h.api.flush();await h.api.flush();assert.equal(remote.rows[0].time,30);
    record(h.api.store,p,40);remote.rows=[{...p,time:250,updated:Date.now()+1000}];remote.revision++;
    await h.api.flush();assert.equal(h.api.store.list()[0].time,250);
    record(h.api.store,q,60);remote.enabled=false;remote.revision++;await h.api.flush();
    assert.equal(h.api.store.list().some(r=>H.identity(r)===H.identity(q)),false);
});
test('small exit flush can survive navigation and retains account binding',async()=>{
    const h=harness();await h.api.refresh();await h.api.authenticate('login',{username:'alice'});record(h.api.store);
    await h.api.flush({keepalive:true});const call=h.calls.filter(c=>c.name==='history'&&c.options.method==='POST').at(-1);
    assert.equal(call.options.keepalive,true);assert.equal(call.options.headers['X-Account-ID'],'alice');
});

test('disabled account history, delete, clear and cross-device refresh preserve local history',async()=>{
    const h=harness();record(h.local);await h.api.refresh();await h.api.authenticate('login',{username:'alice'});
    record(h.api.store);await h.api.flush();h.api.store.setEnabled(false);await h.api.flush();assert.equal(record(h.api.store,p,60),false);
    h.api.store.setEnabled(true);await h.api.flush();h.api.store.remove(p);await h.api.flush();assert.equal(h.db.get('alice').rows.length,0);
    h.api.store.remember(p,{});record(h.api.store);await h.api.flush();h.api.store.clear();await h.api.flush();assert.equal(h.db.get('alice').rows.length,0);
    assert.equal(h.local.list().length,1);
});

test('logged-out or changed server session never receives another account pending data',async()=>{
    const h=harness();await h.api.refresh();await h.api.authenticate('login',{username:'alice'});record(h.api.store);
    h.setUser({id:'bob',username:'bob',display_name:'Bob'});h.db.set('bob',{rows:[],deleted:[],enabled:true,revision:0});
    await h.api.flush();assert.equal(h.api.user,null);assert.deepEqual(h.db.get('bob').rows,[]);assert.deepEqual(h.api.store.list(),[]);
    await h.api.refresh();assert.equal(h.api.user.id,'bob');assert.deepEqual(h.api.store.list(),[]);
});

test('history samples arriving during a GET survive snapshot replacement',async()=>{
    const h=harness();await h.api.refresh();await h.api.authenticate('login',{username:'alice'});
    const original=h.env.fetch;let resolve;
    h.env.fetch=async(path,options)=>{const result=await original(path,options);if(path.endsWith('/history')&&options.method==='GET')await new Promise(r=>resolve=r);return result;};
    const pending=h.api.sync(false);await new Promise(r=>setImmediate(r));record(h.api.store,p,85);resolve();await pending;
    assert.equal(h.api.store.list()[0].time,85);h.env.fetch=original;await h.api.flush();assert.equal(h.db.get('alice').rows[0].time,85);
});

test('stale same-device account responses are ignored after owner switch',async()=>{
    const h=harness();await h.api.refresh();await h.api.authenticate('login',{username:'alice'});record(h.api.store);await h.api.flush();
    const original=h.env.fetch;let resolve;
    h.env.fetch=async(path,options)=>{const result=await original(path,options);if(path.endsWith('/history')&&options.method==='GET'&&options.headers['X-Account-ID']==='alice')await new Promise(r=>resolve=r);return result;};
    const pending=h.api.sync(false);await new Promise(r=>setImmediate(r));
    h.map.delete(h.api.ownerKey);h.setUser(null);await h.api.ownerChanged();resolve();await pending;
    assert.equal(h.api.user,null);assert.deepEqual(h.api.store.list(),[]);assert.equal(h.map.has(h.api.prefix+'alice'),false);
});

test('private storage unavailable and anonymous offline modes do not stop playback',async()=>{
    const h=harness();h.setOffline(true);await h.api.refresh();assert.equal(record(h.api.store),true);assert.equal(h.local.list().length,1);
    const storage={getItem(){throw Error('disabled');},setItem(){throw Error('disabled');},removeItem(){}};
    const api=create(H,{storage,fetch:async()=>{throw Error('offline');}});await api.refresh();assert.equal(record(api.store),false);assert.deepEqual(api.store.list(),[]);
});

test('account cache still works when quota prevents storage writes but reads work',async()=>{
    const h=harness();h.env.storage.setItem=()=>{throw Error('quota');};
    await h.api.refresh();await h.api.authenticate('login',{username:'alice'});record(h.api.store,p,42);await h.api.flush();
    assert.equal(h.api.store.list()[0].time,42);assert.equal(h.db.get('alice').rows[0].time,42);
    await h.api.logout();assert.deepEqual(h.api.store.list(),[]);
});
