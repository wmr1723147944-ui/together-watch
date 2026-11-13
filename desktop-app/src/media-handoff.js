/* Pause (and mute autoplay attempts) while an independent player is loading.
 * No reload: the site's blob and episode remain alive for explicit fallback. */
((action) => {
    function visit(win, depth = 0) {
        if (depth > 5) return;
        try {
            if (action === 'hold') {
                if (!win.__twMediaHold) {
                    const saved = new Map();
                    const pause = event => {
                        const v = event.target;
                        if (!v || !/^(VIDEO|AUDIO)$/.test(v.tagName)) return;
                        if (!saved.has(v)) saved.set(v, v.muted);
                        v.muted = true; v.pause();
                    };
                    win.document.addEventListener('play', pause, true);
                    win.__twMediaHold = {saved, pause};
                }
                for (const v of win.document.querySelectorAll('video,audio')) win.__twMediaHold.pause({target:v});
            } else if (win.__twMediaHold) {
                const {saved, pause} = win.__twMediaHold;
                win.document.removeEventListener('play', pause, true);
                for (const [v, muted] of saved) v.muted = muted;
                delete win.__twMediaHold;
            }
            for (const f of win.document.querySelectorAll('iframe')) if (f.contentWindow) visit(f.contentWindow, depth + 1);
        } catch (_) { /* Keep cross-origin boundaries intact. */ }
    }
    visit(window);
})
