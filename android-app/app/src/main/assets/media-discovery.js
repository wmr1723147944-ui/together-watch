/* Returns data to evaluateJavascript; exposes no Android methods to the page. */
(function discoverMedia() {
    const candidates = new Map();
    const visited = new Set();
    let protectedVideo = false;
    let longFormPlayers = 0;
    function add(raw, active = false, position = 0, duration = 0, visible = false) {
        try {
            const url = new URL(raw, location.href);
            if (url.protocol !== 'https:' || !/\.(mp4|m4v|webm|m3u8|mpd)$/i.test(url.pathname)) return;
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
            add(video.currentSrc || video.src, active, video.currentTime || 0, Number.isFinite(video.duration) ? video.duration : 0, visible && video.readyState >= 1);
            for (const source of video.querySelectorAll('source[src]')) add(source.src);
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
    return { protectedVideo, longFormPlayers, candidates: protectedVideo ? [] : Array.from(candidates.values()).slice(-24) };
})()
