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
            let done=false, timer=null, readTimer=null, reading=false, emptySince=0;
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
            async function poll() {
                if(done || reading) return;
                if(Date.now()>deadline){finish({status:'unavailable'});return;}
                reading=true;
                try {
                    if(!wc.isLoadingMainFrame() && allowed(wc.getURL())) {
                        const at=wc.getURL();
                        // A dedicated isolated world: page scripts cannot replace
                        // our parser or gain access to the desktop bridge.
                        const raw=await Promise.race([
                            wc.executeJavaScriptInIsolatedWorld(991,[{code:script+';TogetherWatchCatalogAdapters.readDocument(document,'+JSON.stringify(req)+')'}]),
                            new Promise((_,reject)=>{readTimer=setTimeout(()=>reject(new Error('timeout')),2000);}),
                        ]).finally(()=>clearTimeout(readTimer));
                        if(done) return;
                        if(wc.getURL()===at && allowed(at)) {
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
