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
