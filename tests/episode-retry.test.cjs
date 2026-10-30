const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDetails}=require('../static/js/source-discovery.js');
const api=require('../static/js/catalog-adapters.js');
const row={title:'测试影片',page_url:'https://www.kanju.ai/player/test',current_episode:'ep-one'};
const req=api.request('detail',{source:'kanju',page_url:row.page_url});
const success=()=>api.normalizeResult(req,{status:'ok',episodes:[{id:'ep-one',title:'第1集'},{id:'ep-two',title:'第2集'}]});
function fixture(){
    const nodes=new Map();
    const make=tag=>({tag,textContent:'',children:[],listeners:{},open:false,
        append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
        addEventListener(name,fn){this.listeners[name]=fn;},setAttribute(name,value){this[name]=value;},
        showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();}});
    for(const id of ['discoveryDetail','discoveryDetailTitle','discoveryDetailStatus','discoveryDetailDescription',
        'discoveryEpisodes','discoveryDetailOriginal','discoveryDetailClose'])nodes.set(id,make('div'));
    const details=createDetails({getElementById:id=>nodes.get(id),createElement:make},()=>{throw Error('unexpected server call');});
    return {nodes,details,buttons:()=>nodes.get('discoveryEpisodes').children.filter(n=>n.tag==='button')};
}
test('empty, busy, cancelled and unavailable directories can retry in place and retain current episode',async t=>{
    t.after(()=>delete global.twSourceMetadata);
    for(const status of ['ok','no_episodes','busy','cancelled','unavailable','verification_required']){
        const calls=[],f=fixture();
        global.twSourceMetadata={supportedSources:['kanju'],cancel:()=>{},request:async(id,kind,payload,interactive)=>{
            calls.push({kind,payload,interactive});return calls.length===1?api.normalizeResult(req,{status,episodes:[]}):success();
        }};
        await f.details.open('kanju',row);
        assert.equal(f.buttons()[0].textContent,'重试读取集数',status);
        assert.equal(f.buttons()[1].textContent,'打开原站并继续读取集数');
        await f.buttons()[0].listeners.click();
        assert.deepEqual(calls,[1,2].map(()=>({kind:'detail',payload:{source:'kanju',page_url:row.page_url},interactive:false})));
        const links=f.nodes.get('discoveryEpisodes').children;
        assert.equal(links.length,2);assert.equal(links[0]['aria-current'],'true');
        assert.equal(links[1].href,'/discover/play/kanju/test/ep-two');
        assert.equal(f.nodes.get('discoveryDetail').open,true);f.details.close();
    }
});
test('native failure has retry and original-site access is only interactive after a click',async t=>{
    t.after(()=>delete global.twSourceMetadata);
    const f=fixture(),calls=[];
    global.twSourceMetadata={supportedSources:['kanju'],cancel:()=>{},request:async(id,kind,payload,interactive)=>{
        calls.push(interactive);if(!interactive)throw Error('timeout');return success();
    }};
    await f.details.open('kanju',row);
    assert.deepEqual(calls,[false]);
    await f.buttons()[1].listeners.click();
    assert.deepEqual(calls,[false,true]);assert.equal(f.buttons().length,0);f.details.close();
});
test('closing a pending directory cancels it and discards late error or result',async t=>{
    t.after(()=>delete global.twSourceMetadata);
    for(const rejectResult of [false,true]){
        let resolve,reject,cancelled=0;
        global.twSourceMetadata={supportedSources:['kanju'],cancel:()=>cancelled++,request:()=>new Promise((yes,no)=>{resolve=yes;reject=no;})};
        const f=fixture(),pending=f.details.open('kanju',row);
        f.details.close();assert.equal(cancelled,1);
        if(rejectResult)reject(Error('late'));else resolve(success());
        await pending;assert.equal(f.nodes.get('discoveryDetail').open,false);
        assert.equal(f.nodes.get('discoveryEpisodes').children.length,0);
    }
});
test('server timeout gets an in-panel retry without resetting playback',async()=>{
    const f=fixture(),nodes=f.nodes;let calls=0;
    const details=createDetails({getElementById:id=>nodes.get(id),createElement:tag=>({tag,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}})},
        async()=>{calls++;throw Error('timeout');});
    await details.open('kanju',row);
    assert.match(nodes.get('discoveryDetailStatus').textContent,/没有切换当前影片/);
    await f.buttons()[0].listeners.click();assert.equal(calls,2);details.close();
});
