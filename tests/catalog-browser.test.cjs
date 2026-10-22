const {test}=require('node:test');
const assert=require('node:assert/strict');
const {groupResults,createBrowser}=require('../static/js/catalog-browser.js');

const row=(title='开端',year='2022',page='https://ddys.io/movie/reset')=>({title,year,page_url:page,poster_url:'https://img.ddys.io/movies/reset.webp'});
test('unified film grouping merges only equal titles AND known years, keeps all validated source choices',()=>{
    const groups=groupResults([
        {source:'ddys',name:'低端',rows:[row(),row()]},
        {source:'huarw',name:'华人',rows:[row('开端',2022,'https://huarw.com/movie/123'),row('开端',2025,'https://huarw.com/movie/456')]},
        {source:'cupfox',rows:[row('开端',null,'https://www.cupfox.in/vod-detail/10.html'),row('开端',null,'https://www.cupfox.in/vod-detail/11.html')]},
    ]);
    assert.equal(groups.length,4);assert.equal(groups[0].choices.length,2);
    assert.deepEqual(groups.map(g=>g.year),['2022','2025','','']);
});
test('unknown hosts, blank titles, script URLs and credentialed covers cannot enter film cards',()=>{
    const groups=groupResults([{source:'ddys',rows:[row('',2022),row('x',2022,'javascript:alert(1)'),row('x',2022,'https://evil.test/movie/x'),{...row(),poster_url:'https://img.ddys.io/a.jpg?token=secret'}]}]);
    assert.equal(groups.length,1);assert.equal(groups[0].poster,'');
});

function fixture(sources=['ddys','huarw','cupfox']) {
    function node(tag='div') {return {tagName:tag,children:[],handlers:{},attributes:{},dataset:{},hidden:false,value:'',textContent:'',
        addEventListener(k,f){this.handlers[k]=f;},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=[...nodes];},
        setAttribute(k,v){this.attributes[k]=v;},focus(){},querySelectorAll(){return [];}};}
    const elements=new Map();
    for(const id of ['sourceDiscovery','discoveryQuery','discoveryWelcome','discoveryLive','discoveryLiveResults','discoveryLiveStatus',
        'discoveryForm','discoveryClear','catalogBack','catalogResultCount','catalogResultTitle','catalogSkeleton','catalogEmpty',
        'catalogSearchNotes','catalogSearchNotesBody','catalogSourceChoices','catalogDetailFacts','catalogDetailPoster','recommendationTitle'])elements.set(id,node());
    const root=elements.get('sourceDiscovery');root.dataset.catalogMode='films';
    const choices=sources.map(id=>Object.assign(node('input'),{dataset:{liveSource:id,sourceName:id}}));
    root.querySelectorAll=selector=>selector==='[data-live-source]'?choices:[];
    return {elements,doc:{getElementById:id=>elements.get(id),createElement:tag=>node(tag)}};
}
test('search shows one flat grid, max two requests, folds failures away and never loads details automatically',async()=>{
    const f=fixture();let active=0,peak=0;const requests=[];
    const browser=createBrowser(f.doc,async(url,options)=>{
        requests.push(url);assert.equal(options.credentials,'omit');active++;peak=Math.max(active,peak);
        await new Promise(r=>setTimeout(r,5));active--;
        const {source}=JSON.parse(options.body);
        return {ok:true,json:async()=>({source_id:source,status:source==='cupfox'?'unavailable':'ok',results:[row('开端',2022,source==='ddys'?'https://ddys.io/movie/reset':'https://huarw.com/movie/1')]})};
    });
    assert.equal(requests.length,0,'home must not search automatically');
    f.elements.get('discoveryQuery').value='开端';await browser.run();
    assert.equal(peak,2);assert.equal(requests.length,3);
    assert.equal(f.elements.get('discoveryLiveResults').children.length,1);
    assert.match(f.elements.get('discoveryLiveResults').children[0].children[2].textContent,/2 个来源/);
    assert.equal(f.elements.get('catalogSearchNotes').hidden,false);
    assert.equal(f.elements.get('discoveryLive').attributes['aria-busy'],'false');
    browser.home();assert.equal(f.elements.get('discoveryWelcome').hidden,false);
    assert.equal(f.elements.get('discoveryLive').hidden,true);
});
test('late replies after returning home or a new query cannot overwrite the current grid',async()=>{
    const f=fixture(['ddys']);const pending=[];
    const browser=createBrowser(f.doc,(_url,opts)=>new Promise(resolve=>pending.push({resolve,opts})));
    f.elements.get('discoveryQuery').value='旧片';const first=browser.run();browser.home();
    assert.equal(pending[0].opts.signal.aborted,true);
    f.elements.get('discoveryQuery').value='新片';const second=browser.run();
    pending[1].resolve({ok:true,json:async()=>({source_id:'ddys',status:'ok',results:[row('新片')]})});await second;
    pending[0].resolve({ok:true,json:async()=>({source_id:'ddys',status:'ok',results:[row('旧片')]})});await first;
    assert.equal(f.elements.get('discoveryLiveResults').children.length,1);
    assert.equal(f.elements.get('discoveryLiveResults').children[0].children[1].textContent,'新片');
});
test('native back dismisses details before clearing search; no requery and retained result nodes',async()=>{
    const f=fixture(['ddys']);let calls=0;
    f.doc.defaultView={};
    for(const id of ['discoveryDetail','discoveryDetailClose','discoveryEpisodeFilter','discoveryEpisodeMore'])f.elements.set(id,f.doc.createElement('div'));
    const panel=f.elements.get('discoveryDetail');panel.close=function(){this.open=false;};
    const browser=createBrowser(f.doc,async()=>{calls++;return {ok:true,json:async()=>({source_id:'ddys',status:'ok',results:[row()]})};});
    f.elements.get('discoveryQuery').value='开端';await browser.run();
    const cards=f.elements.get('discoveryLiveResults').children;
    panel.open=true;
    assert.equal(browser.back(),true);assert.equal(panel.open,false);
    assert.equal(f.elements.get('discoveryQuery').value,'开端');
    assert.equal(f.elements.get('discoveryLiveResults').children,cards);assert.equal(calls,1);
    assert.equal(f.doc.defaultView.TogetherWatchCatalogNavigation.back(),true);
    assert.equal(f.elements.get('discoveryWelcome').hidden,false);assert.equal(browser.back(),false);
});
test('no enabled sources and empty input do not issue network queries',async()=>{
    const f=fixture([]);let calls=0;const browser=createBrowser(f.doc,()=>{calls++;throw Error('unexpected');});
    await browser.run();assert.equal(calls,0);
    f.elements.get('discoveryQuery').value='影片';await browser.run();assert.equal(calls,0);
    assert.match(f.elements.get('discoveryLiveStatus').textContent,/暂未开放/);
});

test('unsupported and verification queries offer only code-owned original search URLs inside notes',async()=>{
    const f=fixture(['kanju','233dm']);
    const browser=createBrowser(f.doc,async(_url,options)=>{
        const {source}=JSON.parse(options.body);
        return {ok:true,json:async()=>({source_id:source,status:source==='kanju'?'client_required':'verification_required',url:'javascript:alert(1)'})};
    });
    f.elements.get('discoveryQuery').value='测试 剧';await browser.run();
    const notes=f.elements.get('catalogSearchNotesBody').children;
    assert.equal(notes.length,2);
    for(const note of notes){
        const link=note.children.find(node=>node.tagName==='a');
        assert.ok(link);assert.equal(link.target,'_self');assert.equal(link.rel,'noreferrer');
        const url=new URL(link.href);
        assert.equal(url.protocol,'https:');assert.ok(['www.kanju.ai','www.233dm.com'].includes(url.hostname));
        assert.equal(url.searchParams.get(url.hostname==='www.kanju.ai'?'q':'wd'),'测试 剧');
    }
    assert.equal(f.elements.get('catalogSearchNotes').open,false);
    assert.equal(f.elements.get('discoveryLiveResults').children.length,0);
});

test('failed server search offers a bounded single-source retry and an original search with the same title',async()=>{
    const f=fixture(['huarw']);let count=0;
    const browser=createBrowser(f.doc,async()=>({ok:true,json:async()=>({source_id:'huarw',status:++count===1?'unavailable':'ok',results:[row('测试',2022,'https://huarw.com/movie/123')]})}));
    f.elements.get('discoveryQuery').value='测试';await browser.run();
    const note=f.elements.get('catalogSearchNotesBody').children[0];
    const retry=note.children.find(n=>n.tagName==='button'),link=note.children.find(n=>n.tagName==='a');
    assert.equal(retry.disabled,false);assert.equal(link.href,'https://huarw.com/search?wd='+encodeURIComponent('测试'));
    await retry.handlers.click();assert.equal(count,2);
    assert.equal(f.elements.get('discoveryLiveResults').children.length,1);
    assert.match(note.children[0].textContent,/已完成/);
});

test('verification and access-blocked failures give different actions and never auto-open original windows',async()=>{
    const saved=global.twSourceMetadata;const calls=[];
    global.twSourceMetadata={supportedSources:['pkavi','huarw'],request:async(id,kind,payload,interactive)=>{
        calls.push(interactive);return {source_id:payload.source,status:payload.source==='pkavi'?'verification_required':'access_blocked'};
    },cancel(){}};
    try {
        const f=fixture(['pkavi','huarw']),browser=createBrowser(f.doc,()=>{throw Error('must use client');});
        f.elements.get('discoveryQuery').value='测试';await browser.run();
        assert.deepEqual(calls,[false,false]);
        const notes=f.elements.get('catalogSearchNotesBody').children;
        assert.ok(notes[0].children.some(n=>n.tagName==='button' && /手动验证/.test(n.textContent)));
        assert.match(notes[1].children[0].textContent,/拒绝/);assert.equal(notes[1].children.length,1);
    } finally {global.twSourceMetadata=saved;}
});
