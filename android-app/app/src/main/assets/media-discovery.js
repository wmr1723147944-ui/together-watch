/* Returns data to evaluateJavascript; exposes no Android methods to the page. */
(function discoverMedia() {
    const candidates = new Map();
    const visited = new Set();
    let protectedVideo = false;
    let longFormPlayers = 0;
    function add(raw, active = false, position = 0, duration = 0, visible = false, base = location.href) {
        try {
            if (!raw || typeof raw !== 'string') return;
            const url = new URL(raw, base);
            if (url.protocol !== 'https:' || url.username || url.password || !/\.(mp4|m4v|webm|m3u8|mpd)$/i.test(url.pathname)) return;
            const prior = candidates.get(url.href);
            if (!prior || active || visible) candidates.set(url.href, { url: url.href, active, position, duration, visible });
        } catch (_) { }
    }
    function scan(root, depth = 0) {
        if (!root || visited.has(root) || depth > 5) return;
        visited.add(root);
        for (const video of root.querySelectorAll('video')) {
            if (!video.__twEncryptionWatch && video.addEventListener) {
                video.__twEncryptionWatch = true;
                video.addEventListener('encrypted', () => { video.__twEncrypted = true; });
            }
            if (video.mediaKeys || video.__twEncrypted) { protectedVideo = true; continue; }
            const rect = video.getBoundingClientRect();
            const visible = rect.width > 100 && rect.height > 70;
            const active = visible && video.readyState >= 1 && !video.paused;
            if (visible && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration >= 120) longFormPlayers++;
            const base=video.ownerDocument?.baseURI || location.href;
            const sources=Array.from(video.querySelectorAll('source[src]'));
            const attached=video.currentSrc || video.src || (sources.length===1 ? sources[0].src : '');
            const record=raw=>add(raw,active,video.currentTime || 0,Number.isFinite(video.duration)?video.duration:0,visible && video.readyState>=1,base);
            record(attached);
            if (String(attached).startsWith('blob:')) {
                // A blob is not playable outside this WebView. Only trust a
                // manifest from an HLS instance attached to this exact video.
                try {
                    const win=video.ownerDocument?.defaultView;
                    for (const hls of [video.hls,win?.hls,win?.dp?.plugins?.hls]) {
                        if (hls?.media===video && typeof hls.url==='string') record(hls.url);
                    }
                } catch (_) { }
            }
            if (visible && video.readyState===0 && video.preload==='none' && attached && !video.__twMetadataRequested) {
                // Request metadata, not playback: never autoplay the hidden site.
                video.__twMetadataRequested=true;
                video.preload='metadata';
            }
            for (const source of sources) add(source.src,false,0,0,false,base);
        }
        for (const frame of root.querySelectorAll('iframe')) {
            try { scan(frame.contentDocument, depth + 1); } catch (_) { }
        }
        for (const element of Array.from(root.querySelectorAll('*')).slice(0, 3000)) {
            if (element.shadowRoot) scan(element.shadowRoot, depth + 1);
        }
    }
    scan(document);
    for (const entry of performance.getEntriesByType('resource').slice(-200)) add(entry.name);
    // Never mix recognized protected playback with a captured network URL.
    const all=Array.from(candidates.values());
    const playerUrls=all.filter(c=>c.visible);
    return { protectedVideo, longFormPlayers, candidates: protectedVideo ? [] : playerUrls.concat(all.filter(c=>!c.visible).reverse()).slice(0,24) };
})()
