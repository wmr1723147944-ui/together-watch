const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createBrowser}=require('../static/js/catalog-browser.js');
const {metadataRequest}=require('../static/js/source-discovery.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(sources){
    function node(tag='div'){return {tagName:tag,children:[],handlers:{},attributes:{},dataset:{},hidden:false,value:'',textContent:'',
        addEventListener(k,f){this.handlers[k]=f;},append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}},
        replaceChildren(...nodes){this.children=[];this.append(...nodes);},remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);},
        setAttribute(k,v){this.attributes[k]=v;},focus(){},querySelectorAll(){return [];},showModal(){this.open=true;},close(){this.open=false;}};}
    const elements=new Map();
    for(const id of ['sourceDiscovery','discoveryQuery','discoveryWelcome','discoveryLive','discoveryLiveResults','discoveryLiveStatus',
        'discoveryForm','discoveryClear','catalogBack','catalogResultCount','catalogResultTitle','catalogSkeleton','catalogEmpty',
        'catalogSearchNotes','catalogSearchNotesBody','catalogSourceChoices','catalogDetailFacts','catalogDetailPoster','recommendationTitle',
        'discoveryDetail','discoveryDetailClose','discoveryDetailTitle','discoveryDetailStatus','discoveryDetailDescription',
        'discoveryEpisodes','discoveryDetailOriginal','discoveryEpisodeFilter','discoveryEpisodeMore'])elements.set(id,node());
    const root=elements.get('sourceDiscovery');root.dataset.catalogMode='films';
    const choices=sources.map(id=>Object.assign(node('input'),{dataset:{liveSource:id,sourceName:id}}));
    root.querySelectorAll=s=>s==='[data-live-source]'?choices:[];
    return {get:id=>elements.get(id),doc:{getElementById:id=>elements.get(id),createElement:node}};
}
function nativeFixture(){
    const jobs=[];
    const api={supportsProgress:true,supportedSources:['kanju','233dm','pkavi'],
        request(id,kind,payload,interactive,progress){return new Promise(resolve=>jobs.push({id,kind,payload,interactive,progress,resolve}));},
        cancel(id){const job=jobs.find(j=>j.id===id);if(job){job.cancelled=true;job.resolve({source_id:job.payload.source,status:'cancelled'});}}};
    return {api,jobs};
}
const result=(source,rows)=>({source_id:source,status:'ok',results:rows});
const film=(source,year=null)=>({title:'测试影片',year,page_url:source==='kanju'?'https://www.kanju.ai/player/av_demo':'https://www.pkavi.com/mv/12.html'});

test('slow server sources cannot block native results, and cancel discards old partials',async()=>{
    const saved=global.twSourceMetadata,native=nativeFixture();global.twSourceMetadata=native.api;
    const f=fixture(['cupfox','yhdmoe','kanju','233dm','pkavi']),servers=[];
    const browser=createBrowser(f.doc,(_url,opts)=>new Promise(resolve=>{
        const source=JSON.parse(opts.body).source;servers.push(source);
        opts.signal.addEventListener('abort',()=>resolve({ok:true,json:async()=>({source_id:source,status:'cancelled'})}));
    }));
    try{
        f.get('discoveryQuery').value='测试';let finished=false;const pending=browser.run();pending.then(()=>{finished=true;});
        assert.deepEqual(servers,['cupfox','yhdmoe']);assert.equal(native.jobs.length,2);
        native.jobs[0].progress(result('kanju',[film('kanju')]));await flush();
        assert.equal(finished,false);assert.equal(f.get('discoveryLiveResults').children.length,1);
        assert.equal(f.get('catalogSkeleton').hidden,true);assert.equal(f.get('discoveryLive').attributes['aria-busy'],'true');
        assert.match(f.get('discoveryLiveStatus').textContent,/已找到 1 部/);
        const first=f.get('discoveryLiveResults').children[0];native.jobs[0].progress(result('kanju',[film('kanju')]));
        assert.equal(f.get('discoveryLiveResults').children[0],first);
        browser.home();await pending;native.jobs[0].progress(result('kanju',[film('kanju')]));
        assert.equal(f.get('discoveryLiveResults').children.length,0);assert.equal(native.jobs.length,2);
    }finally{browser.home();global.twSourceMetadata=saved;}
});

test('year/cover enrichment merges in place without duplicates or losing earlier rows',async()=>{
    const saved=global.twSourceMetadata,native=nativeFixture();global.twSourceMetadata=native.api;
    const f=fixture(['kanju','pkavi']),browser=createBrowser(f.doc,()=>assert.fail('native only'));
    try{
        f.get('discoveryQuery').value='测试';const pending=browser.run();
        native.jobs[0].progress(result('kanju',[film('kanju')]));const first=f.get('discoveryLiveResults').children[0];
        native.jobs[1].progress(result('pkavi',[film('pkavi',2024)]));assert.equal(f.get('discoveryLiveResults').children.length,1);
        native.jobs[0].progress(result('kanju',[{...film('kanju',2024),poster_url:'https://image.tmdb.org/t/p/w500/example.jpg'}]));
        const cards=f.get('discoveryLiveResults').children;assert.equal(cards.length,1);assert.equal(cards[0],first);
        assert.match(cards[0].children[2].textContent,/2 个来源/);
        native.jobs[0].resolve(result('kanju',[]));native.jobs[1].resolve(result('pkavi',[]));await pending;
        assert.equal(f.get('discoveryLiveResults').children[0],first);assert.equal(f.get('discoveryLive').attributes['aria-busy'],'false');
    }finally{browser.home();global.twSourceMetadata=saved;}
});

test('opening the first result prioritizes detail, resumes search and merges late sources in the open dialog',async()=>{
    const saved=global.twSourceMetadata,native=nativeFixture();global.twSourceMetadata=native.api;
    const f=fixture(['kanju','pkavi']),browser=createBrowser(f.doc,()=>assert.fail('native only'));
    try{
        f.get('discoveryQuery').value='测试';const pending=browser.run();native.jobs[0].progress(result('kanju',[film('kanju')]));
        const card=f.get('discoveryLiveResults').children[0];card.children[0].handlers.click();
        assert.equal(native.jobs[0].cancelled,true);assert.equal(native.jobs[1].cancelled,undefined);
        await flush();
        const detail=native.jobs[2];assert.equal(detail.kind,'detail');assert.equal(f.get('discoveryDetail').open,true);
        native.jobs[1].progress(result('pkavi',[film('pkavi')]));
        assert.equal(f.get('discoveryLiveResults').children.length,1);
        assert.equal(f.get('discoveryLiveResults').children[0],card);
        assert.equal(f.get('catalogSourceChoices').children.length,2);
        detail.resolve({source_id:'kanju',page_url:film('kanju').page_url,item_id:'av_demo',status:'ok',episodes:[]});
        await flush();assert.equal(native.jobs[3].kind,'search');
        native.jobs[1].resolve(result('pkavi',[film('pkavi')]));
        native.jobs[3].resolve(result('kanju',[film('kanju')]));
        await pending;await flush();browser.back();
        assert.equal(f.get('discoveryQuery').value,'测试');assert.equal(f.get('discoveryLiveResults').children[0],card);
        assert.doesNotMatch(f.get('discoveryLiveStatus').textContent,/暂停/);
        assert.doesNotMatch(f.get('catalogDetailFacts').textContent,/正在/);
        assert.equal(f.get('discoveryLive').attributes['aria-busy'],'false');
    }finally{browser.home();global.twSourceMetadata=saved;}
});

test('old clients never receive a non-serializable progress callback',async()=>{
    const saved=global.twSourceMetadata;let argc=0;
    global.twSourceMetadata={supportedSources:['kanju'],request(...args){argc=args.length;return Promise.resolve(result('kanju',[]));},cancel(){}};
    try{await metadataRequest('search',{source:'kanju',q:'测试'},()=>assert.fail(),new AbortController().signal,false,()=>{});assert.equal(argc,4);}
    finally{global.twSourceMetadata=saved;}
});
