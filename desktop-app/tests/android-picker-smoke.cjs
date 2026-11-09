'use strict';
// Real Chromium DOM checks for the packaged Android helpers, not an Android device test.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
let win;
async function run(){
    win=new BrowserWindow({show:false,width:420,height:820,webPreferences:{partition:'picker-smoke',contextIsolation:true,nodeIntegration:false,sandbox:true}});
    session.fromPartition('picker-smoke').protocol.handle('https',request=>{
        const u=new URL(request.url);
        if(u.host==='watchtogethernow.cloud')return new Response(`<!doctype html><style>dialog{width:300px;height:450px}</style>
            <dialog id="discoveryDetail"><p id="discoveryDetailStatus">正在读取集数…</p><div id="discoveryEpisodes"></div></dialog>
            <script>window.__twMetadataQueue={};window.TogetherWatchCatalogNavigation={episodes(){document.querySelector('dialog').showModal();return true;}};</script>`,{headers:{'Content-Type':'text/html; charset=utf-8'}});
        if(u.host==='www.kanju.ai')return new Response(`<!doctype html><h1>回归测试影片</h1><button data-directory-episode="two" title="第2集">2</button>
            <button data-directory-episode="three" title="第3集">3</button><script>window.clicked=0;document.addEventListener('click',()=>window.clicked++);</script>`,{headers:{'Content-Type':'text/html; charset=utf-8'}});
        throw Error('Unexpected network request');
    });
    const js=code=>win.webContents.executeJavaScript(code);
    await win.loadURL('https://watchtogethernow.cloud/discover?picker=1');
    const probe=()=>js('('+read('android-app/app/src/main/assets/episode-picker-probe.js')+')({source:"kanju",item:"drama",episode:"ep-two"},"https://watchtogethernow.cloud")');
    assert.equal(await probe(),'loading','painted empty dialog must not be ready');
    await js(`document.getElementById('discoveryEpisodes').innerHTML='<a class="discovery-episode" href="/discover/play/kanju/drama/ep-three">第3集</a>'`);
    assert.equal(await probe(),'ready');
    await js(`document.getElementById('discoveryEpisodes').replaceChildren();document.getElementById('discoveryDetailStatus').textContent='读取失败，可重试'`);
    assert.equal(await probe(),'notice');
    await js(`document.querySelector('dialog').style.display='none'`);assert.equal(await probe(),'waiting');
    await win.loadURL('https://www.kanju.ai/player/drama?episode=two');
    await js(read('static/js/catalog-adapters.js'));
    const directory=()=>js('('+read('android-app/app/src/main/assets/playing-directory.js')+')({kind:"detail",source:"kanju",item:"drama",url:"https://www.kanju.ai/player/drama"},location.href)');
    const data=await directory();assert.equal(data.episodes.length,2);assert.equal(data.episodes[1].id,'ep-three');
    assert.equal(await js('window.clicked'),0,'reading must not click or select an episode');
    await js('history.replaceState(null,"","/player/other?episode=two")');assert.equal(await directory(),null);
    console.log('PASS real DOM: loading/ready/error/hidden picker; live public directory; no clicks; rejects wrong film.');
}
app.whenReady().then(run).then(()=>{win?.destroy();app.exit(0);}).catch(e=>{console.error(e);win?.destroy();app.exit(1);});
