// Invoked in an isolated world, on a confirmed Kanju episode only. No stream
// capture, media URL forwarding or account data. The source keeps its decoder.
(function(mode,token,episode){
    const prev=window.__twInlineState;
    if(mode==='restore'){
        if(prev?.token===token){prev.stop();delete window.__twInlineState;}
        if(document.documentElement.getAttribute('data-tw-inline-mode')===token)document.documentElement.removeAttribute('data-tw-inline-mode');
        return true;
    }
    if(mode==='check')return prev?.token===token && prev.valid();
    if(!window.TogetherWatchCatalogAdapters?.episodeReady(document,episode)
        || document.querySelector('dialog[open],[aria-modal="true"]'))return false;
    const videos=[...document.querySelectorAll('video')].filter(v=>{
        const r=v.getBoundingClientRect();return r.width>100 && r.height>70;
    });
    const v=videos[0];
    if(videos.length!==1 || !v || v.mediaKeys || v.__twEncrypted || !v.currentSrc || !Number.isFinite(v.duration) || v.duration<120 || v.readyState<2)return false;
    const src=v.currentSrc,controls=v.controls;
    const valid=()=>v.isConnected && v.getAttribute('data-tw-inline')===token && document.documentElement.getAttribute('data-tw-inline-mode')===token && v.currentSrc===src && !v.mediaKeys
        && window.TogetherWatchCatalogAdapters.episodeReady(document,episode);
    const stop=()=>{v.removeEventListener('encrypted',stop);v.removeEventListener('loadstart',stop);
        if(v.getAttribute('data-tw-inline')===token){v.removeAttribute('data-tw-inline');v.controls=controls;}};
    prev?.stop();
    document.documentElement.setAttribute('data-tw-inline-mode',token);
    v.setAttribute('data-tw-inline',token);v.controls=true;
    v.addEventListener('encrypted',stop);v.addEventListener('loadstart',stop);
    window.__twInlineState={token,valid,stop};return true;
})
