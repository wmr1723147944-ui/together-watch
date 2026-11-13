/* Device-local bindings to real player instances. No network URL guessing,
 * private site API, credentials, page-wide object walk or DRM handling. */
(() => {
    if (window.__twMediaBindings) return;
    const instances = new Set(), patched = new WeakSet(), loading = new Set();
    const remember = hls => {
        if (!hls || typeof hls !== 'object') return;
        for (const old of instances) if (!old.media) instances.delete(old);
        if (instances.size < 16 || instances.has(hls)) instances.add(hls);
    };
    function hook(Hls) {
        if (typeof Hls !== 'function' || !Hls.Events?.MEDIA_ATTACHED || !Hls.prototype?.attachMedia || patched.has(Hls)) return;
        patched.add(Hls);
        // Public Hls API: no changes to media, requests, events or return values.
        for (const name of ['attachMedia', 'loadSource', 'trigger']) {
            const original = Hls.prototype[name];
            if (typeof original !== 'function') continue;
            Hls.prototype[name] = function(...args) {
                remember(this);
                return Reflect.apply(original, this, args);
            };
        }
    }
    function module(url) {
        try {
            const u = new URL(url, location.href);
            // Kanju publishes its Hls constructor as an ES module, not window.hls.
            // Import only an already observed same-origin, fixed-shape runtime.
            if (!/^https:\/\/(www\.)?kanju\.ai$/.test(location.origin) || u.origin !== location.origin
                || !/^\/assets\/hls-[\w-]+\.js$/.test(u.pathname) || u.search || u.hash || loading.has(u.href) || loading.size >= 4) return;
            loading.add(u.href);
            import(u.href).then(exports => hook(exports.Hls || exports.default)).catch(() => {});
        } catch (_) { }
    }
    function refresh() {
        try { hook(window.Hls); } catch (_) { }
        try { for (const e of performance.getEntriesByType('resource')) module(e.name); } catch (_) { }
    }
    window.__twMediaBindings = {
        read(video) {
            refresh();
            if (!video || video.mediaKeys || video.__twEncrypted) return [];
            const rows = [], seen = new Set();
            let known = [video.hls, window.hls, window.dp?.plugins?.hls, ...instances];
            try { for (const art of (window.Artplayer?.instances || []).slice(0,16))
                if (!art.isDestroy && art.template?.$video === video) known.push(art.hls, art.plugins?.hls); } catch (_) { }
            for (const hls of known) {
                try {
                    if (!hls || hls.media !== video || typeof hls.url !== 'string') continue;
                    const url = new URL(hls.url, video.ownerDocument?.baseURI || location.href);
                    if (url.protocol !== 'https:' || url.username || url.password || seen.has(url.href)) continue;
                    // MediaSource is replaced on every reattach. Reject a stale
                    // instance after the DOM switched to another blob/player.
                    if (hls.mediaSource && hls.mediaSource.readyState === 'closed') continue;
                    seen.add(url.href); rows.push({url:url.href, mime:'application/x-mpegURL', binding:'hls-instance'});
                } catch (_) { }
            }
            return rows;
        }
    };
    refresh();
    try { new PerformanceObserver(list => { for (const e of list.getEntries()) module(e.name); })
        .observe({type:'resource', buffered:true}); } catch (_) { }
})();
