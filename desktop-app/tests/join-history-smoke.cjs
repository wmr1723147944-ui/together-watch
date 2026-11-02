'use strict';
// Real templates + renderer, synthetic images. No original-site/video traffic.
const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict'),{setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'.review-artifacts/join-history');
const windows=[];let backend,log='';
app.setPath('userData',path.join(app.getPath('temp'),'tw-join-history-'+process.pid));
async function until(name,fn){const end=Date.now()+18000;while(Date.now()<end){if(await fn())return;await delay(100);}throw Error('Timeout: '+name);}
async function run(){
    fs.mkdirSync(out,{recursive:true});
    const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
    const port=reserve.address().port;await new Promise(r=>reserve.close(r));const server='http://127.0.0.1:'+port;
    backend=spawn(process.env.TW_SMOKE_PYTHON||'python',['-u','-c',`
import app as module
import catalog_recommendations
catalog_recommendations.load_page=lambda source,category,page: dict(source_id=source,category=category,page=page,status='ok',results=[],has_more=False,next_page=None)
module.app.run(host='127.0.0.1',port=${port},use_reloader=False)
`],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,APP_ENV:'development',SECRET_KEY:'join-ui-test-only',ACCOUNT_DATABASE:path.join(out,'test-accounts.sqlite3')}});
    backend.stdout.on('data',d=>log=(log+d).slice(-3000));backend.stderr.on('data',d=>log=(log+d).slice(-3000));backend.on('error',e=>log+=e.message);
    await until('backend',async()=>{try{return (await fetch(server+'/health')).ok;}catch{return false;}});
    const win=new BrowserWindow({show:false,width:1280,height:900,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,partition:'join-history-'+process.pid}});windows.push(win);
    const wc=win.webContents,requests=[];
    const js=async code=>{try{return await wc.executeJavaScript(code);}catch(e){throw Error(code+'\n'+e.message);}};
    const errors=[];wc.on('console-message',e=>{if(e.level==='error'){errors.push(e.message);console.error('Renderer:',e.message);}});
    await wc.session.protocol.handle('https',req=>{
        requests.push(req.url);
        if(req.url.startsWith('https://image.tmdb.org/') && /\/(good|backup)\.jpg$/.test(new URL(req.url).pathname))return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><defs><linearGradient id="g"><stop stop-color="#25445e"/><stop offset="1" stop-color="#d78062"/></linearGradient></defs><rect width="960" height="540" fill="url(#g)"/><circle cx="740" cy="160" r="88" fill="#ffdfb5"/><path d="M0 450L240 210 490 430 700 290 960 440V540H0" fill="#132d3f"/><text x="60" y="140" font-size="48" fill="white">TOGETHER WATCH</text></svg>',{headers:{'content-type':'image/svg+xml'}});
        return new Response('fixture unavailable',{status:404});
    });
    async function shot(name){await delay(180);fs.writeFileSync(path.join(out,name+'.png'),(await wc.capturePage()).toPNG());}
    await win.loadURL(server+'/');
    // Seed the legacy single-poster format directly: no remember()/migration first.
    await js(`localStorage.setItem('tw_watch_history_v1',JSON.stringify({enabled:true,meta:{},deleted:[],rows:[
        {source:'kanju',item:'av-old',episode:'ep-one',title:'旧观看记录',label:'第 1 集',time:83,duration:2700,updated:Date.now(),poster:'https://image.tmdb.org/good.jpg'},
        {source:'cupfox',item:'234',episode:'ep1',title:'备用封面测试',label:'第 1 集',time:605,duration:2700,updated:Date.now(),poster:'https://image.tmdb.org/broken.jpg',poster_candidates:['https://image.tmdb.org/broken.jpg','https://image.tmdb.org/backup.jpg']}
    ]}));`);
    await win.loadURL(server+'/');
    await until('legacy and fallback covers',()=>js('document.querySelectorAll("#continueWatchingList img[data-loading=false]").length===2'));
    assert.deepEqual(await js('[...document.querySelectorAll("#continueWatchingList img[data-loading=false]")].map(i=>i.currentSrc)'),['https://image.tmdb.org/good.jpg','https://image.tmdb.org/backup.jpg']);
    assert.equal(await js('TogetherWatchHistory.store.list().length'),2,'legacy rows remain intact');
    await js('document.querySelector("[data-watch-history]").click()');
    await until('history dialog covers',()=>js('document.querySelectorAll("#watchHistoryList img[data-loading=false]").length===2'));
    await shot('desktop-history');
    await js('document.getElementById("watchHistoryDialog").close();document.querySelector(".nav-room-link").click()');
    assert.equal(await js('document.activeElement.id'),'roomId');await shot('desktop-join');
    await js('document.getElementById("roomId").value="same-room";document.getElementById("username").value="回归用户";document.getElementById("joinRoomBtn").click()');
    assert.match(await js('document.getElementById("formError").textContent'),/同意/);
    assert.ok(wc.getURL().startsWith(server+'/'),'missing consent does not join');
    for(const [w,h] of [[390,844],[320,600],[640,360]]){
        win.setContentSize(w,h);await delay(250);
        assert.ok(await js('document.documentElement.scrollWidth<=innerWidth+1'),'no horizontal overflow');
        assert.ok(await js('(()=>{const r=document.getElementById("roomEntry").getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight+1})()'),'join stays inside viewport');
        await js('document.getElementById("joinRoomBtn").scrollIntoView({block:"nearest"})');
        assert.ok(await js('(()=>{const r=document.getElementById("joinRoomBtn").getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight+1})()'),'submit remains reachable in short viewports');
        if(w===390)await shot('mobile-join');
    }
    win.setContentSize(390,844);await delay(200);
    await js('document.getElementById("roomEntryClose").click();document.querySelector("[data-watch-history]").click()');
    await until('mobile history artwork',()=>js('document.querySelectorAll("#watchHistoryList img[data-loading=false]").length===2'));
    await shot('mobile-history');
    await js('document.getElementById("watchHistoryDialog").close();document.querySelector(".nav-room-link").click();document.getElementById("complianceConsent").checked=true;document.getElementById("roomId").value="room-one";document.getElementById("joinRoomBtn").click()');
    await until('same room navigation',async()=>new URL(wc.getURL()).pathname==='/room/room-one');
    await until('room page settled',async()=>!wc.isLoading() && await js('document.readyState==="complete" && !!document.getElementById("roomData")'));
    // Exercise loaded-detail-cover persistence through the real click handler.
    await win.loadURL(server+'/discover');
    await js(`window.fetch=async()=>({ok:true,json:async()=>({source_id:'cupfox',item_id:'234',page_url:'https://www.cupfox.in/vod-detail/234.html',status:'ok',episodes:[{id:'ep2',title:'第2集',launch_path:'/discover/play/cupfox/234/ep2'}]})});
        window.detailTest=TogetherWatchDiscovery.createDetails(document,fetch);
        window.detailRow={title:'新片',page_url:'https://www.cupfox.in/vod-detail/234.html',poster_url:'https://image.tmdb.org/broken.jpg',poster_candidates:['https://image.tmdb.org/backup.jpg']};
        void detailTest.open('cupfox',detailRow);`);
    await until('episode list',()=>js('document.querySelectorAll("#discoveryEpisodes a").length===1'));
    await js(`const image=document.createElement('img');image.src='https://image.tmdb.org/backup.jpg';image.dataset.loading='false';document.getElementById('catalogDetailPoster').replaceChildren(image);
        document.getElementById('discoveryEpisodes').addEventListener('click',e=>e.preventDefault());`);
    await until('detail image loaded',()=>js('document.querySelector("#catalogDetailPoster img").naturalWidth>1'));
    await js('document.querySelector("#discoveryEpisodes a").click()');
    assert.equal(await js('TogetherWatchHistory.store.metadata({source:"cupfox",item:"234",episode:"ep2"}).poster'),'https://image.tmdb.org/backup.jpg');
    assert.ok(requests.filter(u=>u.endsWith('/broken.jpg')).length<=4,'failed covers have bounded retries');
    assert.deepEqual(errors.filter(e=>!/net::|Failed to load resource/.test(e)),[]);
    // Preview the actual Windows shell with only the IPC bridge substituted.
    const shell=new BrowserWindow({show:false,width:1280,height:900,useContentSize:true,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'join-preview-preload.cjs')}});windows.push(shell);
    await shell.loadFile(path.join(root,'desktop-app/ui/index.html'));
    await until('native shell dialog',()=>shell.webContents.executeJavaScript('document.getElementById("setup").open'));
    fs.writeFileSync(path.join(out,'windows-join.png'),(await shell.webContents.capturePage()).toPNG());
    console.log('PASS: legacy covers, fallback, saved loaded poster, consent, same room, short screens, real Windows shell. Evidence:',out);
}
function finish(code){backend?.kill();for(const w of windows)if(!w.isDestroyed())w.destroy();app.exit(code);}
app.whenReady().then(run).then(()=>finish(0)).catch(e=>{console.error(e.stack,log);finish(1);});
