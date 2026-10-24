'use strict';
// Opt-in, read-only live check. Uses an ephemeral session, never a user's login.
// Emits public image metadata / page status only, not scripts or media URLs.
const {app,BrowserWindow,session}=require('electron');
const {setTimeout:delay}=require('node:timers/promises');
const {api,script}=require('../src/catalog-adapters.cjs');
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
    const ses=session.fromPartition('cover-diagnostic-'+Date.now());
    ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    ses.setPermissionCheckHandler(()=>false);
    const failures=[];
    ses.webRequest.onCompleted(d=>{if(d.statusCode>=400)failures.push({host:new URL(d.url).hostname,type:d.resourceType,status:d.statusCode});});
    ses.webRequest.onErrorOccurred(d=>failures.push({host:new URL(d.url).hostname,type:d.resourceType,error:d.error}));
    for(const [source,url] of [
        ['pkavi',api.request('search',{source:'pkavi',q:'三体'}).url],
        ['kanju',api.request('search',{source:'kanju',q:'三体'}).url],
    ].filter(([source])=>!process.env.TW_DIAG_SOURCE || source===process.env.TW_DIAG_SOURCE)) {
        const win=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false}});
        const wc=win.webContents;wc.setAudioMuted(true);wc.setWindowOpenHandler(()=>({action:'deny'}));
        const origin=new URL(url).origin;
        for(const event of ['will-navigate','will-redirect'])wc.on(event,(e,target)=>{if(new URL(target).origin!==origin)e.preventDefault();});
        let status;failures.length=0;
        wc.on('did-navigate',(_e,_url,code)=>{status=code;});
        wc.loadURL(url).catch(()=>{});
        for(let attempt=0;attempt<16;attempt++) {
            await delay(1000);
            try {
                if(!wc.debugger.isAttached())wc.debugger.attach('1.3');
                const {frameTree}=await wc.debugger.sendCommand('Page.getFrameTree');
                if(!frameTree.frame.url.startsWith(origin+'/'))continue;
                const {executionContextId}=await wc.debugger.sendCommand('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'CoverDiagnostic',grantUniveralAccess:false});
                const req=api.request('search',{source,q:'三体'});
                const {result}=await wc.debugger.sendCommand('Runtime.evaluate',{contextId:executionContextId,returnByValue:true,timeout:1000,
                    expression:`(()=>{${script};return {title:document.title,ready:document.readyState,images:[...document.querySelectorAll('img')].slice(0,16).map(i=>({loaded:i.complete&&i.naturalWidth>0})),parsed:TogetherWatchCatalogAdapters.readDocument(document,${JSON.stringify(req)})};})()`});
                const value=result?.value;
                if(attempt===15 || (attempt>=5 && value?.images?.length>2) || /just a moment|请稍候|安全检查|access denied/i.test(value?.title||'')) {
                    const rows=value?.parsed?.results||[];
                    console.log(JSON.stringify({source,status,failures,title:value?.title,ready:value?.ready,
                        metadataStatus:value?.parsed?.status,rows:rows.length,
                        covers:rows.filter(r=>r.poster_url).length,
                        loadedImages:value?.images?.filter(i=>i.loaded).length,
                        samples:rows.slice(0,2).map(({title,poster_url})=>({title,poster_url}))}));break;
                }
            } catch { /* bounded page readiness check */ }
        }
        win.destroy();
    }
}).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>app.quit());
