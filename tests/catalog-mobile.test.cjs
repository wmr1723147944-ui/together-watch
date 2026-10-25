const {test}=require('node:test');
const assert=require('node:assert/strict');
const {init}=require('../static/js/catalog-mobile.js');

function fixture() {
    const nodes={},events={},viewportEvents={},classes=new Set(),calls=[];
    const doc={activeElement:null,body:{classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}}},getElementById:id=>nodes[id],addEventListener:(name,fn)=>events[name]=fn};
    for(const id of ['catalogMobileHome','catalogMobileSearch','discoveryQuery','discoveryLive','discoveryForm']) {
        nodes[id]={attributes:{},handlers:{},tagName:id==='discoveryQuery'?'INPUT':'BUTTON',hidden:false,
            setAttribute(k,v){this.attributes[k]=v;},toggleAttribute(k,on){if(on)this.attributes[k]='';else delete this.attributes[k];},
            addEventListener(k,fn){this.handlers[k]=fn;},focus(){doc.activeElement=this;},blur(){doc.activeElement=null;}};
    }
    nodes.discoveryLive.hidden=true;
    doc.defaultView={innerHeight:844,visualViewport:{height:844,addEventListener:(k,fn)=>viewportEvents[k]=fn},
        scrollTo:args=>calls.push(['scroll',args]),addEventListener:(k,fn)=>events[k]=fn,
        TogetherWatchCatalogNavigation:{home:focus=>{calls.push(['home',focus]);nodes.discoveryLive.hidden=true;}},
        matchMedia:()=>({matches:true})};
    return {doc,nodes,events,viewportEvents,classes,calls};
}
test('mobile search focuses existing search without navigation or extra queries; home does not reopen keyboard',()=>{
    const f=fixture(),api=init(f.doc);
    assert.equal(f.nodes.catalogMobileHome.attributes['aria-current'],'page');
    f.nodes.catalogMobileSearch.handlers.click();
    assert.equal(f.doc.activeElement,f.nodes.discoveryQuery);
    assert.equal(f.nodes.catalogMobileSearch.attributes['aria-current'],'page');
    assert.equal(f.calls.some(c=>c[0]==='home'),false);
    f.nodes.discoveryLive.hidden=false;f.nodes.discoveryForm.handlers.submit();
    assert.equal(f.doc.activeElement,null);assert.equal(f.nodes.catalogMobileSearch.attributes['aria-current'],'page');
    f.nodes.catalogMobileHome.handlers.click();
    assert.deepEqual(f.calls.find(c=>c[0]==='home'),['home',false]);
    assert.equal(f.doc.activeElement,null);assert.equal(f.nodes.catalogMobileHome.attributes['aria-current'],'page');
    assert.equal(f.nodes.catalogMobileSearch.attributes['aria-current'],undefined);
    assert.ok(api);
    f.classes.add('catalog-keyboard-open');f.nodes.catalogMobileHome.handlers.click();
    assert.equal(f.classes.has('catalog-keyboard-open'),false,'explicit home always restores bottom navigation');
});
test('bottom tabs hide for keyboard but not URL bar scroll, and restore after blur',()=>{
    const f=fixture();init(f.doc);f.nodes.discoveryQuery.focus();
    f.doc.defaultView.visualViewport.height=790;f.viewportEvents.resize();
    assert.equal(f.classes.has('catalog-keyboard-open'),false);
    f.doc.defaultView.visualViewport.height=500;f.viewportEvents.resize();
    assert.equal(f.classes.has('catalog-keyboard-open'),true);
    f.nodes.discoveryQuery.blur();f.events.focusout();
    assert.equal(f.classes.has('catalog-keyboard-open'),false);
    f.nodes.discoveryQuery.focus();f.doc.defaultView.visualViewport.height=390;f.events.orientationchange();
    assert.equal(f.classes.has('catalog-keyboard-open'),false,'rotation resets the keyboard baseline');
});
test('mobile helper is optional and never blurs desktop search submission',()=>{
    assert.equal(init({getElementById:()=>null}),null);
    const f=fixture();f.doc.defaultView.matchMedia=()=>({matches:false});init(f.doc);
    f.nodes.discoveryQuery.focus();f.nodes.discoveryForm.handlers.submit();
    assert.equal(f.doc.activeElement,f.nodes.discoveryQuery);
});
