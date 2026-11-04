const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const H=require('../static/js/watch-history.js');

function fixture(enabled='kanju,cupfox') {
    function node(tag='div') { return {tagName:tag,children:[],handlers:{},dataset:{},hidden:false,textContent:'',
        append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
        addEventListener(event,handler){this.handlers[event]=handler;},showModal(){this.open=true;},close(){this.open=false;}}; }
    const ids=['watchHistoryDialog','watchHistoryList','continueWatching','continueWatchingList','watchHistoryEnabled',
        'watchHistoryClose','watchHistoryClear','watchHistoryConfirm','watchHistoryConfirmNo','watchHistoryConfirmYes'];
    const elements=new Map(ids.map(id=>[id,node()]));elements.get('watchHistoryDialog').dataset.enabledSources=enabled;
    let ready;const events={},data=new Map(),posters=[];
    const storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
    const original=H.createStore(storage);
    const retired={source:'huarw',item:'123',episode:'123-1'},active={source:'kanju',item:'av-test',episode:'ep-1'};
    for(const p of [active,retired]){
        original.remember(p,{title:p.source,label:'第1集',poster:'https://huarw.com/old.jpg'});
        original.record(p,{ready:true,time:100,duration:900});
    }
    const before=data.get(H.KEY);
    const context=vm.createContext({URL,localStorage:storage,document:{getElementById:id=>elements.get(id),
        createElement:node,querySelectorAll:()=>[],addEventListener:(_event,handler)=>ready=handler},
        addEventListener:(event,handler)=>events[event]=handler,
        TogetherWatchDiscovery:{safeLaunchPath:(_s,_i,_e,p)=>p,addPoster:(_doc,_art,url)=>posters.push(url)}});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/js/watch-history.js'),'utf8'),context);ready();
    return {elements,data,before,original,retired,active,events,posters};
}

test('withdrawn history stays readable/deletable but is not linked or offered in continue watching',()=>{
    const f=fixture(),cards=f.elements.get('watchHistoryList').children;
    assert.equal(cards.length,2);assert.equal(f.data.get(H.KEY),f.before,'render does not delete guest/account history');
    const retired=cards[0],active=cards[1];
    assert.equal(retired.children[0].tagName,'div');assert.equal(retired.children[0].href,undefined);
    assert.equal(retired.children[0].handlers.click,undefined);
    assert.match(retired.children[0].children[2].textContent,/来源已移除或未启用/);
    assert.equal(f.posters[0],'','do not request artwork from the withdrawn source');
    assert.equal(active.children[0].tagName,'a');assert.equal(active.children[0].href,'/discover/play/kanju/av-test/ep-1');
    assert.equal(f.elements.get('continueWatchingList').children.length,1);
    assert.equal(f.elements.get('continueWatching').hidden,false);
    active.children[0].handlers.click();assert.equal(f.original.takeResume(f.active,true,true),100);
    retired.children[1].onclick();assert.equal(f.original.list().length,1);
    assert.equal(f.original.list()[0].source,'kanju');
});

test('all sources disabled hides continue watching without wiping records',()=>{
    const f=fixture('');assert.equal(f.elements.get('continueWatching').hidden,true);
    assert.equal(f.elements.get('continueWatchingList').children.length,0);
    assert.equal(f.elements.get('watchHistoryList').children.length,2);
    assert.equal(f.data.get(H.KEY),f.before);
    assert.ok(f.elements.get('watchHistoryList').children.every(card=>card.children[0].href===undefined));
});

test('both history surfaces show one card per source/item and resume the most recent episode, even on a rewatch',()=>{
    const f=fixture(), original=f.active,next={...original,episode:'ep-2'};
    // Deliberately store cloud/import rows out of order. The last viewing was
    // back on episode one, not the highest episode or greatest time.
    const s=JSON.parse(f.data.get(H.KEY)),base=s.rows.find(r=>r.source==='kanju');
    s.rows=[{...base,...next,label:'第2集',time:700,updated:2000},
        {...s.rows.find(r=>r.source==='huarw'),updated:1000},
        {...base,label:'第1集',time:45,updated:3000}];
    f.data.set(H.KEY,JSON.stringify(s));f.events['tw-history-change']();
    const card=f.elements.get('watchHistoryList').children[0],shelf=f.elements.get('continueWatchingList').children;
    assert.equal(f.elements.get('watchHistoryList').children.length,2);assert.equal(shelf.length,1);
    for(const c of [card,shelf[0]]){
        assert.equal(c.children[0].href,'/discover/play/kanju/av-test/ep-1');
        assert.match(c.children[0].children[2].textContent,/第1集 · 看到 0:45/);
    }
    assert.equal(f.original.list().length,3,'display grouping does not erase episode progress');
    shelf[0].children[0].handlers.click();assert.equal(f.original.takeResume(original,true,true),45);
    f.original.prepare(next);
    card.children[1].onclick();assert.equal(f.original.takeResume(next,true,true),null);
    assert.deepEqual(f.original.list().map(H.identity),[H.identity(f.retired)]);
    assert.equal(f.original.record(next,{ready:true,time:701}),false,'closing an old player cannot resurrect the removed title');
});
