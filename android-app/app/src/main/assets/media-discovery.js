/* Returns data to evaluateJavascript; exposes no Android methods to the page. */
(function discoverMedia() {
    const candidates = new Map();
    const visited = new Set();
    let protectedVideo = false;
    let longFormPlayers = 0;
    const playerSources=[];
    let visiblePlayers=0, opaquePlayers=0, readyBlobPlayers=0, inaccessibleFrames=0;
    function add(raw, active = false, position = 0, duration = 0, visible = false, base = location.href, attached=false, mime='') {
        try {
            if (!raw || typeof raw !== 'string') return;
            const url = new URL(raw, base);
            if (url.protocol !== 'https:' || url.username || url.password) return;
            const leaf=url.pathname.split('/').pop();
            // A decoded, visible <video>'s own currentSrc is media evidence;
            // a similarly named request, inactive <source> or poster is not.
            // Kanju CDN examples include both opaque IDs and a ".image" alias
            // on a stream the browser has actually decoded as a long video.
            const confirmed=!!(attached && visible && duration>0 && leaf && (mime==='application/x-mpegURL' || !leaf.includes('.') || /\.image$/i.test(leaf)));
            if (!confirmed && !/\.(mp4|m4v|webm|m3u8|mpd)$/i.test(url.pathname)) return;
            const prior = candidates.get(url.href);
            if (!prior || active || visible) candidates.set(url.href, { url: url.href, active, position, duration, visible, confirmed, mime, attached });
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
            if(visible)visiblePlayers++;
            const active = visible && video.readyState >= 1 && !video.paused;
            if (visible && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration >= 120) longFormPlayers++;
            const base=video.ownerDocument?.baseURI || location.href;
            const sources=Array.from(video.querySelectorAll('source[src]'));
            const attached=video.currentSrc || video.src || (sources.length===1 ? sources[0].src : '');
            if(visible && video.readyState>=1 && Number.isFinite(video.duration) && video.duration>=120 && attached)playerSources.push(attached);
            const record=(raw,bound,mime='')=>{
                add(raw,active,video.currentTime || 0,Number.isFinite(video.duration)?video.duration:0,visible && video.readyState>=1,base,bound,mime);
                try { const c=candidates.get(new URL(raw,base).href); if(c)c.referrerPolicy=video.getAttribute?.('referrerpolicy') || ''; } catch (_) { }
            };
            record(attached,!!video.currentSrc && !video.srcObject);
            if (String(attached).startsWith('blob:')) {
                if(visible)opaquePlayers++;
                if(visible && video.readyState>=1 && Number.isFinite(video.duration) && video.duration>=120)readyBlobPlayers++;
                // A blob is not playable outside this WebView. Only trust a
                // manifest from an HLS instance attached to this exact video.
                try {
                    const win=video.ownerDocument?.defaultView;
                    for (const hls of [video.hls,win?.hls,win?.dp?.plugins?.hls]) {
                        if (hls?.media===video && typeof hls.url==='string') record(hls.url,true,'application/x-mpegURL');
                    }
                    for (const binding of (win?.__twMediaBindings?.read(video) || [])) record(binding.url,true,binding.mime);
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
            try { if(frame.contentDocument)scan(frame.contentDocument, depth + 1);else inaccessibleFrames++; } catch (_) { inaccessibleFrames++; }
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
    return { protectedVideo, longFormPlayers, visiblePlayers, opaquePlayers, readyBlobPlayers, inaccessibleFrames, playerSources:protectedVideo?[]:playerSources, candidates: protectedVideo ? [] : playerUrls.concat(all.filter(c=>!c.visible).reverse()).slice(0,24) };
})()
