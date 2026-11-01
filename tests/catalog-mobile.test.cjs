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

test('atmosphere follows only healthy loaded hero images and clears stale / desktop copies',()=>{
    const f=fixture(),attributes={};
    const copy={hidden:true,setAttribute(k,v){attributes[k]=v;},getAttribute:k=>attributes[k],removeAttribute(k){delete attributes[k];}};
    const picture={currentSrc:'https://images.example/first.jpg',complete:true,naturalWidth:800};
    let healthy=true,mobile=true;
    f.nodes.catalogMobileAtmosphere={querySelector:()=>copy};
    f.nodes.catalogHeroImage={hidden:false,querySelector:()=>healthy?picture:null,addEventListener(){}};
    f.doc.defaultView.matchMedia=()=>({matches:mobile});
    const api=init(f.doc);
    assert.equal(copy.hidden,false);assert.equal(attributes.src,picture.currentSrc);
    picture.currentSrc='https://images.example/replacement.jpg';api.syncAtmosphere();
    assert.equal(attributes.src,picture.currentSrc);
    healthy=false;api.syncAtmosphere();assert.equal(copy.hidden,true);assert.equal(attributes.src,undefined);
    healthy=true;picture.naturalWidth=0;api.syncAtmosphere();assert.equal(attributes.src,undefined);
    picture.naturalWidth=800;picture.currentSrc='javascript:alert(1)';api.syncAtmosphere();assert.equal(attributes.src,undefined);
    picture.currentSrc='https://images.example/last.jpg';api.syncAtmosphere();assert.equal(copy.hidden,false);
    mobile=false;api.syncAtmosphere();assert.equal(copy.hidden,true);assert.equal(attributes.src,undefined);
    mobile=true;f.nodes.catalogHeroImage.hidden=true;api.syncAtmosphere();assert.equal(attributes.src,undefined);
});

test('sticky masthead is opaque only after scrolling and restores at the top',()=>{
    const f=fixture();init(f.doc);
    assert.equal(f.classes.has('catalog-scrolled'),false);
    f.doc.defaultView.scrollY=140;f.events.scroll();assert.equal(f.classes.has('catalog-scrolled'),true);
    f.doc.defaultView.scrollY=0;f.events.scroll();assert.equal(f.classes.has('catalog-scrolled'),false);
});
