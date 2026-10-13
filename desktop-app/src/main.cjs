'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, protocol, net, dialog, clipboard, shell, session, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const policy = require('./policy.cjs');
const AGENT = fs.readFileSync(path.join(__dirname, 'player-agent.js'), 'utf8');
const SMOKE = !app.isPackaged && process.argv.includes('--smoke-test');
const PACKAGE_CHECK = process.argv.includes('--verify-package');
const shells = new Map();
protocol.registerSchemesAsPrivileged([{ scheme: 'tw-app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.enableSandbox();
if (SMOKE || PACKAGE_CHECK) app.setPath('userData', path.join(app.getPath('temp'), `tw-desktop-check-${process.pid}`));
else if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
});

const securePreferences = extra => ({ sandbox: true, contextIsolation: true, nodeIntegration: false,
    webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, ...extra });
const timeout = (promise, ms = 2500) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); })]).finally(() => clearTimeout(timer));
};

async function createDesktop({ server = policy.SERVER, testSource = '', visible = true } = {}) {
    if (!SMOKE && server !== policy.SERVER) throw new Error('Untrusted server');
    const win = new BrowserWindow({ title: '一起看 · Windows', width: 1360, height: 850, minWidth: 980, minHeight: 680,
        backgroundColor: '#111020', show: visible, autoHideMenuBar: true,
        webPreferences: securePreferences({ preload: path.join(__dirname, 'preload.cjs') }) });
    win.setMenu(null);
    let video = null, roomView = null, current = null, generation = 0, timer = null;
    let selected = null, playerSession = 0, full = false, crop = false, searchingSince = 0;
    let micApproved = false, switching = false;
    const status = data => { if (!win.isDestroyed()) win.webContents.send('desktop:status', typeof data === 'string' ? { message: data } : data); };
    const roomTrusted = wc => !!current && wc === roomView?.webContents && policy.isRoomUrl(wc.getURL(), current.room, server);
    const sourceAllowed = url => !!policy.publicHttps(url) || (SMOKE && testSource && typeof url === 'string' && url.startsWith(testSource));
    const roomPartition = session.fromPartition(SMOKE ? `room-test-${win.id}` : 'persist:tw-room');
    const videoPartition = session.fromPartition(SMOKE ? `video-test-${win.id}` : 'persist:tw-video');

    function guardSession(ses, isRoom) {
        ses.setPermissionCheckHandler((wc, permission, origin, details) => {
            if (permission === 'fullscreen') return wc === video?.webContents;
            return isRoom && micApproved && permission === 'media' && origin === server
                && details.isMainFrame && details.mediaType === 'audio' && roomTrusted(wc);
        });
        ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
            if (permission === 'fullscreen') return callback(wc === video?.webContents);
            const url = details.requestingUrl || '';
            if (!isRoom || permission !== 'media' || !details.isMainFrame || !roomTrusted(wc)
                || !policy.isRoomUrl(url, current.room, server) || !Array.isArray(details.mediaTypes)
                || details.mediaTypes.length !== 1 || details.mediaTypes[0] !== 'audio') return callback(false);
            const epoch = generation;
            const result = await dialog.showMessageBox(win, { type: 'question', title: '加入语音',
                message: '允许一起看房间使用麦克风吗？', detail: '只用于你主动加入的房间通话，视频来源网页无法获得麦克风权限。',
                buttons: ['暂不允许', '允许本次通话'], defaultId: 0, cancelId: 0 });
            micApproved = result.response === 1 && epoch === generation && roomTrusted(wc);
            callback(micApproved);
        });
        ses.on('will-download', event => { event.preventDefault(); status('已拦截网页下载。此测试版不下载视频或安装其他软件。'); });
    }
    guardSession(roomPartition, true); guardSession(videoPartition, false);

    function layout() {
        if (!video || !roomView || win.isDestroyed()) return;
        const [width, height] = win.getContentSize();
        const bounds = policy.panelBounds(width, height, full);
        video.setBounds(bounds.video); roomView.setBounds(bounds.room);
        roomView.setVisible(!full);
    }
    function keyHandler(_event, input) {
        if (input.type !== 'keyDown') return;
        if (input.key === 'F11') { _event.preventDefault(); toggleFullscreen(); }
        else if (input.key === 'Escape' && full) { _event.preventDefault(); toggleFullscreen(false); }
        else if (input.key.toLowerCase() === 'z' && full && input.control) { _event.preventDefault(); crop = !crop; focusPlayer(full); }
    }
    async function focusPlayer(enabled) {
        if (!selected) return;
        try {
            await timeout(selected.frame.executeJavaScript(`window.__twDesktopPlayer?.focus(${Boolean(enabled)},${crop})`));
            // Expand the iframe chain as well as its video, without rewriting
            // cross-origin security headers or moving content between sites.
            let child = selected.frame;
            while (child.parent) {
                const parent = child.parent;
                await timeout(parent.executeJavaScript(`(${function(childUrl, childName, enabled) {
                    const key = '__twDesktopFrameStyles';
                    if (!enabled) { for (const [el, style] of window[key] || []) { if (style === null) el.removeAttribute('style'); else el.setAttribute('style', style); } window[key] = null; return; }
                    if (window[key]) return;
                    const frames = Array.from(document.querySelectorAll('iframe'));
                    const frame = frames.find(f => childName && f.name === childName) || frames.find(f => f.src === childUrl) || (frames.length === 1 ? frames[0] : null);
                    if (!frame) return;
                    window[key] = [[frame, frame.getAttribute('style')]];
                    let node = frame.parentElement;
                    while (node) { window[key].push([node, node.getAttribute('style')]); node.style.setProperty('transform','none','important'); node.style.setProperty('contain','none','important'); node.style.setProperty('overflow','visible','important'); node = node.parentElement; }
                    frame.style.cssText += ';position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;border:0!important;z-index:2147483647!important;background:black!important';
                }.toString()})(${JSON.stringify(child.url)},${JSON.stringify(child.name)},${Boolean(enabled)})`));
                child = parent;
            }
        } catch { /* Frame navigation invalidates old handles. */ }
    }
    async function toggleFullscreen(value = !full) {
        if (!video) return;
        full = !!value;
        win.setFullScreen(full); layout();
        await focusPlayer(full);
        if (full) status('全屏：Esc / F11 返回，Ctrl+Z 切换完整画面和铺满裁边');
    }
    function closeViews() {
        ++generation; clearTimeout(timer); timer = null; selected = null; current = null; micApproved = false;
        full = false;
        if (!win.isDestroyed()) win.setFullScreen(false);
        for (const view of [video, roomView]) if (view) {
            if (!win.isDestroyed()) win.contentView.removeChildView(view);
            if (!view.webContents.isDestroyed()) view.webContents.close();
        }
        video = roomView = null;
    }
    function setupView(view, isRoom) {
        const wc = view.webContents;
        wc.on('before-input-event', keyHandler);
        wc.on('will-attach-webview', event => event.preventDefault());
        wc.on('will-navigate', (event, url) => {
            if (isRoom ? !policy.isRoomUrl(url, current?.room, server) : !sourceAllowed(url)) event.preventDefault();
        });
        wc.on('will-redirect', (event, url) => {
            if (isRoom ? !(url === server + '/' || policy.isRoomUrl(url, current?.room, server)) : !sourceAllowed(url)) event.preventDefault();
        });
        wc.setWindowOpenHandler(({ url }) => {
            if (!isRoom && sourceAllowed(url)) {
                // No hidden popups. Let the user decide whether this is a
                // requested playback/login page rather than an advertisement.
                const epoch = generation;
                dialog.showMessageBox(win, { type: 'question', message: '播放页想打开一个新页面',
                    detail: new URL(url).hostname + '\n是否在左侧打开？当前播放会停止。',
                    buttons: ['取消', '打开'], defaultId: 0, cancelId: 0 }).then(result => {
                    if (result.response === 1 && epoch === generation) navigateVideo(url);
                });
            }
            return { action: 'deny' };
        });
        wc.on('render-process-gone', () => status(isRoom ? '房间进程中断，请重新设置并入房' : '播放页进程中断，请刷新页面'));
        wc.on('did-fail-load', (_e, code, _description, _url, mainFrame) => {
            if (mainFrame && code !== -3) status(isRoom ? '房间加载失败，请检查网站和网络' : '视频页加载失败，请检查链接或重新刷新');
        });
        if (!isRoom) {
            wc.on('did-navigate', (_e, url) => { selected = null; searchingSince = Date.now(); status({ source: url, message: '正在识别播放器；请在网页中开始播放' }); });
            wc.on('enter-html-full-screen', () => { full = true; win.setFullScreen(true); layout(); });
            wc.on('leave-html-full-screen', () => { full = false; win.setFullScreen(false); layout(); });
        }
    }
    async function navigateVideo(url) {
        if (!sourceAllowed(url) || !video) return { ok: false, error: '请输入公开的 HTTPS 链接' };
        await toggleFullscreen(false); selected = null; searchingSince = Date.now();
        video.webContents.loadURL(url).catch(() => {});
        return { ok: true };
    }
    async function start(data) {
        if (switching) return { ok: false, error: '正在打开，请稍候' };
        if (!data || data.consent !== true || typeof data.nickname !== 'string' || !data.nickname.trim()) return { ok: false, error: '请填写昵称并同意使用说明' };
        if (!sourceAllowed(data.source)) return { ok: false, error: '请填写公开的 HTTPS 视频页或视频直链' };
        const id = data.room ? policy.roomFrom(data.room, server) : crypto.randomBytes(12).toString('hex');
        if (!id) return { ok: false, error: '房间号或邀请链接无效' };
        switching = true; closeViews();
        current = { room: id, nickname: data.nickname.trim().slice(0, 32) };
        const epoch = generation;
        video = new WebContentsView({ webPreferences: securePreferences({ session: videoPartition }) });
        roomView = new WebContentsView({ webPreferences: securePreferences({ session: roomPartition, backgroundThrottling: false }) });
        video.setBackgroundColor('#000000'); roomView.setBackgroundColor('#171427');
        for (const view of [video, roomView]) win.contentView.addChildView(view);
        setupView(video, false); setupView(roomView, true); layout();
        searchingSince = Date.now();
        video.webContents.loadURL(data.source).catch(() => {});
        try {
            await roomView.webContents.loadURL(server + '/');
            if (epoch !== generation || new URL(roomView.webContents.getURL()).origin !== server) throw new Error('navigation changed');
            // The user explicitly accepted the same site's terms in the shell.
            await roomView.webContents.executeJavaScript(`localStorage.setItem('tw_username',${JSON.stringify(current.nickname)});localStorage.setItem('tw_legal_notice_version','2026-07-28');true`);
            await roomView.webContents.loadURL(server + '/mobile-room/' + encodeURIComponent(id));
            if (epoch !== generation) throw new Error('session changed');
            const ready = await roomView.webContents.executeJavaScript('!!window.TogetherWatchMobile');
            if (!ready) throw new Error('mobile bridge unavailable');
            timer = setTimeout(() => tick(epoch), 200);
            status('房间已打开 · 正在识别播放器');
            return { ok: true, room: id };
        } catch {
            if (epoch === generation) closeViews();
            return { ok: false, error: '无法连接新版房间页面，请确认网站已更新并检查网络' };
        } finally { switching = false; }
    }
    async function tick(epoch) {
        if (epoch !== generation || !current || !video || !roomTrusted(roomView.webContents)) return;
        try {
            const wc = video.webContents;
            let raw;
            if (selected && !selected.frame.isDestroyed()) raw = await timeout(selected.frame.executeJavaScript('window.__twDesktopPlayer?.sample()'));
            if (!raw) {
                selected = null;
                const frames = wc.mainFrame.framesInSubtree.slice(0, 32);
                const candidates = await Promise.all(frames.map(async frame => {
                    try {
                        if (!sourceAllowed(frame.url) && frame.url !== 'about:blank') return null;
                        const sample = await timeout(frame.executeJavaScript(AGENT + ';window.__twDesktopPlayer.sample()'));
                        return sample && sample.area > 0 ? { frame, raw: sample } : null;
                    } catch { return null; }
                }));
                const best = candidates.filter(Boolean).sort((a,b) => b.raw.area - a.raw.area)[0];
                if (best) { selected = { frame: best.frame, serial: best.raw.serial }; raw = best.raw; playerSession++; if (full) await focusPlayer(true); }
            }
            if (epoch !== generation) return;
            if (!raw || !selected) {
                await timeout(roomView.webContents.executeJavaScript("window.TogetherWatchMobile.receive({active:false});window.TogetherWatchMobile.drain()"));
                if (Date.now() - searchingSince > 10000) status('尚未找到 HTML5 播放器：请先点网页播放；部分 DRM 或定制播放器不兼容');
            } else {
                if (raw.serial !== selected.serial) { selected.serial = raw.serial; playerSession++; }
                const sample = policy.timingSample(raw, playerSession);
                if (!sample) throw new Error('invalid player data');
                const reply = await timeout(roomView.webContents.executeJavaScript(`window.TogetherWatchMobile.receive(${JSON.stringify(sample)});window.TogetherWatchMobile.drain()`));
                if (epoch !== generation) return;
                for (const value of (Array.isArray(reply?.commands) ? reply.commands : []).slice(0, 4)) {
                    const command = policy.playbackCommand(value, playerSession);
                    if (command) await timeout(selected.frame.executeJavaScript(`window.__twDesktopPlayer?.apply(${JSON.stringify(command)})`));
                }
                status(sample.error || (full ? '全屏：Esc / F11 返回，Ctrl+Z 切换铺满' : '已识别播放器 · 在左侧播放，右侧聊天与通话'));
            }
        } catch { selected = null; status('播放页发生变化，正在重新连接播放器…'); }
        if (epoch === generation) timer = setTimeout(() => tick(epoch), selected ? 350 : 1200);
    }
    async function action(value) {
        if (value && typeof value === 'object' && value.type === 'source') return navigateVideo(value.source);
        if (value === 'terms' || value === 'privacy') { await shell.openExternal(policy.SERVER + '/' + value); return; }
        if (value === 'settings') { closeViews(); status({ setup: true, message: '已退出房间，可以重新设置' }); return; }
        if (!current) return;
        if (value === 'invite') { clipboard.writeText(`${server}/room/${encodeURIComponent(current.room)}`); status('邀请链接已复制。朋友需打开同一集、同一版本。'); }
        else if (value === 'fullscreen') await toggleFullscreen();
        else if (value === 'detect') { await focusPlayer(false); selected = null; searchingSince = Date.now(); status('正在重新识别播放器'); }
        else if (value === 'reload') { selected = null; video.webContents.reload(); }
        else if (value === 'back' && video.webContents.navigationHistory.canGoBack()) video.webContents.navigationHistory.goBack();
    }
    const senderIsShell = event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame
        && event.senderFrame.url === policy.APP_ORIGIN + '/index.html';
    // There is exactly one shell; remote views have no preload and no IPC API.
    shells.set(win.webContents.id, { senderIsShell, start, action });
    const shellId = win.webContents.id;
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('before-input-event', keyHandler);
    win.on('resize', layout);
    win.on('leave-full-screen', () => { full = false; focusPlayer(false); layout(); });
    win.on('close', closeViews);
    win.on('closed', () => shells.delete(shellId));
    const suspend = () => { if (video) video.webContents.setAudioMuted(true); if (roomTrusted(roomView?.webContents)) roomView.webContents.executeJavaScript('window.TogetherWatchMobile.suspend()').catch(() => {}); };
    const resume = () => { if (video) video.webContents.setAudioMuted(false); };
    powerMonitor.on('suspend', suspend); powerMonitor.on('resume', resume);
    win.on('closed', () => { powerMonitor.removeListener('suspend', suspend); powerMonitor.removeListener('resume', resume); });
    await win.loadURL(policy.APP_ORIGIN + '/index.html');
    return { win, start, action, close: () => win.close(), state: () => ({ video, roomView, selected, full, current }), toggleFullscreen };
}

app.whenReady().then(async () => {
    for (const command of ['start', 'action']) ipcMain.handle('desktop:' + command, (event, data) => {
        const control = shells.get(event.sender.id);
        return control?.senderIsShell(event) ? control[command](data) : { ok: false };
    });
    const assets = new Map(['index.html','shell.css','shell.js'].map(name => ['/' + name, path.join(__dirname, '..', 'ui', name)]));
    protocol.handle('tw-app', request => {
        const url = new URL(request.url);
        if (url.host !== 'desktop' || !assets.has(url.pathname)) return new Response('Not found', { status: 404 });
        return net.fetch(pathToFileURL(assets.get(url.pathname)).href);
    });
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    if (SMOKE) {
        try { await require('../tests/smoke.cjs').run(createDesktop); app.exit(0); }
        catch (error) { console.error('SMOKE FAILED:', error.stack); app.exit(1); }
    } else if (PACKAGE_CHECK) {
        try {
            const client = await createDesktop({ visible: false });
            const ready = await client.win.webContents.executeJavaScript('typeof window.desktop?.start === "function" && !!document.getElementById("startForm")');
            if (!ready) throw new Error('packaged shell unavailable');
            console.log('PACKAGE CHECK PASS: packaged shell, preload and assets loaded.');
            app.exit(0);
        } catch (error) { console.error(error); app.exit(1); }
    } else await createDesktop();
});
app.on('window-all-closed', () => { if (!SMOKE) app.quit(); });
