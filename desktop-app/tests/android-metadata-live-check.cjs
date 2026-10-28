'use strict';
// Opt-in, read-only metadata probe. No credentials, verification clicks or video.
const {app,BrowserWindow}=require('electron');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const {api,script}=require('../src/catalog-adapters.cjs');
app.setPath('userData',path.join(app.getPath('temp'),'tw-android-metadata-probe-'+process.pid));
// Finishing one batch must not quit Electron before the next batch starts.
app.on('window-all-closed',()=>{});
const mobile='Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36';
async function probe(source){
    const req=api.request('search',{source,q:'元气少女'});
    const win=new BrowserWindow({show:false,width:390,height:844,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'metadata-probe-'+source}});
    const wc=win.webContents;wc.setUserAgent(mobile);wc.setAudioMuted(true);wc.setWindowOpenHandler(()=>({action:'deny'}));
    const errors=[];
    wc.on('did-fail-load',(_e,code,_description,_url,main)=>{if(main)errors.push(code);});
    try {
        wc.loadURL(req.url).catch(()=>{});wc.debugger.attach('1.3');
        let last=null,reported='';
        for(let i=0;i<65;i++){
            await delay(500);
            try {
                const {frameTree}=await wc.debugger.sendCommand('Page.getFrameTree');
                const at=frameTree.frame.url;
                if(!at.startsWith('https://'+api.sources[source].host+'/'))continue;
                // Use the app's main-world invocation, not the desktop isolated-world path.
                const expression='(()=>{try{'+script+';const a=window.TogetherWatchCatalogAdapters,r='+JSON.stringify(req)+';return {expected:a.expectedPage(r,location.href),data:a.readDocument(document,r),diagnostic:{title:document.title,ready:document.readyState,anchors:document.querySelectorAll("a[href]").length,results:document.querySelectorAll(".search-box").length,headings:document.querySelectorAll("h3").length,paths:[...new Set(Array.from(document.querySelectorAll("a[href]")).map(el=>{try{return new URL(el.href).pathname.slice(0,180)}catch{return ""}}))].filter(p=>/anime|movie|player|vod|mv/.test(p)).slice(0,6)}}}catch(e){return {error:e.name+": "+e.message}}})()';
                const reply=await wc.debugger.sendCommand('Runtime.evaluate',{expression,returnByValue:true,timeout:2000});
                last=reply.result?.value||{exception:reply.exceptionDetails?.text};
                const compact=JSON.stringify({source,expected:last.expected,status:last.data?.status,count:last.data?.results?.length,error:last.error,diagnostic:last.diagnostic});
                if(compact!==reported){console.log(compact);reported=compact;}
                if(last.error || ['verification_required','access_blocked'].includes(last.data?.status))break;
                if(last.data?.status==='ok' && last.data.results?.length)break;
            }catch{}
        }
        console.log(JSON.stringify({source,finished:true,networkErrors:errors}));
    } finally {win.destroy();}
}
app.whenReady().then(async()=>{
    if(process.env.TW_METADATA_LIVE!=='1')throw Error('Set TW_METADATA_LIVE=1 to explicitly run the public-site probe');
    for(const batch of [['huarw','kanju'],['233dm','pkavi']])await Promise.all(batch.map(probe));
}).then(()=>app.exit(0)).catch(e=>{console.error(e.message);app.exit(1);});
