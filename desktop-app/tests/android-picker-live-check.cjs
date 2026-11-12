'use strict';
// Opt-in read-only diagnosis of the deployed first-party picker (fresh session).
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
let win;
app.whenReady().then(async()=>{
    if(process.env.TW_LIVE_PICKER!=='1')throw Error('Set TW_LIVE_PICKER=1 to inspect the public deployment.');
    const origin='https://watchtogethernow.cloud';
    win=new BrowserWindow({show:false,width:390,height:660,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,partition:'live-picker-diagnostic'}});
    const js=s=>win.webContents.executeJavaScript(s);
    for(const [source,item,episode] of [['kanju','drama','ep-two'],['pkavi','12','1-1'],['233dm','0123456789abcdef01234567','1-1'],['cupfox','12','ep1'],['yhdmoe','12','EP1']]){
        await win.loadURL(origin+'/discover?picker=1');
        await js(read('static/js/catalog-adapters.js')+';'+read('android-app/app/src/main/assets/catalog-metadata-bridge.js')+';void 0');
        for(let i=0;i<40 && !await js('!!window.TogetherWatchCatalogNavigation');i++)await delay(250);
        await js(`if(window.TogetherWatchCatalogNavigation){const fn=TogetherWatchCatalogNavigation.episodes;TogetherWatchCatalogNavigation.episodes=function(p){try{return fn(p);}catch(e){window.__diagnostic=String(e.stack);throw e;}}};void 0`);
        const program={source,item,episode};
        const state=await js(read('android-app/app/src/main/assets/episode-picker-probe.js').trim()+'('+JSON.stringify(program)+','+JSON.stringify(origin)+')');
        console.log(JSON.stringify({source,state,diagnostic:await js('window.__diagnostic||""'),pending:await js('window.__twMetadataQueue?.drain()?.requests?.length')}));
    }
}).then(()=>{win?.destroy();app.exit(0);}).catch(e=>{console.error(e);win?.destroy();app.exit(1);});
