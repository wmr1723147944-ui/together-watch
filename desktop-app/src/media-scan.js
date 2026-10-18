/* Read-only, per-frame discovery. No page-provided script is evaluated. */
(() => {
    const result = { protected: false, candidates: [] };
    const seen = new Set();
    function scan(root, depth = 0) {
        if (depth > 5 || seen.has(root)) return;
        seen.add(root);
        for (const video of root.querySelectorAll('video')) {
            if (!video.__twEncryptedListener) {
                video.__twEncryptedListener = true;
                video.addEventListener('encrypted', () => { video.__twEncrypted = true; });
            }
            if (video.mediaKeys || video.__twEncrypted) result.protected = true;
            const r = video.getBoundingClientRect();
            const details = { dom: true, active: r.width > 80 && r.height > 45 && !video.paused && video.readyState >= 1,
                position: video.currentTime || 0, duration: Number.isFinite(video.duration) ? video.duration : 0 };
            const url = video.currentSrc || video.src;
            if (url) result.candidates.push({ url, ...details });
            for (const source of video.querySelectorAll('source[src]')) result.candidates.push({ url: source.src });
        }
        for (const node of Array.from(root.querySelectorAll('*')).slice(0, 3000)) if (node.shadowRoot) scan(node.shadowRoot, depth + 1);
    }
    scan(document);
    for (const entry of performance.getEntriesByType('resource').slice(-150)) result.candidates.push({ url: entry.name });
    result.candidates = result.candidates.slice(0, 200);
    return result;
})()
