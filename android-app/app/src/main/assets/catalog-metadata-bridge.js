(function () {
    'use strict';
    // Installed only by the app into its own catalogue main frame. No Java
    // object, account data or arbitrary URL-loading API is exposed to pages.
    if (window.__twMetadataQueue) return;
    const adapters=window.TogetherWatchCatalogAdapters;
    if(!adapters)return;
    const supportedSources=Object.freeze(['pkavi','233dm','kanju','huarw']);
    const pending=new Map(), cancelled=[];
    const token=globalThis.crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
    function normalize(job,raw) {
        try {return adapters.normalizeResult(job.req,raw);}
        catch {
            // The native job has already finished. A reader bug must not leave
            // the catalogue promise pending after its timeout was cleared.
            console.warn('[TogetherWatchCatalog] result_normalization_failed');
            return {source_id:job.req.source,status:'unavailable'};
        }
    }
    function cancel(id, status='cancelled') {
        const job=pending.get(id);if(!job)return;
        pending.delete(id);clearTimeout(job.timer);
        if(job.sent && cancelled.length<16)cancelled.push(id);
        job.resolve(normalize(job,{status}));
    }
    const queue=Object.freeze({
        token,
        drain() {
            const requests=[];
            for(const [id,job] of pending)if(!job.sent) {
                job.sent=true;requests.push({id,kind:job.req.kind,payload:job.payload,interactive:job.interactive});
            }
            return {token,requests,cancelled:cancelled.splice(0)};
        },
        complete(documentToken,id,raw) {
            if(documentToken!==token)return;
            const job=pending.get(id);if(!job)return;
            pending.delete(id);clearTimeout(job.timer);
            job.resolve(normalize(job,raw));
        },
    });
    Object.defineProperty(window,'__twMetadataQueue',{value:queue,configurable:false});
    Object.defineProperty(window,'twSourceMetadata',{value:Object.freeze({
        supportedSources,
        requestTimeoutMs: 42000,
        request(id,kind,payload,interactive=false) {
            const req=adapters.request(kind,payload);
            if(!req || !supportedSources.includes(req.source) || typeof id!=='string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)
                || typeof interactive!=='boolean')return Promise.resolve({status:'unavailable'});
            if(pending.size>=2 || pending.has(id))return Promise.resolve(adapters.normalizeResult(req,{status:'busy'}));
            // Do not request a source disabled in the server catalogue.
            if(!Array.from(document.querySelectorAll('[data-live-source]')).some(el=>el.dataset.liveSource===req.source))
                return Promise.resolve(adapters.normalizeResult(req,{status:'unavailable'}));
            return new Promise(resolve=>{
                const clean=kind==='search'?{source:req.source,q:req.q}:{source:req.source,page_url:req.url};
                pending.set(id,{req,payload:clean,interactive,resolve,sent:false,
                    timer:setTimeout(()=>cancel(id,'unavailable'),interactive?180000:29000)});
            });
        },cancel,
    }),configurable:false});
})();
