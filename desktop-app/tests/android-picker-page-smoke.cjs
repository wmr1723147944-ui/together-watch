'use strict';
// Real first-party template/CSS + packaged Android bridge/probe, using bounded local metadata.
const {app,BrowserWindow}=require('electron'),{spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..'),asset=p=>fs.readFileSync(path.join(root,p),'utf8');
let backend,win,log='';
async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await delay(100);}throw Error('Timed out '+log);}
async function run(){
    const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
    const port=reserve.address().port;await new Promise(r=>reserve.close(r));const origin='http://127.0.0.1:'+port;
    backend=spawn(process.env.TW_SMOKE_PYTHON||'python',['-u','-c',`import app as m
m.search_provider=lambda s,q:dict(source_id=s,status='ok',results=[])
m.app.run(host='127.0.0.1',port=${port},use_reloader=False)`],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,APP_ENV:'development',SECRET_KEY:'picker-regression',DISCOVERY_SEARCH_ENABLED:'1'}});
    backend.stdout.on('data',d=>log=(log+d).slice(-1000));backend.stderr.on('data',d=>log=(log+d).slice(-1000));
    await until(async()=>{try{return (await fetch(origin+'/health')).ok;}catch{return false;}});
    win=new BrowserWindow({show:false,width:390,height:600,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
    const js=s=>win.webContents.executeJavaScript(s);
    const adapter=require('../../static/js/catalog-adapters.js');
    for(const [source,item,episode] of [['kanju','drama','ep-one'],['pkavi','12','1-1'],['233dm','0123456789abcdef01234567','1-1']]){
        await win.loadURL(origin+'/discover?picker=1');
        await js(asset('android-app/app/src/main/assets/catalog-metadata-bridge.js'));
        const program={source,item,episode},probe=()=>js(asset('android-app/app/src/main/assets/episode-picker-probe.js')+'('+JSON.stringify(program)+','+JSON.stringify(origin)+')');
        await until(()=>js('!!window.TogetherWatchCatalogNavigation'));
        console.log(source,'initial',await probe());
        const batch=await js('window.__twMetadataQueue.drain()');
        assert.equal(batch.requests.length,1);
        const row=batch.requests[0],req=adapter.request(row.kind,row.payload);
        const data=adapter.normalizeResult(req,{status:'ok',title:'目录回归',episodes:[{id:episode,title:'第1集'},{id:source==='kanju'?'ep-two':'1-2',title:'第2集'}]});
        await js('__twMetadataQueue.complete('+JSON.stringify(batch.token)+','+JSON.stringify(row.id)+','+JSON.stringify(data)+')');
        await until(()=>js('document.querySelectorAll("#discoveryEpisodes a").length===2'));
        const state=await probe();console.log(source,'loaded',state,await js('document.getElementById("discoveryDetailStatus").textContent'));
        assert.equal(state,'ready');
        assert.equal(await js('document.querySelector("#discoveryEpisodes a").getAttribute("aria-current")'),'true');
    }
    console.log('PASS actual picker page and styles across native metadata providers.');
}
function finish(code){win?.destroy();backend?.kill();app.exit(code);}
app.whenReady().then(run).then(()=>finish(0)).catch(e=>{console.error(e);finish(1);});
