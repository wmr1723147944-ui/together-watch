'use strict';
// No live network: the drawer must open even when the server homepage is down.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..'),assets=process.env.TW_PICKER_ASSETS||path.join(root,'android-app/app/src/main/assets');
const origin='https://watchtogethernow.cloud',prefix='/static/android-picker/';
const shared=new Set(['catalog-adapters.js','watch-history.js','source-discovery.js','catalog-browser.js']);
const local=new Set(['episode-picker.css','episode-picker-boot.js','catalog-metadata-bridge.js']);
const read=name=>fs.readFileSync(path.join(assets,name),'utf8');
let win,current,offline=false;const unexpected=[];
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await delay(50);}throw Error('Timed out');}
async function run(){
    session.fromPartition('bundled-picker').protocol.handle('https',async request=>{
        const u=new URL(request.url);let content,mime;
        if(u.origin===origin && u.pathname==='/discover' && u.search==='?picker=1&native=1'){content=read('episode-picker.html');mime='text/html';}
        else if(u.origin===origin && u.pathname.startsWith(prefix)){
            const name=u.pathname.slice(prefix.length);
            if(shared.has(name))content=fs.readFileSync(process.env.TW_PICKER_ASSETS?path.join(assets,'picker',name):path.join(root,'static/js',name),'utf8');
            else if(local.has(name))content=read(name);
            mime=name.endsWith('.css')?'text/css':'application/javascript';
        }else if(u.origin===origin && u.pathname.startsWith('/api/discover/')){
            if(offline)return new Response('',{status:503});
            const payload=await request.json();
            const data=u.pathname.endsWith('/detail')?{source_id:payload.source,page_url:payload.page_url,item_id:current.item,status:'ok',title:'目录回归',
                episodes:[{id:current.episode,title:'第1集',launch_path:`/discover/play/${current.source}/${current.item}/${current.episode}`},
                    {id:current.source==='cupfox'?'ep2':'EP2',title:'第2集',launch_path:`/discover/play/${current.source}/${current.item}/${current.source==='cupfox'?'ep2':'EP2'}`}]}:{source_id:payload.source,status:'ok',results:[]};
            return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
        }
        if(content===undefined){unexpected.push(request.url);return new Response('',{status:503});}
        return new Response(content,{headers:{'Content-Type':mime+'; charset=utf-8'}});
    });
    win=new BrowserWindow({show:false,width:390,height:660,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,partition:'bundled-picker',contextIsolation:true,nodeIntegration:false}});
    const js=s=>win.webContents.executeJavaScript(s);
    const probe=()=>js(read('episode-picker-probe.js').trim()+'('+JSON.stringify(current)+','+JSON.stringify(origin)+')');
    for(const [source,item,episode] of [['kanju','drama','ep-one'],['pkavi','12','1-1'],['233dm','0123456789abcdef01234567','1-1'],['cupfox','12','ep1'],['yhdmoe','12','EP1']]){
        current={source,item,episode};offline=['kanju','pkavi','233dm'].includes(source);
        await win.loadURL(origin+'/discover?picker=1&native=1');
        assert.equal(await js('!!TogetherWatchCatalogNavigation && !!__twMetadataQueue'),true);
        assert.equal(await probe(),'loading');
        if(offline){
            const batch=await js('__twMetadataQueue.drain()');assert.equal(batch.requests.length,1);
            const row=batch.requests[0];assert.equal(row.payload.source,source);
            // Native cached/playing-page directory reply: no server required.
            await js('__twMetadataQueue.complete('+JSON.stringify(batch.token)+','+JSON.stringify(row.id)+','+JSON.stringify({status:'ok',title:'目录回归',episodes:[{id:episode,title:'第1集'},{id:source==='kanju'?'ep-two':'1-2',title:'第2集'}]})+')');
        }
        await until(()=>js('document.querySelectorAll("#discoveryEpisodes a").length===2'));
        assert.equal(await probe(),'ready');
        assert.equal(await js('document.querySelector("#discoveryEpisodes a").getAttribute("aria-current")'),'true');
        const next=await js(read('next-episode.js').trim()+'(document,'+JSON.stringify(origin)+','+JSON.stringify(current)+',true)');
        assert.ok(next.endsWith(source==='kanju'?'/ep-two':source==='cupfox'?'/ep2':source==='yhdmoe'?'/EP2':'/1-2'));
        // Native drawer already provides modality; shared panel needn't depend
        // on a nested HTML top layer. It remains visible in narrow landscape.
        assert.equal(await js('document.querySelector("dialog").matches(":modal")'),false);
        if(source==='kanju' && process.env.TW_PICKER_SCREENSHOT)fs.writeFileSync(process.env.TW_PICKER_SCREENSHOT,(await win.webContents.capturePage()).toPNG());
        win.setSize(380,360);assert.equal(await probe(),'ready');win.setSize(390,660);
        if(source==='kanju'){
            // Exercise the shared source switch against on-device results too.
            for(let i=0;i<10;i++){
                const searching=await js('__twMetadataQueue.drain()');
                for(const row of searching.requests){
                    assert.equal(row.kind,'search');
                    const results=row.payload.source==='pkavi'?[{title:'目录回归',page_url:'https://www.pkavi.com/mv/12.html'}]:[];
                    await js('__twMetadataQueue.complete('+JSON.stringify(searching.token)+','+JSON.stringify(row.id)+','+JSON.stringify({status:'ok',results})+')');
                }
                if(await js('!!document.querySelector("#catalogSourceChoices [data-source=pkavi]")'))break;
                await delay(50);
            }
            await js('document.querySelector("#catalogSourceChoices [data-source=pkavi]").click()');
            await delay(50);
            const change=await js('__twMetadataQueue.drain()'),row=change.requests.find(r=>r.kind==='detail');
            assert.equal(row.payload.source,'pkavi');
            await js('__twMetadataQueue.complete('+JSON.stringify(change.token)+','+JSON.stringify(row.id)+','+JSON.stringify({status:'ok',title:'目录回归',episodes:[{id:'1-1',title:'第1集'},{id:'1-2',title:'第2集'}]})+')');
            await until(()=>js('document.querySelector("#discoveryEpisodes a")?.pathname==="/discover/play/pkavi/12/1-1"'));
            assert.equal(await probe(),'ready');
        }
        await js('document.getElementById("discoveryDetailClose").click()');assert.equal(await probe(),'closed');
        console.log(source,'bundled panel ready, next and close valid',offline?'(server offline)':'');
    }
    current={source:'kanju',item:'drama',episode:'ep-one'};offline=true;
    await win.loadURL(origin+'/discover?picker=1&native=1');assert.equal(await probe(),'loading');
    const batch=await js('__twMetadataQueue.drain()');
    await js('__twMetadataQueue.complete('+JSON.stringify(batch.token)+','+JSON.stringify(batch.requests[0].id)+',{status:"unavailable"})');
    await until(async()=>await probe()==='notice');
    assert.equal(await js('document.querySelectorAll("#discoveryEpisodes button").length'),2);
    assert.deepEqual(unexpected,[],'never downloads remote homepage/scripts or navigates an original site');
    console.log('PASS bundled picker: all five sources, offline shell/cache, retry actions, current episode, next, close, portrait and landscape.');
}
app.whenReady().then(run).then(()=>{win?.destroy();app.exit(0);}).catch(e=>{console.error(e);win?.destroy();app.exit(1);});
