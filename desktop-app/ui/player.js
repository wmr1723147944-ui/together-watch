'use strict';
(() => {
    const video = document.getElementById('video'), notice = document.getElementById('notice');
    const levels = document.getElementById('levels');
    let hls = null, loadId = 0, watchdog = null, failed = '', position = 0, cropped = false;
    function fail(message) {
        failed = message; clearTimeout(watchdog); video.pause(); hls?.stopLoad();
        notice.textContent = message + ' 可点击上方“原网页”返回，或重新识别其他候选。'; notice.hidden = false;
    }
    function destroy() {
        ++loadId; clearTimeout(watchdog); hls?.destroy(); hls = null;
        video.pause(); video.removeAttribute('src'); video.load();
    }
    function load(item) {
        destroy(); failed = ''; position = item.position || 0;
        const id = loadId;
        notice.textContent = '正在加载公开媒体…'; notice.hidden = false;
        levels.replaceChildren(new Option('自动', '-1')); levels.disabled = true;
        watchdog = setTimeout(() => { if (id === loadId && video.readyState < 3) fail('20 秒内没有加载到可播放画面：可能是源站、网络或跨域限制。'); }, 20000);
        if (item.kind === 'hls' && window.Hls?.isSupported()) {
            // Start conservatively; adapt upwards after measured throughput.
            hls = new Hls({ enableWorker: true, emeEnabled: false, maxBufferLength: 30, startLevel: 0,
                xhrSetup(xhr) { xhr.withCredentials = false; } });
            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (id !== loadId || !data.fatal) return;
                const code = Number(data.response?.code) || 0;
                fail(code === 401 || code === 403 ? '源站拒绝内置播放（登录或访问权限限制）。'
                    : code === 404 ? '视频地址已失效（404）。' : 'HLS 加载失败：源站、跨域、网络或编码不兼容。');
            });
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (id !== loadId) return;
                hls.levels.forEach((level, i) => levels.add(new Option(level.height ? level.height + 'p' : '线路 ' + (i + 1), String(i))));
                levels.disabled = hls.levels.length < 2;
            });
            hls.loadSource(item.url); hls.attachMedia(video);
        } else if (item.kind === 'hls' && !video.canPlayType('application/vnd.apple.mpegurl')) fail('当前设备不支持该 HLS 视频。');
        else video.src = item.url;
    }
    video.addEventListener('loadedmetadata', () => {
        if (position > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(position, Math.max(0, video.duration - .2));
        position = 0;
    });
    video.addEventListener('canplay', () => {
        if (failed) return;
        clearTimeout(watchdog); notice.textContent = '已就绪，点击视频播放；也可由房间成员同步开始。';
    });
    video.addEventListener('playing', () => { if (!failed) notice.hidden = true; });
    video.addEventListener('encrypted', () => fail('检测到 DRM 保护，请使用原网页及自己的观看权限。'));
    video.addEventListener('error', () => {
        if (!video.getAttribute('src') || failed) return;
        fail(video.error?.code === 3 ? '设备无法解码这段视频。' : '媒体加载失败：地址失效、访问权限、跨域或编码不兼容。');
    });
    levels.onchange = () => { if (hls) hls.currentLevel = Number(levels.value); };
    document.getElementById('fit').onclick = () => { cropped = !cropped; video.style.objectFit = cropped ? 'cover' : 'contain'; };
    window.__twBuiltin = { load, destroy, state: () => ({ error: failed, ready: video.readyState >= 3 }),
        fullscreen(enabled, crop) { document.body.classList.toggle('full', enabled); video.style.objectFit = crop ? 'cover' : 'contain'; } };
})();
