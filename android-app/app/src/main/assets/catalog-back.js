/* Return an explicit root result only after the trusted catalogue has handled its layers. */
(function(origin) {
    try {
        if(location.origin!==origin || !['/','/discover'].includes(location.pathname))return 'unavailable';
        const nav=window.TogetherWatchCatalogNavigation;
        if(typeof nav?.back!=='function')return 'unavailable';
        const account=document.getElementById('accountDialog');
        if(account?.open){account.close();return 'handled';}
        const result=nav.back();
        return result===true?'handled':result===false?'home':'unavailable';
    } catch (_) {return 'unavailable';}
})
