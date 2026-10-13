/* Returns data to evaluateJavascript; exposes no Android methods to the page. */
(function discoverMedia() {
    const candidates = new Map();
    const visited = new Set();
    let protectedVideo = false;
    function add(raw, active = false, position = 0, duration = 0) {
        try {
            const url = new URL(raw, location.href);
            if (url.protocol !== 'https:' || !/\.(mp4|m4v|webm|m3u8|mpd)$/i.test(url.pathname)) return;
            const prior = candidates.get(url.href);
            if (!prior || active) candidates.set(url.href, { url: url.href, active, position, duration });
        } catch (_) { }
    }
    function scan(root, depth = 0) {
        if (!root || visited.has(root) || depth > 5) return;
        visited.add(root);
        for (const video of root.querySelectorAll('video')) {
            if (video.mediaKeys) { protectedVideo = true; continue; }
            const rect = video.getBoundingClientRect();
            const visible = rect.width > 100 && rect.height > 70;
            const active = visible && video.readyState >= 1 && !video.paused;
            add(video.currentSrc || video.src, active, video.currentTime || 0, Number.isFinite(video.duration) ? video.duration : 0);
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
    return { protectedVideo, candidates: protectedVideo ? [] : Array.from(candidates.values()).slice(-24) };
})()
