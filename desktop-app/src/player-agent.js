/* Runs in the video frame with no Node or native bridge. Timing only leaves it. */
(() => {
    if (window.__twDesktopPlayer) return;
    let video = null, events = [], serial = 0, appliedCommand = 0, pending = null;
    let blocked = false, suppressUntil = 0, userUntil = 0, cleanup = [], focused = null;
    let holding = null, holdMuteUntil = 0;
    const videos = root => {
        const found = Array.from(root.querySelectorAll('video'));
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) found.push(...videos(el.shadowRoot));
        return found;
    };
    const area = v => { const r = v.getBoundingClientRect(); return r.width > 80 && r.height > 45 ? r.width * r.height : 0; };
    function bind(next) {
        if (video === next) return;
        endHold(false, false);
        if (focused) focus(false, false);
        for (const remove of cleanup) remove();
        cleanup = []; video = next; serial++; events = []; pending = null; appliedCommand = 0;
        if (!video) return;
        window.__twDanmakuOverlay?.clear();
        const listen = (target, name, fn) => { target.addEventListener(name, fn, true); cleanup.push(() => target.removeEventListener(name, fn, true)); };
        const intent = event => { if (event.isTrusted) userUntil = Date.now() + 1400; };
        for (const name of ['pointerdown', 'pointerup', 'keydown', 'keyup']) listen(document, name, intent);
        listen(video, 'loadedmetadata', () => { endHold(false, false); serial++; pending = null; events = []; });
        for (const [name, type] of [['play','play'],['pause','pause'],['seeked','seek'],['ratechange','speed']]) {
            listen(video, name, () => {
                if (holding || (Date.now() < holdMuteUntil && (type === 'speed' || type === 'seek'))) return;
                if (Date.now() > userUntil && (pending || Date.now() < suppressUntil)) return;
                // Ignore source-script buffering/advert autoplay. Explicit page
                // controls (trusted pointer/key intent) still synchronize.
                if (Date.now() > userUntil) return;
                pending = null; blocked = false;
                events.push({ type, time: video.currentTime, speed: video.playbackRate });
                if (events.length > 16) events.shift();
            });
        }
    }
    function sample() {
        if (!video?.isConnected || !area(video)) bind(videos(document).filter(v => area(v)).sort((a,b) => area(b)-area(a))[0] || null);
        if (!video) return null;
        if (holding && video.ended) endHold(true);
        else if (holding && (video.paused || video.readyState < 3 || Math.abs(video.playbackRate-holding.boosted)>.01)) endHold(false);
        if (pending && !video.seeking && video.readyState >= 3) {
            const expected = pending.time + (pending.playing ? (Date.now() - pending.at) / 1000 * pending.speed : 0);
            if (Math.abs(video.currentTime - expected) < 1.5 || Date.now() - pending.at > 15000) pending = null;
        }
        const result = { serial, area: area(video), time: holdTime(), duration: Number.isFinite(video.duration) ? video.duration : 0,
            speed: holding ? holding.speed : video.playbackRate, playing: !video.paused && !video.ended,
            holding: !!holding, visualTime: video.currentTime, visualSpeed: video.playbackRate,
            ready: video.readyState >= 3, seeking: video.seeking || !!pending,
            appliedCommand, blocked, events };
        events = []; return result;
    }
    function apply(command) {
        if (!video) return;
        if (command.type === 'volume') { video.volume = command.value; return; }
        if (command.type !== 'state' || command.id < appliedCommand) return;
        endHold(false);
        suppressUntil = Date.now() + 1500;
        userUntil = 0;
        let time = command.time + (command.playing ? Math.max(0, Math.min(15, (Date.now()-command.issuedAt)/1000))*command.speed : 0);
        if (Number.isFinite(video.duration) && video.duration > 0) time = Math.min(time, video.duration);
        pending = command.seek ? { time, at: Date.now(), playing: command.playing, speed: command.speed } : null;
        if (command.seek) video.currentTime = time;
        video.playbackRate = command.speed;
        if (command.playing) video.play().then(() => { blocked = false; }).catch(() => { blocked = true; pending = null; });
        else video.pause();
        appliedCommand = command.id;
    }
    function holdTime() {
        return holding ? holding.start + Math.max(0, video.currentTime - holding.start) * holding.speed / holding.boosted : video.currentTime;
    }
    function canHold(x, y, fullscreen = false) {
        if (!video || holding || pending || blocked || video.paused || video.ended || video.readyState < 3 || video.seeking || events.length) return false;
        if (!fullscreen) {
            const r=video.getBoundingClientRect(), hit=document.elementFromPoint?.(x,y);
            if (!Number.isFinite(x) || !Number.isFinite(y) || x<r.left || x>r.right || y<r.top || y>r.bottom-Math.min(56,r.height*.2)
                || hit?.closest?.('button,a,input,select,textarea,[role="button"],[role="slider"],[contenteditable="true"]')) return false;
        }
        return true;
    }
    function beginHold(x, y, fullscreen = false) {
        if (!canHold(x,y,fullscreen)) return false;
        holding={start:video.currentTime,speed:video.playbackRate,boosted:Math.max(2,video.playbackRate)};
        userUntil=0;holdMuteUntil=Date.now()+500;
        video.playbackRate=holding.boosted;
        return true;
    }
    function endHold(commit, restorePosition = true) {
        if (!holding || !video) return;
        const time=holdTime(), speed=holding.speed;
        holding=null;userUntil=0;holdMuteUntil=Date.now()+500;
        video.playbackRate=speed;
        if (commit) events.push({type:'seek',time:video.currentTime,speed});
        else if (restorePosition) video.currentTime=time;
    }
    function focus(enabled, crop) {
        if (!video) return false;
        if (enabled && !focused) {
            focused = { video, videoStyle: video.getAttribute('style'), controls: video.controls, ancestors: [] };
            // Source-site controls can sit outside the video element. Keep
            // usable controls when the video alone occupies the screen.
            video.controls = true;
            let node = video.parentElement;
            while (node) {
                focused.ancestors.push([node, node.getAttribute('style')]);
                node.style.setProperty('transform', 'none', 'important');
                node.style.setProperty('contain', 'none', 'important');
                node.style.setProperty('overflow', 'visible', 'important');
                node = node.parentElement;
            }
            video.style.cssText += ';position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483647!important;background:black!important';
        }
        if (enabled) video.style.setProperty('object-fit', crop ? 'cover' : 'contain', 'important');
        else if (focused) {
            const restore = (node, value) => { if (value === null) node.removeAttribute('style'); else node.setAttribute('style', value); };
            restore(focused.video, focused.videoStyle);
            focused.video.controls = focused.controls;
            for (const [node, style] of focused.ancestors) restore(node, style);
            focused = null;
        }
        return true;
    }
    window.__twDesktopPlayer = { sample, apply, focus, canHold, beginHold, endHold, overlay(data) { window.__twDanmakuOverlay?.set(video,data); } };
})();
