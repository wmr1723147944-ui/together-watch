/* First-party document only. A successful API call does not prove the drawer painted. */
(function(program, origin) {
    // getUrl() may already report the requested URL while WebView still runs
    // the initial about:blank document. Do not turn this load phase into an
    // untrusted-page failure, and never call the bridge in that document.
    if(location.href==='about:blank')return 'waiting';
    if(location.origin!==origin || !['/','/discover'].includes(location.pathname))return 'untrusted';
    if(document.readyState==='loading')return 'waiting';
    try {
        const nav=window.TogetherWatchCatalogNavigation;
        if(nav?.pickerClosed?.())return 'closed';
        if(!window.__twMetadataQueue || typeof nav?.episodes!=='function')return 'waiting';
        if(!window.__twPickerOpened) {
            if(nav.episodes(program)!==true)return 'unsupported';
            window.__twPickerOpened=true;
        }
        const panel=document.getElementById('discoveryDetail');
        if(!panel?.open)return 'waiting';
        const style=getComputedStyle(panel),box=panel.getBoundingClientRect();
        if(!(style.visibility==='visible' && style.display!=='none' && Number(style.opacity)>0
            && box.width>80 && box.height>80 && box.right>0 && box.bottom>0
            && box.left<innerWidth && box.top<innerHeight))return 'waiting';
        if(window.__twMetadataQueue.interactivePending?.())return 'verifying';
        const list=document.getElementById('discoveryEpisodes');
        if(list?.querySelector('a.discovery-episode[href^="/discover/play/"]'))return 'ready';
        const message=document.getElementById('discoveryDetailStatus')?.textContent?.trim()||'';
        if(message && !/正在|等待/.test(message))return 'notice';
        return 'loading';
    } catch (error) {
        // Fixed diagnostic codes only, never page text, URLs or exception data.
        return ['TypeError','ReferenceError','SyntaxError'].includes(error?.name)?'error-'+error.name:'error';
    }
})
