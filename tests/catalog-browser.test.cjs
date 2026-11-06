const {test}=require('node:test');
const assert=require('node:assert/strict');
const {groupResults,createBrowser,episodeRow}=require('../static/js/catalog-browser.js');

test('current episode lookup uses validated same-title identities, never arbitrary URLs',()=>{
    for(const [source,item,episode,page] of [
        ['huarw','123','123-1-2','https://huarw.com/movie/123'],
        ['cupfox','123','ep2','https://www.cupfox.in/vod-detail/123.html'],
        ['yhdmoe','123','EP2','https://yhdmoe.com/watch/123'],
        ['kanju','av_demo','ep-e2','https://www.kanju.ai/player/av_demo'],
        ['233dm','a'.repeat(24),'1-2','https://www.233dm.com/anime/'+'a'.repeat(24)+'.html'],
        ['pkavi','123','1-2','https://www.pkavi.com/mv/123.html']]) {
        assert.equal(episodeRow({source,item,episode}).page_url,page);
    }
    for(const program of [null,{}, {source:'sample',item:'sintel',episode:'video'},
        {source:'huarw',item:'123',episode:'456-1-2'}, {source:'kanju',item:'../../evil',episode:'ep-e2'},
        {source:'cupfox',item:'https://localhost',episode:'ep2'}, {source:'ddys',item:'movie',episode:'page'}])assert.equal(episodeRow(program),null);
});

test('opening current episodes keeps search context and marks the selected episode',async()=>{
    const f=fixture(['cupfox']);f.doc.defaultView={};
    for(const id of ['discoveryDetail','discoveryDetailClose','discoveryDetailTitle','discoveryDetailStatus','discoveryDetailDescription',
        'discoveryEpisodes','discoveryDetailOriginal','discoveryEpisodeFilter','discoveryEpisodeMore'])f.elements.set(id,f.doc.createElement('div'));
    const panel=f.elements.get('discoveryDetail');panel.showModal=function(){this.open=true;};panel.close=function(){this.open=false;};
    const calls=[];
    const browser=createBrowser(f.doc,async(url,options)=>{
        const payload=JSON.parse(options.body);calls.push(payload);
        return {ok:true,json:async()=>url.includes('/search')?{source_id:'cupfox',status:'ok',results:[{title:'同一部剧',page_url:'https://www.cupfox.in/vod-detail/12.html'}]}
            :{source_id:'cupfox',page_url:payload.page_url,item_id:'12',title:'同一部剧',status:'ok',episodes:[1,2,3].map(n=>({id:'ep'+n,title:'第'+n+'集',launch_path:'/discover/play/cupfox/12/ep'+n}))}};
    });
    f.elements.get('discoveryQuery').value='同一部剧';await browser.run();
    const cards=f.elements.get('discoveryLiveResults').children;
    assert.equal(browser.episodes({source:'cupfox',item:'12',episode:'ep2'}),true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(panel.open,true);assert.equal(calls.length,2);assert.equal(calls[1].page_url,'https://www.cupfox.in/vod-detail/12.html');
    assert.equal(f.elements.get('discoveryEpisodes').children[1].attributes['aria-current'],'true');
    assert.match(f.elements.get('discoveryDetailStatus').textContent,/当前房间/);
    assert.equal(browser.back(),true);assert.equal(f.elements.get('discoveryQuery').value,'同一部剧');
    assert.equal(f.elements.get('discoveryLiveResults').children,cards);
    assert.equal(browser.episodes({source:'huarw',item:'12',episode:'12-1-1'}),false,'disabled source must not query');
    assert.equal(calls.length,2);
});

test('dedicated picker has no background feed/search and closes synchronously',async()=>{
    const f=fixture(['cupfox']);f.doc.defaultView={};f.doc.body={classList:{contains:name=>name==='episode-picker'}};
    for(const id of ['discoveryDetail','discoveryDetailClose','discoveryDetailTitle','discoveryDetailStatus','discoveryDetailDescription',
        'discoveryEpisodes','discoveryDetailOriginal','discoveryEpisodeFilter','discoveryEpisodeMore','episodePickerCancel','episodePickerLoading',
        'catalogFindOtherSources','catalogSourceQuery','catalogSourceStatus'])f.elements.set(id,f.doc.createElement('div'));
    const panel=f.elements.get('discoveryDetail');panel.showModal=function(){this.open=true;};panel.close=function(){this.open=false;};
    f.elements.get('discoveryQuery').value='must not search';let calls=0;
    const browser=createBrowser(f.doc,async()=>{calls++;return {ok:true,json:async()=>({status:'unavailable'})};});
    assert.equal(calls,0);
    const navigation=f.doc.defaultView.TogetherWatchCatalogNavigation;
    f.elements.get('episodePickerCancel').onclick();assert.equal(navigation.pickerClosed(),true);
    assert.equal(browser.episodes({source:'cupfox',item:'12',episode:'ep1'}),true);
    assert.equal(navigation.pickerClosed(),false);assert.equal(f.elements.get('episodePickerLoading').hidden,true);
    assert.equal(calls,1);
    const oldBridge=global.twSourceMetadata;
    try {
        global.twSourceMetadata={supportedSources:[]};
        f.elements.get('catalogSourceQuery').value='测试影片';
        await f.elements.get('catalogFindOtherSources').onclick();
        assert.match(f.elements.get('catalogSourceStatus').textContent,/0\.6\.23.*0\.3\.27/);
        assert.equal(calls,1,'old clients should explain upgrade, not query a source they cannot switch to');
    } finally {global.twSourceMetadata=oldBridge;}
    f.elements.get('discoveryDetailClose').handlers.click();
    assert.equal(navigation.pickerClosed(),true,'do not wait for a delayed dialog close event');
    await new Promise(resolve=>setImmediate(resolve));
});

test('in-player source lookup stays in the dialog, matches full title and highlights corresponding episode',async()=>{
    const f=fixture(['cupfox','yhdmoe']);f.doc.defaultView={};
    for(const id of ['discoveryDetail','discoveryDetailClose','discoveryDetailTitle','discoveryDetailStatus','discoveryDetailDescription',
        'discoveryEpisodes','discoveryDetailOriginal','discoveryEpisodeFilter','discoveryEpisodeMore','catalogFindOtherSources','catalogSourceQuery','catalogSourceStatus'])f.elements.set(id,f.doc.createElement('div'));
    const panel=f.elements.get('discoveryDetail');let closes=0;
    panel.showModal=function(){this.open=true;};panel.close=function(){this.open=false;closes++;};
    const calls=[];
    const browser=createBrowser(f.doc,async(url,options)=>{
        const payload=JSON.parse(options.body);calls.push(payload);
        const source=payload.source,item=source==='cupfox'?'12':'34',prefix=source==='cupfox'?'ep':'EP';
        return {ok:true,json:async()=>url.includes('/search')?{source_id:source,status:'ok',results:source==='cupfox'?[]:[
            {title:'同一部剧 第二季',page_url:'https://yhdmoe.com/watch/34'},
            {title:'同一部剧 第一季',page_url:'https://yhdmoe.com/watch/35'}]}
            :{source_id:source,page_url:payload.page_url,item_id:item,title:'同一部剧 第二季',status:'ok',episodes:[1,2,3].map(n=>({id:prefix+n,title:'第'+n+'集',launch_path:`/discover/play/${source}/${item}/${prefix}${n}`}))}};
    });
    browser.episodes({source:'cupfox',item:'12',episode:'ep2'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.elements.get('catalogSourceQuery').value,'同一部剧 第二季');
    // Source discovery starts automatically after the current detail is read.
    assert.equal(closes,0,'looking up sources must not close native drawer or disturb the player');
    const buttons=f.elements.get('catalogSourceChoices').children;
    assert.equal(buttons.length,2,'do not add another season');
    buttons[1].handlers.click();await new Promise(resolve=>setImmediate(resolve));
    const links=f.elements.get('discoveryEpisodes').children;
    assert.equal(links[1].href,'/discover/play/yhdmoe/34/EP2');
    assert.equal(links[1].attributes['data-suggested'],'true');
    assert.equal(links[1].attributes['aria-current'],undefined,'different provider is not already playing');
    assert.match(f.elements.get('discoveryDetailStatus').textContent,/从所选集开头/);
    assert.equal(calls.filter(c=>c.q).length,2);
    assert.equal(panel.open,true);
});

const row=(title='开端',year='2022',page='https://ddys.io/movie/reset')=>({title,year,page_url:page,poster_url:'https://img.ddys.io/movies/reset.webp'});

test('automatic exact-title follow-up enriches the original search card as well as source choices',async()=>{
    const f=fixture(['cupfox','yhdmoe']);let queries=0;
    for(const id of ['discoveryDetail','discoveryDetailClose','discoveryDetailTitle','discoveryDetailStatus','discoveryDetailDescription',
        'discoveryEpisodes','discoveryDetailOriginal','discoveryEpisodeFilter','discoveryEpisodeMore','catalogFindOtherSources','catalogSourceQuery','catalogSourceStatus'])f.elements.set(id,f.doc.createElement('div'));
    const panel=f.elements.get('discoveryDetail');panel.showModal=function(){this.open=true;};panel.close=function(){this.open=false;};
    const browser=createBrowser(f.doc,async(url,opts)=>{
        const {source,q,page_url}=JSON.parse(opts.body);if(q)queries++;
        const rows=source==='cupfox'?[row('测试剧',null,'https://www.cupfox.in/vod-detail/12.html')]
            :q==='测试剧'?[row('测试剧',null,'https://yhdmoe.com/watch/34')]:[];
        return {ok:true,json:async()=>url.includes('/search')?{source_id:source,status:'ok',results:rows}
            :{source_id:source,page_url,item_id:'12',title:'测试剧',status:'ok',episodes:[]}};
    });
    f.elements.get('discoveryQuery').value='测试';await browser.run();
    const card=f.elements.get('discoveryLiveResults').children[0];card.children[0].handlers.click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(queries,4,'two broad and two automatic exact-title searches');
    assert.equal(f.elements.get('discoveryLiveResults').children.length,1);
    assert.equal(f.elements.get('discoveryLiveResults').children[0],card);
    assert.match(card.children[2].textContent,/2 个来源/);
    assert.equal(f.elements.get('catalogSourceChoices').children.length,2);
    browser.home();
});
test('equal titles merge missing years, but known remake years do not absorb ambiguous entries',()=>{
    const groups=groupResults([
        {source:'ddys',name:'低端',rows:[row(),row()]},
        {source:'huarw',name:'华人',rows:[row('开端',2022,'https://huarw.com/movie/123'),row('开端',2025,'https://huarw.com/movie/456')]},
        {source:'cupfox',rows:[row('开端',null,'https://www.cupfox.in/vod-detail/10.html'),row('开端',null,'https://www.cupfox.in/vod-detail/11.html')]},
    ]);
    assert.equal(groups.length,3);assert.equal(groups[0].choices.length,2);
    assert.deepEqual(groups.map(g=>g.year),['2022','2025','']);
    assert.equal(groups[2].choices.length,2);
});

test('same complete title groups across sites without a year and preserves seasons and editions',()=>{
    const records=[{source:'cupfox',rows:[row('Re：从零开始 第四季',null,'https://www.cupfox.in/vod-detail/1.html'),
        row('Re：从零开始 第三季',null,'https://www.cupfox.in/vod-detail/2.html'),
        row('Re：从零开始 第四季 新编集版',null,'https://www.cupfox.in/vod-detail/3.html')]},
        {source:'kanju',rows:[row('Re:从零开始\u200b第4季',null,'https://www.kanju.ai/player/av_four')]}];
    let groups=groupResults(records);
    assert.equal(groups.length,3);assert.equal(groups[0].choices.length,2);
    records[1].rows[0].year='2026';groups=groupResults(records);
    assert.equal(groups.length,3);assert.equal(groups[0].year,'2026');assert.equal(groups[0].choices.length,2);
});

test('closing source lookup aborts outstanding native reads and ignores late results',async()=>{
    const saved=global.twSourceMetadata,jobs=[];
    global.twSourceMetadata={supportedSources:['kanju','pkavi'],supportsProgress:true,
        request:(id,kind,payload,interactive,progress)=>new Promise(resolve=>jobs.push({id,kind,payload,progress,resolve})),
        cancel(id){const job=jobs.find(j=>j.id===id);if(job){job.cancelled=true;job.resolve({status:'cancelled',source_id:job.payload.source});}}};
    const f=fixture(['kanju','pkavi']);f.doc.defaultView={};
    for(const id of ['discoveryDetail','discoveryDetailClose','discoveryDetailTitle','discoveryDetailStatus','discoveryDetailDescription',
        'discoveryEpisodes','discoveryDetailOriginal','discoveryEpisodeFilter','discoveryEpisodeMore','catalogFindOtherSources','catalogSourceQuery','catalogSourceStatus'])f.elements.set(id,f.doc.createElement('div'));
    const panel=f.elements.get('discoveryDetail');panel.showModal=function(){this.open=true;};panel.close=function(){this.open=false;};
    const browser=createBrowser(f.doc,()=>assert.fail('no server fallback'));
    try {
        browser.episodes({source:'kanju',item:'av_demo',episode:'ep-e2'});
        jobs[0].resolve({source_id:'kanju',page_url:'https://www.kanju.ai/player/av_demo',item_id:'av_demo',title:'测试剧',status:'ok',episodes:[]});
        await new Promise(resolve=>setImmediate(resolve));
        const pending=f.elements.get('catalogFindOtherSources').onclick();
        assert.equal(jobs.length,3);assert.ok(jobs.slice(1).every(j=>j.kind==='search'));
        browser.back();
        // Simulate the dialog's close event (the fixture is not a real DOM).
        panel.handlers.close();
        assert.ok(jobs.slice(1).every(j=>j.cancelled));
        jobs[2].progress({source_id:'pkavi',status:'ok',results:[{title:'测试剧',page_url:'https://www.pkavi.com/mv/1.html'}]});
        await pending;
        assert.equal(f.elements.get('catalogSourceChoices').children.length,1);
    } finally {browser.cancel();global.twSourceMetadata=saved;}
});
test('unknown hosts, blank titles, script URLs and credentialed covers cannot enter film cards',()=>{
    const groups=groupResults([{source:'ddys',rows:[row('',2022),row('x',2022,'javascript:alert(1)'),row('x',2022,'https://evil.test/movie/x'),{...row(),poster_url:'https://img.ddys.io/a.jpg?token=secret'}]}]);
    assert.equal(groups.length,1);assert.equal(groups[0].poster,'');
});

function fixture(sources=['ddys','huarw','cupfox']) {
    function node(tag='div') {return {tagName:tag,children:[],handlers:{},attributes:{},dataset:{},hidden:false,value:'',textContent:'',
        addEventListener(k,f){this.handlers[k]=f;},append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}},
        replaceChildren(...nodes){for(const n of this.children)n.parent=null;this.children=[];this.append(...nodes);},
        remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;},
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
test('sidebar category exits search and keeps duplicate mobile tabs selected by category',async()=>{
    const f=fixture(['cupfox']),root=f.elements.get('sourceDiscovery'),original=root.querySelectorAll;
    const tabs=['movie','series','movie','all'].map(category=>Object.assign(f.doc.createElement('button'),{dataset:{catalogCategory:category,categoryLabel:category==='movie'?'电影':'剧集'},textContent:'图标文字'}));
    root.querySelectorAll=selector=>selector==='[data-catalog-category]'?tabs:original(selector);
    let calls=0;
    const browser=createBrowser(f.doc,async()=>{calls++;return {ok:true,json:async()=>({source_id:'cupfox',status:'ok',results:[]})};});
    f.elements.get('discoveryQuery').value='星';await browser.run();
    tabs[0].handlers.click();
    assert.equal(f.elements.get('discoveryLive').hidden,true);assert.equal(f.elements.get('discoveryWelcome').hidden,false);
    assert.equal(f.elements.get('recommendationTitle').textContent,'电影片单');
    assert.deepEqual(tabs.map(tab=>tab.attributes['aria-pressed']),['true','false','true','false']);
    assert.equal(calls,1,'category navigation must not repeat the title search');
});

test('search shows one flat grid, max two requests, folds failures away and never loads details automatically',async()=>{
    const f=fixture();let active=0,peak=0;const requests=[];
    const browser=createBrowser(f.doc,async(url,options)=>{
        requests.push(url);assert.equal(options.credentials,'omit');active++;peak=Math.max(active,peak);
        await new Promise(r=>setTimeout(r,5));active--;
        const {source}=JSON.parse(options.body);
        return {ok:true,json:async()=>({source_id:source,status:source==='cupfox'?'unavailable':'ok',results:[row('开端',2022,source==='ddys'?'https://ddys.io/movie/reset':'https://huarw.com/movie/1')]})};
    },{retryDelays:[]});
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

test('transient server failure is retried and merged automatically without another Search click',async()=>{
    const f=fixture(['huarw']);let count=0;
    const browser=createBrowser(f.doc,async()=>({ok:true,json:async()=>({source_id:'huarw',status:++count===1?'unavailable':'ok',results:[row('测试',2022,'https://huarw.com/movie/123')]})}),{retryDelays:[0,0]});
    f.elements.get('discoveryQuery').value='测试';await browser.run();
    const note=f.elements.get('catalogSearchNotesBody').children[0];
    assert.equal(count,2);
    assert.equal(f.elements.get('discoveryLiveResults').children.length,1);
    assert.match(note.children[0].textContent,/已完成/);
});

test('automatic retry is bounded, respects rate limits and is cancelled when leaving search',async()=>{
    for(const [response,expected] of [[{ok:false,status:503},3],[{ok:false,status:429},1]]) {
        const f=fixture(['cupfox']);let calls=0;
        const browser=createBrowser(f.doc,async()=>{calls++;return response;},{retryDelays:[0,0]});
        f.elements.get('discoveryQuery').value='测试';await browser.run();assert.equal(calls,expected);
        assert.equal(f.elements.get('discoveryLive').attributes['aria-busy'],'false');
        assert.ok(f.elements.get('catalogSearchNotesBody').children[0].children.some(n=>n.tagName==='button' && !n.disabled));
        browser.home();
    }
    const f=fixture(['cupfox']);let calls=0;
    const browser=createBrowser(f.doc,async()=>{calls++;return {ok:false,status:503};},{retryDelays:[60000,60000]});
    f.elements.get('discoveryQuery').value='测试';const pending=browser.run();
    await new Promise(resolve=>setImmediate(resolve));browser.home();await pending;
    assert.equal(calls,1);assert.equal(f.elements.get('discoveryLiveResults').children.length,0);
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
