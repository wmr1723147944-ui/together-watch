'use strict';
const {BrowserWindow}=require('electron');
const {api,script}=require('./catalog-adapters.cjs');
function createMetadataBrowser(parent,session,{hidden=false}={}) {
    const active=new Map();
    function cancel(id) { active.get(id)?.finish({status:'cancelled'}); }
    function cancelAll() { for (const id of active.keys()) cancel(id); }
    function run(id,kind,payload,interactive=false) {
        const req=api.request(kind,payload);
        if (!req || typeof id!=='string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || typeof interactive!=='boolean') return Promise.resolve({status:'unavailable'});
        if (active.size>=2 || active.has(id)) return Promise.resolve(api.normalizeResult(req,{status:'busy'}));
        return new Promise(resolve=>{
            const window=new BrowserWindow({parent,show:interactive && !hidden,width:1000,height:740,autoHideMenuBar:true,
                title:'原站验证 / 查询 — '+api.sources[req.source].name,
                webPreferences:{session,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,webviewTag:false}});
            const wc=window.webContents;
            window.setMenu(null);
            wc.setAudioMuted(true);
            let done=false, timer=null, readTimer=null, reading=false, emptySince=0, lastStatus='unavailable';
            const deadline=Date.now()+(interactive?180000:10000);
            function finish(result) {
                if(done) return; done=true; clearTimeout(timer); clearTimeout(readTimer); active.delete(id);
                if(!window.isDestroyed()) window.destroy();
                resolve(api.normalizeResult(req,result));
            }
            active.set(id,{finish,window});
            const allowed=value=>{
                try { const u=new URL(value); return u.origin==='https://'+api.sources[req.source].host && !u.username && !u.password; } catch { return false; }
            };
            for(const event of ['will-navigate','will-redirect']) wc.on(event,(e,url)=>{if(!allowed(url)){e.preventDefault();finish({status:'unavailable'});}});
            wc.setWindowOpenHandler(()=>({action:'deny'}));
            wc.on('will-attach-webview',e=>e.preventDefault());
            wc.on('render-process-gone',()=>finish({status:'unavailable'}));
            wc.on('did-fail-load',(_e,code,_d,_u,main)=>{if(main && code!==-3)finish({status:'unavailable'});});
            window.on('closed',()=>finish({status:'cancelled'}));
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
                if(Date.now()>deadline){finish({status:lastStatus});return;}
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
                                if(!empty){finish(raw);return;}
                                if(!emptySince) emptySince=Date.now();
                                if(Date.now()-emptySince>=2000){finish(raw);return;}
                            } else emptySince=0;
                        }
                    }
                } catch { /* Navigation / delayed DOM: bounded retry, never click verification. */ }
                finally {reading=false; if(!done) timer=setTimeout(poll,500);}
            }
            wc.loadURL(req.url).catch(error=>{if(error?.code!=='ERR_ABORTED')finish({status:'unavailable'});});
            timer=setTimeout(poll,400);
        });
    }
    return {run,cancel,cancelAll,active};
}
module.exports={createMetadataBrowser};
