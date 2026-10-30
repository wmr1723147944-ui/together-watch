'use strict';
const {BrowserWindow}=require('electron');
const {api,script}=require('./catalog-adapters.cjs');
function createMetadataBrowser(parent,session,{hidden=false}={}) {
    const active=new Map();
    // Bounded, one browsing context per source. Cookies alone do not preserve
    // sessionStorage or an in-progress challenge when a window is destroyed.
    const pages=new Map();
    function flush() {
        try { session.flushStorageData(); session.cookies.flushStore().catch(()=>{}); } catch {}
    }
    function dispose(source) {
        const page=pages.get(source);
        if(!page)return;
        pages.delete(source);
        if(!page.window.isDestroyed())page.window.destroy();
    }
    function cancel(id) { active.get(id)?.finish({status:'cancelled'}); }
    function cancelAll() { for (const id of active.keys()) cancel(id); }
    function destroy() {cancelAll();flush();for(const source of pages.keys())dispose(source);}
    function getPage(req) {
        let page=pages.get(req.source);
        if(page && !page.window.isDestroyed())return page;
        const window=new BrowserWindow({parent,show:false,width:1000,height:740,autoHideMenuBar:true,
            title:'原站验证 / 查询 — '+api.sources[req.source].name,
            webPreferences:{session,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,webviewTag:false}});
        window.setMenu(null);
        const wc=window.webContents;
        wc.setAudioMuted(true);
        const allowed=value=>{
            try {const u=new URL(value);return u.origin==='https://'+api.sources[req.source].host && !u.username && !u.password;} catch {return false;}
        };
        page={window,wc,allowed,requestUrl:'',job:null,completedAt:0,resultStatus:''};
        pages.set(req.source,page);
        for(const event of ['will-navigate','will-redirect'])wc.on(event,(e,url)=>{
            if(!allowed(url)){e.preventDefault();page.job?.finish({status:'unavailable'});}
        });
        wc.setWindowOpenHandler(()=>({action:'deny'}));
        wc.on('will-attach-webview',e=>e.preventDefault());
        wc.on('render-process-gone',()=>{page.job?.finish({status:'unavailable'});dispose(req.source);});
        wc.on('did-fail-load',(_e,code,_d,_u,main)=>{
            if(main && code!==-3 && _u===page.requestUrl)page.job?.finish({status:'unavailable'});
        });
        window.on('closed',()=>{pages.delete(req.source);page.job?.finish({status:'cancelled'});});
        return page;
    }
    function run(id,kind,payload,interactive=false) {
        const req=api.request(kind,payload);
        if (!req || typeof id!=='string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || typeof interactive!=='boolean') return Promise.resolve({status:'unavailable'});
        if (active.size>=2 || active.has(id) || pages.get(req.source)?.job) return Promise.resolve(api.normalizeResult(req,{status:'busy'}));
        return new Promise(resolve=>{
            const page=getPage(req),{window,wc,allowed}=page;
            let done=false, timer=null, readTimer=null, reading=false, resumed=false, emptySince=0, posterSince=0, partial=null, lastStatus='unavailable';
            const deadline=Date.now()+(interactive?180000:kind==='detail'?20000:10000);
            function finish(result) {
                if(done) return; done=true; clearTimeout(timer); clearTimeout(readTimer); active.delete(id);
                page.job=null;
                page.completedAt=Date.now();page.resultStatus=result.status;
                if(result.status==='unavailable')page.requestUrl='';
                flush();
                if(result.status==='cancelled')dispose(req.source);
                else if(!window.isDestroyed())window.hide();
                resolve(api.normalizeResult(req,result));
            }
            page.job={finish,window};active.set(id,page.job);
            function navigate() {
                wc.stop();page.requestUrl=req.url;
                wc.loadURL(req.url).catch(error=>{
                    // Electron can reject the new load promise with the old
                    // document's cancellation (errno -3, sometimes code='').
                    // Only a failure of THIS target may end the new query.
                    if(!done && error?.errno!==-3 && error?.code!=='ERR_ABORTED'
                        && (!error?.url || error.url===req.url))finish({status:'unavailable'});
                });
            }
            async function readMetadata(at) {
                // WebContents.executeJavaScript* waits for the load event,
                // including stalled covers. CDP can read a DOM-ready main frame
                // in a separate world without exposing IPC or universal access.
                if(!wc.debugger.isAttached()) wc.debugger.attach('1.3');
                const {frameTree}=await wc.debugger.sendCommand('Page.getFrameTree');
                if(done || frameTree?.frame.url!==at || !allowed(at)) return {status:'unavailable'};
                const {executionContextId}=await wc.debugger.sendCommand('Page.createIsolatedWorld',{
                    frameId:frameTree.frame.id,worldName:'TogetherWatchMetadata',grantUniveralAccess:false,
                });
                const result=await wc.debugger.sendCommand('Runtime.evaluate',{
                    contextId:executionContextId,returnByValue:true,timeout:1500,
                    expression:'(()=>{'+script+';return location.href !== '+JSON.stringify(at)
                        +' || document.readyState === "loading" ? {status:"unavailable"} : TogetherWatchCatalogAdapters.readDocument(document,'+JSON.stringify(req)+');})()',
                });
                return result.exceptionDetails?{status:'unavailable'}:result.result?.value;
            }
            async function poll() {
                if(done || reading) return;
                if(Date.now()>deadline){finish(partial||{status:lastStatus});return;}
                reading=true;
                try {
                    // Covers/ads can keep the load event pending after the
                    // catalogue DOM is ready. Do not let them block results.
                    if(allowed(wc.getURL())) {
                        const at=wc.getURL();
                        const raw=await Promise.race([
                            readMetadata(at),
                            new Promise((_,reject)=>{readTimer=setTimeout(()=>reject(new Error('timeout')),2000);}),
                        ]).finally(()=>clearTimeout(readTimer));
                        if(done) return;
                        if(wc.getURL()===at && allowed(at)) {
                            lastStatus=raw?.status==='verification_required'?'verification_required':'unavailable';
                            if(raw?.status==='access_blocked') {finish(raw);return;}
                            if(raw?.status==='verification_required' && !interactive) {finish(raw);return;}
                            const expected=api.expectedPage(req,at);
                            // Give delayed client rendering a brief chance before
                            // concluding that the catalogue has no matching rows.
                            const empty=raw?.status==='no_episodes' || (raw?.status==='ok' && req.kind==='search' && !raw.results?.length);
                            if(expected && ['ok','no_episodes'].includes(raw?.status)) {
                                if(!empty){
                                    // Some SPAs render titles before lazy poster attributes.
                                    // Wait for metadata only, never for image downloads.
                                    partial=raw;
                                    const missing=req.kind==='search' && raw.results?.some(row=>!row.poster_url);
                                    if(!posterSince)posterSince=Date.now();
                                    if(!missing || Date.now()-posterSince>=1500 || deadline-Date.now()<600){finish(raw);return;}
                                }
                                if(!emptySince) emptySince=Date.now();
                                if(empty && Date.now()-emptySince>=2000){finish(raw);return;}
                            } else {emptySince=0;posterSince=0;partial=null;}
                            if(interactive && !resumed && !expected && raw?.status==='ok') {
                                resumed=true;navigate();
                            }
                        }
                    }
                } catch { /* Navigation / delayed DOM: bounded retry, never click verification. */ }
                finally {reading=false; if(!done) timer=setTimeout(poll,500);}
            }
            // Retry an interrupted challenge in place, including a form the
            // user already started. A different query navigates the same tab.
            if(page.requestUrl!==req.url || !allowed(wc.getURL())
                || ['ok','no_episodes'].includes(page.resultStatus) && Date.now()-page.completedAt>60000) {
                navigate();
            }
            if(interactive && !hidden){window.show();window.focus();}
            timer=setTimeout(poll,400);
        });
    }
    return {run,cancel,cancelAll,destroy,active};
}
module.exports={createMetadataBrowser};
