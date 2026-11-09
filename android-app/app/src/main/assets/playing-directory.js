/* Read public episode labels from the already loaded player, without clicking or navigating it. */
(function(req, expectedUrl) {
    try {
        const a=window.TogetherWatchCatalogAdapters;
        if(!a || req.kind!=='detail' || location.href!==expectedUrl || !document.body)return null;
        const current=a.fromPage(location.href);
        if(!a.expectedPage(req,location.href) && !(current?.source===req.source && current?.item===req.item))return null;
        const data=a.normalizeResult(req,a.readDocument(document,req));
        return data.status==='ok' && data.episodes?.length ? data : null;
    } catch (_) {return null;}
})
