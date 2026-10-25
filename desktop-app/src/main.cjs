'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, protocol, net, dialog, clipboard, shell, session, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');
const policy = require('./policy.cjs');
const siteDirectory = require('./site-directory.cjs');
const {createMetadataBrowser}=require('./metadata-browser.cjs');
const {script:CATALOG_SCRIPT}=require('./catalog-adapters.cjs');
const { MediaCatalog, preferWeb, mediaKind } = require('./media-catalog.cjs');
const AGENT = fs.readFileSync(path.join(__dirname, 'player-agent.js'), 'utf8');
const MEDIA_SCAN = fs.readFileSync(path.join(__dirname, 'media-scan.js'), 'utf8');
const PLAYER_URL = policy.APP_ORIGIN + '/player.html';
const SMOKE = !app.isPackaged && process.argv.includes('--smoke-test');
const PACKAGE_CHECK = process.argv.includes('--verify-package');
const shells = new Map();
const metadataControls = new Map();
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
function installAssets(ses) {
    const assets = new Map(['index.html','shell.css','shell.js','player.html','player.css','player.js','app-icon.svg']
        .map(name => ['/' + name, path.join(__dirname, '..', 'ui', name)]));
    const bundledHls = path.join(__dirname, '..', 'ui', 'hls.min.js');
    assets.set('/hls.min.js', fs.existsSync(bundledHls) ? bundledHls : path.join(__dirname, '../../static/vendor/hls-1.5.18.min.js'));
    ses.protocol.handle('tw-app', request => {
        const url = new URL(request.url);
        if (url.host !== 'desktop' || !assets.has(url.pathname)) return new Response('Not found', { status: 404 });
        return net.fetch(pathToFileURL(assets.get(url.pathname)).href);
    });
}

async function createDesktop({ server = policy.SERVER, testSource = '', visible = true } = {}) {
    if (!SMOKE && server !== policy.SERVER) throw new Error('Untrusted server');
    const win = new BrowserWindow({ title: '一起看 · Windows', width: 1360, height: 850, minWidth: 980, minHeight: 680,
        backgroundColor: '#111020', show: visible, autoHideMenuBar: true, icon: path.join(__dirname, '../assets/app.ico'),
        webPreferences: securePreferences({ preload: path.join(__dirname, 'preload.cjs') }) });
    win.setMenu(null);
    // Retain host rights when returning to setup in this window session. Never
    // place the capability in invitations, renderers or source-site views.
    const ownedRooms = new Map();
    let video = null, roomView = null, discoveryView = null, current = null, generation = 0, timer = null;
    let browsing = false, cinema = false, pendingEpisode = null, selectionFailed = false;
    let videoGeneration = 0;
    let selected = null, playerSession = 0, full = false, crop = false, searchingSince = 0;
    let micApproved = false, switching = false;
    let builtin = null, scanning = null, lastScan = 0, lastOriginalPause = 0, sourcePage = '';
    let draft = null, managed = null, finderMode = 'catalog', selecting = false;
    let toolsExpanded = false;
    // Keep search context and the most recent original-site page, not a growing
    // collection of background tabs. Login state stays in videoPartition.
    const finderViews = new Map();
    const parkedFinders = new WeakSet();
    let finderGeneration = 0;
    const catalog = new MediaCatalog(), requests = new Map();
    const activeVideo = () => builtin || video;
    const status = data => { if (!win.isDestroyed()) win.webContents.send('desktop:status', typeof data === 'string' ? { message: data } : data); };
    const roomTrusted = wc => !!current && wc === roomView?.webContents && policy.isRoomUrl(wc.getURL(), current.room, server);
    const sourceAllowed = url => !!policy.publicHttps(url) || (SMOKE && testSource && typeof url === 'string' && url.startsWith(testSource));
    const roomPartition = session.fromPartition(SMOKE ? `room-test-${win.id}` : 'persist:tw-room');
    const videoPartition = session.fromPartition(SMOKE ? `video-test-${win.id}` : 'persist:tw-video');
    const metadataBrowser=createMetadataBrowser(win,videoPartition,{hidden:SMOKE});
    win.on('close',()=>metadataBrowser.cancelAll());
    // No source-site cookies, login state, preload or IPC in the independent player.
    const playerPartition = session.fromPartition(`player-${win.id}-${crypto.randomBytes(6).toString('hex')}`);
    installAssets(playerPartition);
    const playerFullscreen = (wc, permission) => permission === 'fullscreen' && wc === builtin?.webContents && wc.getURL() === PLAYER_URL;
    playerPartition.setPermissionCheckHandler(playerFullscreen);
    playerPartition.setPermissionRequestHandler((wc, permission, callback) => callback(playerFullscreen(wc, permission)));
    playerPartition.webRequest.onBeforeRequest((details, callback) => callback({ cancel:
        !(details.url.startsWith(policy.APP_ORIGIN + '/') || policy.publicHttps(details.url) || details.url.startsWith('blob:tw-app:')) }));
    playerPartition.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };
        for (const name of Object.keys(headers)) if (/^(cookie|authorization|proxy-authorization)$/i.test(name)) delete headers[name];
        callback({ requestHeaders: headers });
    });
    playerPartition.on('will-download', event => event.preventDefault());

    function reportMedia(message) { status({ candidates: catalog.summaries(), builtin: !!builtin, ...(message ? { message } : {}) }); }
    function closeBuiltin() {
        if (!builtin) return;
        const old = builtin; builtin = null; selected = null; videoGeneration++;
        win.contentView.removeChildView(old);
        if (!old.webContents.isDestroyed()) old.webContents.close();
        if (video && !video.webContents.isDestroyed()) video.webContents.setAudioMuted(false);
        reportMedia();
    }
    function resetMedia() {
        catalog.reset(); requests.clear(); lastScan = 0;
        // A user-supplied media URL need not render as an HTML document first.
        if (mediaKind(sourcePage)) catalog.add(sourcePage, sourcePage);
        reportMedia();
    }
    // Observe only requests already made by this source view. No crawler, header
    // copying, token forwarding or main-process proxy is involved.
    videoPartition.webRequest.onBeforeRequest((details, callback) => {
        if (details.webContentsId === video?.webContents.id && requests.size < 512) requests.set(details.id, videoGeneration);
        callback({});
    });
    videoPartition.webRequest.onResponseStarted(details => {
        if (!video || details.webContentsId !== video.webContents.id || requests.get(details.id) !== videoGeneration
            || ![200, 206].includes(details.statusCode)) return;
        const type = Object.entries(details.responseHeaders || {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
        if (catalog.add(details.url, sourcePage, Array.isArray(type) ? type[0] : type)) reportMedia();
    });
    videoPartition.webRequest.onCompleted(details => requests.delete(details.id));
    videoPartition.webRequest.onErrorOccurred(details => requests.delete(details.id));

    function scanMedia() {
        if (scanning) return scanning;
        if (!video || pendingEpisode || selectionFailed) return Promise.resolve(false);
        lastScan = Date.now();
        scanning = collectMedia().catch(() => false).finally(() => { scanning = null; });
        return scanning;
    }
    async function collectMedia() {
        const epoch = videoGeneration, wc = video.webContents;
        try {
            if (preferWeb(sourcePage)) catalog.block('该平台需保留原网页登录与播放，不转移会员或受保护视频。');
            else {
                const results = await Promise.all(wc.mainFrame.framesInSubtree.slice(0, 32).map(async frame => {
                    try {
                        if (!sourceAllowed(frame.url) && frame.url !== 'about:blank') return null;
                        const data = await timeout(frame.executeJavaScript(MEDIA_SCAN));
                        return { data, page: frame.url === 'about:blank' ? wc.getURL() : frame.url };
                    } catch { return null; }
                }));
                if (epoch !== videoGeneration || wc !== video?.webContents) return false;
                for (const result of results.filter(Boolean)) {
                    if (result.data?.protected || preferWeb(result.page)) { catalog.block(); break; }
                    for (const item of (result.data?.candidates || []).slice(0, 200)) catalog.add(item.url, result.page, '', item);
                }
            }
            if (catalog.protected && builtin) { closeBuiltin(); layout(); }
            reportMedia(); return true;
        } catch { return false; }
    }
    async function openBuiltin(id) {
        if (!await scanMedia()) return { ok: false, error: '页面仍在识别或选集，请稍后重试。' };
        const item = catalog.get(id);
        if (!item) return { ok: false, error: catalog.reason || '候选已过期，请重新识别。' };
        closeBuiltin();
        const sourceEpoch = videoGeneration;
        await focusPlayer(false);
        if (sourceEpoch !== videoGeneration || !video || !current || !catalog.get(id)) return { ok: false, error: '播放页已切换，请重新选择视频。' };
        selected = null; videoGeneration++;
        const epoch = videoGeneration;
        builtin = new WebContentsView({ webPreferences: securePreferences({ session: playerPartition, backgroundThrottling: false }) });
        const view = builtin, wc = view.webContents;
        wc.on('will-navigate', event => event.preventDefault());
        wc.on('will-redirect', event => event.preventDefault());
        wc.setWindowOpenHandler(() => ({ action: 'deny' }));
        wc.on('before-input-event', keyHandler);
        wc.on('enter-html-full-screen', () => { full = true; win.setFullScreen(true); layout(); });
        wc.on('leave-html-full-screen', () => { full = false; win.setFullScreen(false); layout(); });
        wc.on('render-process-gone', () => { if (builtin === view) { closeBuiltin(); layout(); status('内置播放器已退出，已返回原网页。'); } });
        win.contentView.addChildView(view); browsing = false;
        video.webContents.setAudioMuted(true); pauseOriginal().catch(() => {}); layout();
        try {
            await wc.loadURL(PLAYER_URL);
            if (epoch !== videoGeneration || builtin !== view) return { ok: false, error: '播放页已切换。' };
            await wc.executeJavaScript(`window.__twBuiltin.load(${JSON.stringify({ url: item.url, kind: item.kind, position: item.position })})`);
            reportMedia('内置播放已打开，加载后点击播放。原网页已暂停，房间保持连接。');
            return { ok: true };
        } catch {
            if (builtin === view) { closeBuiltin(); layout(); }
            return { ok: false, error: '内置播放器未能打开，请保留原网页播放。' };
        }
    }
    async function pauseOriginal() {
        if (!video || video.webContents.isDestroyed()) return;
        await Promise.all(video.webContents.mainFrame.framesInSubtree.slice(0, 32).map(frame =>
            timeout(frame.executeJavaScript("document.querySelectorAll('video,audio').forEach(v=>v.pause())")).catch(() => {})));
    }

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
        if (win.isDestroyed()) return;
        status({advanced:toolsExpanded,browsing,cinema});
        const [width, height] = win.getContentSize();
        if (!video || !roomView) {
            const top = finderMode === 'catalog' ? 72 : 200;
            layoutFinder({x:0,y:top,width,height:Math.max(1,height-top)}, browsing);
            return;
        }
        const bounds = policy.panelBounds(width, height, full, toolsExpanded);
        video.setBounds(bounds.video); roomView.setBounds(bounds.room);
        if (builtin) { builtin.setBounds(bounds.video); builtin.setVisible(!browsing || full); }
        layoutFinder(bounds.video, browsing && !full);
        video.setVisible(!builtin && (!browsing || full));
        roomView.setVisible(!full);
    }
    function layoutFinder(bounds, visible) {
        if (!discoveryView || discoveryView.webContents.isDestroyed()) return;
        discoveryView.setBounds(bounds);
        if (visible) {
            parkedFinders.delete(discoveryView);
            discoveryView.setVisible(true);
            discoveryView.webContents.setAudioMuted(false);
        } else parkFinder(discoveryView).catch(() => {});
    }
    function keyHandler(_event, input) {
        if (input.type !== 'keyDown') return;
        if (input.key === 'F11') { _event.preventDefault(); toggleFullscreen(); }
        else if (input.key === 'Escape' && full) { _event.preventDefault(); toggleFullscreen(false); }
        else if (input.key === 'Escape' && toolsExpanded) { _event.preventDefault(); toolsExpanded=false; layout(); }
        else if (input.key.toLowerCase() === 'z' && full && input.control) { _event.preventDefault(); crop = !crop; focusPlayer(full); }
        else if (input.key === 'BrowserBack' || (input.key === 'ArrowLeft' && input.alt)) { _event.preventDefault(); goBack().catch(() => {}); }
    }
    async function focusPlayer(enabled) {
        if (builtin && !builtin.webContents.isDestroyed()) {
            try { await builtin.webContents.executeJavaScript(`window.__twBuiltin?.fullscreen(${full},${crop})`); } catch {}
            return;
        }
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
        await focusPlayer(full || cinema);
        if (full) status('全屏：Esc / F11 返回，Ctrl+Z 切换完整画面和铺满裁边');
    }
    function closeViews(keepFinders = false) {
        keepFinders = keepFinders === true; // Window close passes an event, not a flag.
        toolsExpanded=false;
        ++finderGeneration; metadataBrowser.cancelAll();
        closeBuiltin(); sourcePage = ''; resetMedia();
        ++generation; clearTimeout(timer); timer = null; selected = null; current = null; micApproved = false;
        full = false;
        if (!win.isDestroyed()) win.setFullScreen(false);
        for (const view of new Set([video, roomView, ...(keepFinders ? [] : finderViews.values())])) if (view) {
            if (!win.isDestroyed()) win.contentView.removeChildView(view);
            if (!view.webContents.isDestroyed()) view.webContents.close();
        }
        if (keepFinders) { for (const view of finderViews.values()) parkFinder(view).catch(() => {}); }
        else { finderViews.clear(); discoveryView = null; }
        video = roomView = null;
        browsing = false; pendingEpisode = null; selectionFailed = false;
        draft = managed = null;
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
            wc.on('did-start-navigation', (_e, url, _inPlace, main) => {
                if (main) { closeBuiltin(); if (sourceAllowed(url)) sourcePage = url; videoGeneration++; selected = null; resetMedia(); layout(); }
            });
            wc.on('did-navigate', (_e, url) => {
                if (pendingEpisode && url !== pendingEpisode.page) { pendingEpisode = null; selectionFailed = true; }
                selected = null; searchingSince = Date.now(); status({ source: url, message: '正在识别播放器；请在网页中开始播放' });
            });
            wc.on('enter-html-full-screen', () => { full = true; win.setFullScreen(true); layout(); });
            wc.on('leave-html-full-screen', () => { full = false; win.setFullScreen(false); layout(); focusPlayer(cinema); });
        }
    }
    async function navigateVideo(url, selection = null) {
        if (!sourceAllowed(url) || !video) return { ok: false, error: '请输入公开的 HTTPS 链接' };
        toolsExpanded=false;
        closeBuiltin(); sourcePage = url; resetMedia();
        const navigation = ++videoGeneration;
        await toggleFullscreen(false);
        if (navigation !== videoGeneration || !video) return { ok: false, error: '播放页已切换' };
        selected = null; searchingSince = Date.now();
        browsing = false; selectionFailed = false;
        if (selection) cinema = true;
        pendingEpisode = ['cupfox', 'yhdmoe', 'kanju'].includes(selection?.source) ? { ...selection, at: Date.now() } : null;
        layout();
        video.webContents.loadURL(url).catch(() => {});
        return { ok: true };
    }
    async function programApi(route, method = 'GET', selection = null, owner = '') {
        const response = await net.fetch(server + route, {method, redirect:'error', credentials:'omit',
            signal:AbortSignal.timeout(12000), headers:{'Content-Type':'application/json', ...(owner ? {Authorization:'Bearer ' + owner} : {})},
            ...(selection ? {body:JSON.stringify({selection})} : {})});
        if (!response.ok) throw new Error(response.status === 404 ? '房间不存在、已过期，或服务器尚未更新到邀请选片版' : '房间选片失败，请重试或确认房主权限');
        const text = await response.text();
        if (text.length > 8192) throw new Error('房间返回内容无效');
        const data = JSON.parse(text);
        if (!policy.programTarget(data, server)) throw new Error('房间片源无效，未打开任何外部地址');
        return data;
    }
    async function chooseSource(url, selection = null) {
        if (selecting) return;
        const originalEntry = siteDirectory.siteForUrl(url);
        const entry = siteDirectory.siteHandoff(url, server) || (originalEntry?.url === url && originalEntry);
        if (entry) return showDiscovery('site:' + entry.id);
        const descriptor = policy.programSelection(url, server);
        if (!descriptor && policy.isKanju(url)) return showDiscovery('kanju');
        if (!current) {
            if (!descriptor) { status('请先选择具体集数；看剧 AI 请打开播放页后点“用当前页建房”。'); return; }
            if (!draft) {
                await parkFinder(discoveryView); browsing = false; layout();
                status({setup:true,pendingSource:url,message:'正在准备所选影片…'});
                return;
            }
            selecting = true;
            try {
                const result = await start({...draft, source:url});
                if (!result.ok) status(result.error);
            } finally { selecting = false; }
            return;
        }
        if (managed) {
            if (!managed.owner) return {ok:false,error:'由房主选片 / 换集；你会自动跟随，无需粘贴视频链接。'};
            if (!descriptor) return {ok:false,error:'此页面还没有可共享的集数标识，请从找片页选集。'};
            const authority = managed, roomId = current.room;
            try {
                const next = await programApi(`/api/watch-rooms/${roomId}/program`, 'PUT', descriptor, authority.owner);
                if (authority !== managed || current?.room !== roomId) return {ok:false,error:'操作已取消'};
                await followProgram(next);
                return {ok:true};
            } catch (e) { status(e.message); return {ok:false,error:e.message}; }
        }
        return navigateVideo(selection?.page || url, selection);
    }
    async function followProgram(value) {
        const target = policy.programTarget(value, server);
        if (!target || !managed || target.revision <= managed.revision) return;
        const authority = managed;
        // Claim the revision before awaiting: the HTTP reply and socket event
        // may arrive together. Only one navigation should win.
        authority.revision = target.revision;
        // Stop the old native socket before navigation. Late samples are also
        // rejected server-side by program_revision.
        await roomView.webContents.executeJavaScript('window.TogetherWatchMobile.receive({active:false})');
        if (managed !== authority || authority.revision !== target.revision) return;
        await navigateVideo(target.page, target);
        if (managed !== authority || authority.revision !== target.revision) return;
        selectionFailed = !target.exact;
        await roomView.webContents.executeJavaScript(`window.TogetherWatchMobile.applyProgram(${target.revision})`);
        status(target.exact ? '已打开房主所选集数，加载后自动接上房间进度。' : '已打开同一页面：请核对集数，再点“重连同步”。此来源未提供稳定集数标识。');
    }
    async function parkFinder(view) {
        if (!view || view.webContents.isDestroyed() || parkedFinders.has(view)) return;
        parkedFinders.add(view);
        view.setVisible(false);
        view.webContents.setAudioMuted(true);
        if (view === finderViews.get('catalog')) metadataBrowser.cancelAll();
        // Do not let hidden source pages keep playing while the user searches.
        await Promise.all(view.webContents.mainFrame.framesInSubtree.slice(0,32).map(frame =>
            timeout(frame.executeJavaScript('document.querySelectorAll("video,audio").forEach(media=>media.pause())')).catch(() => {})));
    }
    async function showDiscovery(mode = 'catalog') {
        toolsExpanded=false;
        const epoch = ++finderGeneration;
        await toggleFullscreen(false);
        if (epoch !== finderGeneration || win.isDestroyed()) return;
        const entry = mode.startsWith('site:') ? siteDirectory.siteById(mode.slice(5)) : null;
        if (mode.startsWith('site:') && !entry) { status('这个站点不在已核对的目录中'); return; }
        if (discoveryView && finderMode !== mode) {
            browsing = false;
            metadataBrowser.cancelAll();
            await parkFinder(discoveryView);
            if (epoch !== finderGeneration || win.isDestroyed()) return;
        }
        discoveryView = finderViews.get(mode) || null;
        if (discoveryView?.webContents.isDestroyed()) { finderViews.delete(mode); discoveryView = null; }
        // Evict the previous original site when opening a different one.
        if (mode !== 'catalog') for (const [key, view] of finderViews) if (key !== 'catalog' && key !== mode) {
            finderViews.delete(key);
            win.contentView.removeChildView(view);
            if (!view.webContents.isDestroyed()) view.webContents.close();
        }
        finderMode = mode;
        if (!discoveryView) {
            discoveryView = new WebContentsView({ webPreferences: securePreferences({ session: videoPartition,
                ...(mode==='catalog'?{preload:path.join(__dirname,'discovery-preload.cjs')}:{}) }) });
            finderViews.set(mode, discoveryView);
            const wc = discoveryView.webContents;
            if(mode==='catalog') {
                let metadataNavigation=0;
                const control={
                    trusted:event=>browsing && discoveryView?.webContents===wc && !wc.isDestroyed() && !!event.senderFrame && event.sender===wc && event.senderFrame===wc.mainFrame && policy.isDiscoveryUrl(event.senderFrame.url,server),
                    request:async data=>{
                        if(!data || typeof data!=='object') return {status:'unavailable'};
                        const epoch=metadataNavigation, finderEpoch=finderGeneration;
                        let enabled;
                        try { enabled=await wc.executeJavaScript('Array.from(document.querySelectorAll("[data-live-source]")).map(n=>n.dataset.liveSource)'); }
                        catch { return {status:'unavailable'}; }
                        if(epoch!==metadataNavigation || finderEpoch!==finderGeneration || !browsing || !enabled.includes(data.payload?.source) || wc.isDestroyed() || discoveryView?.webContents!==wc || !policy.isDiscoveryUrl(wc.getURL(),server)) return {status:'unavailable'};
                        return metadataBrowser.run(data.id,data.kind,data.payload,data.interactive);
                    },
                    cancel:id=>{if(typeof id==='string')metadataBrowser.cancel(id);return true;},
                };
                metadataControls.set(wc.id,control);
                const id=wc.id;
                wc.on('destroyed',()=>{metadataControls.delete(id);metadataBrowser.cancelAll();});
                wc.on('did-start-navigation',(_e,_url,inPlace,isMainFrame)=>{if(isMainFrame && !inPlace){metadataNavigation++;metadataBrowser.cancelAll();}});
            }
            discoveryView.setBackgroundColor('#171423');
            win.contentView.addChildView(discoveryView);
            const view = discoveryView, approved = new Set();
            let asking = false;
            const allowed = url => entry ? siteDirectory.siteNavigation(entry, url, approved)
                : mode === 'kanju' ? policy.isKanju(url) : policy.isDiscoveryUrl(url, server);
            const requestNavigation = async url => {
                if (asking || !browsing || discoveryView !== view || !sourceAllowed(url)) return;
                asking = true;
                try {
                    const answer = await dialog.showMessageBox(win, {type:'question', title:'原站请求打开页面',
                        message:'是否在软件内打开这个页面？', detail:new URL(url).hostname + '\n原站可能正在跳转到播放、登录或广告页面。此确认不会把新域名加入自动搜片或邀请片源。',
                        buttons:['取消','打开'], defaultId:0, cancelId:0});
                    if (answer.response !== 1 || discoveryView !== view || wc.isDestroyed()) return;
                    approved.add(new URL(url).origin);
                    await wc.loadURL(url);
                } catch { status('页面打开失败，可返回目录换一个来源。'); }
                finally { asking = false; }
            };
            const navigate = (event, url) => {
                // Catalogue navigation must not become a third-party playback
                // URL or open a web room outside the native sync session.
                if (mode === 'catalog' && (url === server + '/#roomEntry' || url === server + '/')) {
                    event.preventDefault();
                    if (url.endsWith('#roomEntry')) action('settings'); else showDiscovery();
                    return;
                }
                if (allowed(url)) return;
                event.preventDefault();
                if (!browsing || discoveryView !== view) return;
                if (entry) { requestNavigation(url); return; }
                const selection = policy.playSelection(url, server);
                if (mode === 'catalog' && (selection || siteDirectory.siteHandoff(url, server) || sourceAllowed(url))) chooseSource(url, selection);
            };
            wc.on('will-navigate', navigate);
            wc.on('will-redirect', (event, url) => {
                if (allowed(url)) return;
                event.preventDefault();
                if (entry && browsing && discoveryView === view) status('原站自动跳到了未核对的域名，已暂停。可用“浏览器打开”自行查看；不会自动添加镜像站。');
            });
            wc.on('before-input-event', keyHandler);
            wc.on('will-attach-webview', event => event.preventDefault());
            wc.setWindowOpenHandler(({url}) => { if (entry) requestNavigation(url); return { action: 'deny' }; });
            wc.on('did-fail-load', (_e, code, _d, _u, main) => { if (browsing && discoveryView === view && main && code !== -3) status(entry ? '原站加载失败。可重试、在浏览器打开，或返回目录换来源；没有修改房间影片。' : '找片页加载失败，请检查服务器更新或网络'); });
            wc.loadURL(entry ? entry.url : mode === 'kanju' ? 'https://www.kanju.ai/' : server + '/discover').catch(() => {});
        }
        browsing = true; layout(); status({finderMode:mode, message:entry ? (['233dm','pkavi'].includes(entry.id)
            ? `${entry.name}：可返回找片页统一搜索、选集；也可在原站打开具体集数后点“用当前页建房”。`
            : `${entry.name}：在原站搜索；若实际出现登录或验证，请自行完成。尚未支持此站邀请自动选集。`) : mode === 'kanju' ? '看剧 AI 原站：搜索并打开播放页后，用当前页建房 / 换片。登录、验证码在原站完成。' : current ? '房主选集后，朋友自动跟随；原站动态选集请核对版本。' : '先搜索 → 详情 / 选集 → 点击集数再创建房间，现在还没有建房。'});
    }

    async function pickDirectoryPage() {
        const view = discoveryView, wc = view?.webContents;
        if (!wc || selecting) return;
        const url = wc.getURL();
        if (policy.programSelection(url, server)) return chooseSource(url);
        if (!finderMode.startsWith('site:') || !sourceAllowed(url)) return {ok:false,error:'请先打开具体播放页。'};
        if (managed) return {ok:false,error:'此站尚无邀请自动选集适配，不能替换当前共享片源。可留在原站浏览，或返回首页建立兼容房间。'};
        selecting = true;
        try {
            // Only inspect presence, never cookies or stream URLs. Ads can also
            // contain video: the user still has to confirm the actual episode.
            const found = await Promise.all(wc.mainFrame.framesInSubtree.slice(0,32).map(frame =>
                timeout(frame.executeJavaScript('!!document.querySelector("video")')).catch(() => false)));
            if (!found.some(Boolean)) return {ok:false,error:'还未找到视频。请在原站完成验证、选择剧集并开始播放，再试一次。'};
            const answer = await dialog.showMessageBox(win, {type:'question', title:'使用兼容房间',
                message:'确认当前播放的是想看的那一集？', detail:'该站暂不支持邀请自动选集。兼容房间可尝试同步播放器，但朋友仍需各自打开同一播放页并完成原站验证。账号和验证凭据不会共享。',
                buttons:['暂不建房','继续'], defaultId:0, cancelId:0});
            if (answer.response !== 1 || discoveryView !== view || wc.isDestroyed() || wc.getURL() !== url) return;
            if (!current && !draft) {
                await parkFinder(discoveryView); browsing=false; layout();
                status({setup:true,pendingSource:url,message:'影片已确认，正在准备兼容房间…'});
                return {ok:true,pending:true};
            }
            return current ? navigateVideo(url) : start({...draft, source:url});
        } finally { selecting = false; }
    }
    async function start(data) {
        if (switching) return { ok: false, error: '正在打开，请稍候' };
        switching = true;
        try { return await startImpl(data); }
        catch { return {ok:false,error:'打开失败，请检查网络或服务器版本后重试'}; }
        finally { switching = false; }
    }
    async function startImpl(data) {
        if (!data || data.consent !== true || typeof data.nickname !== 'string' || !data.nickname.trim()) return { ok: false, error: '请填写昵称并同意使用说明' };
        if (!data.room && !data.source) {
            closeViews(true); draft = {nickname:data.nickname,consent:true};
            await showDiscovery(); status({finder:true});
            return {ok:true,browsing:true};
        }
        let initialSource = data.source || server + '/discover';
        const descriptor = policy.programSelection(initialSource, server);
        let roomProgram = null;
        const requestEpoch = generation;
        const requestedRoom = data.room ? policy.roomFrom(data.room, server) : '';
        if (data.room && !requestedRoom) return {ok:false,error:'房间号或邀请链接无效'};
        // Only known descriptors are shared; arbitrary signed media URLs remain
        // local legacy playback and are never placed into an invitation.
        try {
            if (requestedRoom && /^[a-f0-9]{24}$/.test(requestedRoom)) roomProgram = await programApi(`/api/watch-rooms/${requestedRoom}/program`);
            else if (!requestedRoom && descriptor) roomProgram = await programApi('/api/watch-rooms', 'POST', descriptor);
        } catch (e) { return {ok:false,error:e.message}; }
        if (requestEpoch !== generation) return {ok:false,error:'操作已取消'};
        if (roomProgram) initialSource = policy.programTarget(roomProgram, server).page;
        if (!sourceAllowed(initialSource) && !policy.isDiscoveryUrl(initialSource, server)) return { ok: false, error: '请填写公开的 HTTPS 视频页或视频直链' };
        const id = requestedRoom || roomProgram?.room || 'legacy-' + crypto.randomBytes(12).toString('hex');
        if (!id) return { ok: false, error: '房间号或邀请链接无效' };
        if (roomProgram?.owner) {
            ownedRooms.set(server + '/' + id, roomProgram.owner);
            while (ownedRooms.size > 100) ownedRooms.delete(ownedRooms.keys().next().value);
        }
        closeViews(true);
        current = { room: id, nickname: data.nickname.trim().slice(0, 32) };
        managed = roomProgram ? {owner:roomProgram.owner || ownedRooms.get(server + '/' + id) || '', revision:roomProgram.revision} : null;
        sourcePage = initialSource; resetMedia();
        const epoch = generation;
        video = new WebContentsView({ webPreferences: securePreferences({ session: videoPartition, backgroundThrottling: false }) });
        roomView = new WebContentsView({ webPreferences: securePreferences({ session: roomPartition, backgroundThrottling: false }) });
        video.setBackgroundColor('#000000'); roomView.setBackgroundColor('#171427');
        for (const view of [video, roomView]) win.contentView.addChildView(view);
        setupView(video, false); setupView(roomView, true); layout();
        searchingSince = Date.now();
        if (policy.isDiscoveryUrl(initialSource, server)) await showDiscovery();
        else video.webContents.loadURL(initialSource).catch(() => {});
        const target = roomProgram && policy.programTarget(roomProgram, server);
        if (target && !target.exact) selectionFailed = true;
        if (['cupfox','yhdmoe','kanju'].includes(target?.source)) pendingEpisode = {...target, at:Date.now()};
        try {
            await roomView.webContents.loadURL(server + '/');
            if (epoch !== generation || new URL(roomView.webContents.getURL()).origin !== server) throw new Error('navigation changed');
            // The user explicitly accepted the same site's terms in the shell.
            await roomView.webContents.executeJavaScript(`localStorage.setItem('tw_username',${JSON.stringify(current.nickname)});localStorage.setItem('tw_legal_notice_version','2026-07-28');true`);
            await roomView.webContents.loadURL(server + '/mobile-room/' + encodeURIComponent(id));
            if (epoch !== generation) throw new Error('session changed');
            const ready = await roomView.webContents.executeJavaScript('!!window.TogetherWatchMobile');
            if (!ready) throw new Error('mobile bridge unavailable');
            if (managed) await roomView.webContents.executeJavaScript(`window.TogetherWatchMobile.applyProgram(${managed.revision})`);
            timer = setTimeout(() => tick(epoch), 200);
            status({joined:id, source:initialSource, host:!managed || !!managed.owner,
                message:target && !target.exact ? '已打开同一页面：请核对集数，再点“重连同步”。此来源未提供稳定集数标识。' : managed ? '已打开房间所选播放页，加载后自动同步进度。' : '兼容房间：该链接尚不支持自动带出片源。'});
            return { ok: true, room: id };
        } catch {
            if (epoch === generation) closeViews(true);
            return { ok: false, error: '无法连接新版房间页面，请确认网站已更新并检查网络' };
        }
    }
    async function tick(epoch) {
        if (epoch !== generation || !current || !video || !roomTrusted(roomView.webContents)) return;
        const videoEpoch = videoGeneration;
        const stillCurrent = () => epoch === generation && videoEpoch === videoGeneration;
        try {
            if (managed) {
                const program = await timeout(roomView.webContents.executeJavaScript('window.TogetherWatchMobile.program()'));
                if (program?.revision > managed.revision) { await followProgram(program); return; }
            }
            const wc = activeVideo().webContents;
            if (builtin && Date.now() - lastOriginalPause > 2000) {
                lastOriginalPause = Date.now(); pauseOriginal().catch(() => {});
            }
            // Slow third-party frames must not stall the playback sync loop.
            if (Date.now() - lastScan > 3000 && !builtin) scanMedia();
            if (!stillCurrent()) return;
            if (pendingEpisode) {
                const request = pendingEpisode;
                const actual = request.source==='kanju' ? policy.programSelection(wc.getURL(),server) : null;
                const wanted = request.source==='kanju' ? policy.programSelection(request.page,server) : null;
                const loaded = !wc.isLoadingMainFrame() && (request.source==='kanju'
                    ? actual?.source==='kanju' && actual.item===wanted?.item && actual.episode===wanted?.episode
                    : wc.getURL() === request.page);
                const clicked = loaded && (request.source==='kanju'
                    ? await timeout(wc.executeJavaScriptInIsolatedWorld(991,[{code:CATALOG_SCRIPT+';TogetherWatchCatalogAdapters.episodeReady(document,'+JSON.stringify(request.episode)+')'}]))
                    : await timeout(wc.executeJavaScript(`(${function(source, episode) {
                    const sakura = source === 'yhdmoe';
                    const el = Array.from(document.querySelectorAll(sakura ? 'a.my-episode[play_ep]' : 'span.play-btn[ep_slug]')).find(n => n.getAttribute(sakura ? 'play_ep' : 'ep_slug') === episode);
                    if (!el) return false;
                    const active = sakura ? 'disabled' : 'on';
                    if (!el.classList.contains(active)) el.click();
                    return el.classList.contains(active);
                }.toString()})(${JSON.stringify(request.source)},${JSON.stringify(request.episode)})`)));
                if (!stillCurrent()) return;
                if (pendingEpisode === request && clicked) pendingEpisode = null;
                else if (pendingEpisode === request && Date.now() - request.at > 20000) {
                    pendingEpisode = null; selectionFailed = true;
                    await wc.executeJavaScript("document.querySelectorAll('video').forEach(v=>v.pause())");
                    status('没有确认所选集数，已停止自动接入。请用网页选集，再点“重连同步”。');
                }
            }
            let raw;
            if (!pendingEpisode && !selectionFailed && selected && !selected.frame.isDestroyed()) raw = await timeout(selected.frame.executeJavaScript('window.__twDesktopPlayer?.sample()'));
            if (!stillCurrent()) return;
            if (!raw && !pendingEpisode && !selectionFailed) {
                selected = null;
                const frames = wc.mainFrame.framesInSubtree.slice(0, 32);
                const candidates = await Promise.all(frames.map(async frame => {
                    try {
                        if (!(builtin && wc === builtin.webContents && frame.url === PLAYER_URL) && !sourceAllowed(frame.url) && frame.url !== 'about:blank') return null;
                        const sample = await timeout(frame.executeJavaScript(AGENT + ';window.__twDesktopPlayer.sample()'));
                        return sample && sample.area > 0 ? { frame, raw: sample } : null;
                    } catch { return null; }
                }));
                const best = candidates.filter(Boolean).sort((a,b) => b.raw.area - a.raw.area)[0];
                if (!stillCurrent()) return;
                if (best) { selected = { frame: best.frame, serial: best.raw.serial }; raw = best.raw; playerSession++; if (full || cinema) await focusPlayer(true); }
            }
            if (!stillCurrent()) return;
            if (!raw || !selected) {
                await timeout(roomView.webContents.executeJavaScript("window.TogetherWatchMobile.receive({active:false});window.TogetherWatchMobile.drain()"));
                if (!browsing && !selectionFailed && !pendingEpisode && Date.now() - searchingSince > 10000) status('尚未找到 HTML5 播放器：请先点网页播放；部分 DRM 或定制播放器不兼容');
            } else {
                if (raw.serial !== selected.serial) { selected.serial = raw.serial; playerSession++; }
                const sample = policy.timingSample(raw, playerSession);
                if (!sample) throw new Error('invalid player data');
                if (builtin) {
                    const playback = await timeout(wc.executeJavaScript('window.__twBuiltin?.state()'));
                    if (playback?.error) { sample.error = playback.error; sample.ready = false; sample.events = []; }
                }
                const reply = await timeout(roomView.webContents.executeJavaScript(`window.TogetherWatchMobile.receive(${JSON.stringify(sample)});window.TogetherWatchMobile.drain()`));
                if (!stillCurrent()) return;
                for (const value of (Array.isArray(reply?.commands) ? reply.commands : []).slice(0, 4)) {
                    if (!stillCurrent() || !selected) return;
                    const command = policy.playbackCommand(value, playerSession);
                    if (command) await timeout(selected.frame.executeJavaScript(`window.__twDesktopPlayer?.apply(${JSON.stringify(command)})`));
                }
                if (!browsing) status(sample.error || (full ? '全屏：Esc / F11 返回，Ctrl+Z 切换铺满' : builtin ? '内置播放 · 播放器已连接' : '网页播放 · 播放器已连接'));
            }
        } catch { if (stillCurrent()) { selected = null; status('播放页发生变化，正在重新连接播放器…'); } }
        finally { if (epoch === generation) timer = setTimeout(() => tick(epoch), selected ? 350 : 1200); }
    }
    async function catalogNavigation(method) {
        const wc = discoveryView?.webContents;
        if (finderMode !== 'catalog' || !wc || wc.isDestroyed() || !policy.isDiscoveryUrl(wc.getURL(), server)) return false;
        try { return await timeout(wc.executeJavaScript(`window.TogetherWatchCatalogNavigation?.${method}() === true`)); }
        catch { return false; }
    }
    async function returnToPlayback() {
        toolsExpanded=false;
        await parkFinder(discoveryView); browsing = false; layout();
        if (current) status({joined:current.room, source:sourcePage});
    }
    async function goBack() {
        if (switching || selecting) return;
        if (full) { await toggleFullscreen(false); return; }
        if (toolsExpanded) { toolsExpanded=false; layout(); return; }
        if (browsing && discoveryView) {
            if (finderMode === 'catalog') {
                if (await catalogNavigation('back')) return;
                if (current) await returnToPlayback();
                else status('已经在推荐首页；搜索或选择一部影片开始。');
            } else if (discoveryView.webContents.navigationHistory.canGoBack()) discoveryView.webContents.navigationHistory.goBack();
            else await showDiscovery();
            return;
        }
        if (builtin) { closeBuiltin(); layout(); status('已返回原网页；再点返回可回到选片位置。'); return; }
        if (video?.webContents.navigationHistory.canGoBack()) { video.webContents.navigationHistory.goBack(); return; }
        // Includes the confirmation form: cancel selection without losing the
        // already loaded results, open detail dialog or original-site history.
        await showDiscovery(finderMode);
        if (!current) status({finder:true});
    }
    async function action(value) {
        if (value?.type === 'tools' && current && typeof value.expanded === 'boolean') { toolsExpanded=value.expanded; layout(); return; }
        if (value && typeof value === 'object' && value.type === 'source') return chooseSource(value.source, policy.playSelection(value.source,server));
        if (value === 'terms' || value === 'privacy') { await shell.openExternal(policy.SERVER + '/' + value); return; }
        if (value === 'settings' || value === 'leave') {
            if (current) {
                const room=current;
                const answer=await dialog.showMessageBox(win,{type:'question',message:'离开当前房间？',detail:'将断开本机的同步和通话。之后可以输入邀请加入其他房间；刚才的搜索仍会保留。',buttons:['继续观看','离开房间'],defaultId:0,cancelId:0});
                if(answer.response!==1 || current!==room)return;
            }
            closeViews(true);
            if (value === 'leave') {await showDiscovery();status({finder:true,message:'已离开房间，选好影片即可再次开始。'});}
            else status({setup:true,message:'粘贴朋友的邀请；自己的影片直接在首页选择。'});
            return;
        }
        if (value === 'back' || value === 'finder-back') return goBack();
        if (value === 'home') { await showDiscovery(); await catalogNavigation('home'); if (!current) status({finder:true}); return; }
        if (value === 'kanju' && (draft || current || browsing)) return showDiscovery('kanju');
        if (['finder-reload','finder-browser'].includes(value) && discoveryView) {
            const wc = discoveryView.webContents;
            if (value === 'finder-reload') wc.reload();
            if (value === 'finder-browser' && policy.publicHttps(wc.getURL())) await shell.openExternal(wc.getURL());
            return;
        }
        if (value === 'pick-current' && discoveryView) {
            const result = finderMode.startsWith('site:') ? await pickDirectoryPage() : await chooseSource(discoveryView.webContents.getURL());
            if (result?.error) status(result.error);
            return result;
        }
        if (value === 'discover' && (draft || browsing)) return showDiscovery();
        if (!current) return;
        if (value?.type === 'play-media') return openBuiltin(value.id);
        if (value === 'scan-media') {
            const ok = await scanMedia();
            reportMedia(!ok ? '正在识别，请稍后再试。' : catalog.reason || (catalog.items.size ? '请选择候选，再点“用内置播放器”。短片段可能是广告，请核对时长。' : '没有识别到可转移的视频。先在网页开始播放；失效源、blob、DASH 或受保护内容可能不支持。'));
        }
        else if (value === 'original') { await parkFinder(discoveryView); closeBuiltin(); browsing = false; layout(); status('已返回原网页，请按需点击播放。'); }
        else if (value === 'discover') await showDiscovery();
        else if (value === 'return-video') await returnToPlayback();
        else if (value === 'cinema') { await parkFinder(discoveryView); browsing = false; cinema = !cinema; layout(); await focusPlayer(full || cinema); status(cinema ? '影院模式：只显示视频，可用原生控制条' : '网页模式：可在原站登录、选集或调整设置'); }
        else if (value === 'invite') { clipboard.writeText(`${server}/room/${encodeURIComponent(current.room)}`); status(managed ? '邀请已复制。朋友在新版 Windows 客户端粘贴即可打开同一片源并同步；不需要再填视频链接。' : '邀请已复制。此兼容房间尚未记录片源，朋友仍需打开同一集。'); }
        else if (value === 'copy-room') { clipboard.writeText(current.room); status('房间号已复制；朋友粘贴后点击加入，不要再单独创建新房间。'); }
        else if (value === 'fullscreen') await toggleFullscreen();
        else if (value === 'detect') { await focusPlayer(false); selected = null; selectionFailed = false; pendingEpisode = null; searchingSince = Date.now(); status('正在重新识别播放器'); }
        else if (value === 'reload') { if (browsing && discoveryView) discoveryView.webContents.reload(); else { closeBuiltin(); selected = null; video.webContents.reload(); layout(); } }
    }
    const senderIsShell = event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame
        && event.senderFrame.url === policy.APP_ORIGIN + '/index.html';
    // Source views have no preload. The first-party catalogue has a separate,
    // metadata-only bridge; it cannot invoke shell/player actions.
    shells.set(win.webContents.id, { senderIsShell, start, action });
    const shellId = win.webContents.id;
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('before-input-event', keyHandler);
    win.on('resize', layout);
    win.on('leave-full-screen', () => { full = false; focusPlayer(cinema); layout(); });
    win.on('close', closeViews);
    win.on('closed', () => shells.delete(shellId));
    const suspend = () => { if (activeVideo()) activeVideo().webContents.setAudioMuted(true); if (roomTrusted(roomView?.webContents)) roomView.webContents.executeJavaScript('window.TogetherWatchMobile.suspend()').catch(() => {}); };
    const resume = () => { if (activeVideo()) activeVideo().webContents.setAudioMuted(false); };
    powerMonitor.on('suspend', suspend); powerMonitor.on('resume', resume);
    win.on('closed', () => { powerMonitor.removeListener('suspend', suspend); powerMonitor.removeListener('resume', resume); });
    await win.loadURL(policy.APP_ORIGIN + '/index.html');
    if (!PACKAGE_CHECK) { await showDiscovery(); status({finder:true}); }
    return { win, start, action, close: () => win.close(), state: () => ({ video, builtin, mediaSession: playerPartition, roomView, discoveryView, browsing, cinema, selected, full, current }), toggleFullscreen };
}

app.whenReady().then(async () => {
    ipcMain.handle('desktop:metadata',(event,data)=>{
        const control=metadataControls.get(event.sender.id);
        return control?.trusted(event)?control.request(data):{status:'unavailable'};
    });
    ipcMain.handle('desktop:metadata-cancel',(event,id)=>{
        const control=metadataControls.get(event.sender.id);
        return control?.trusted(event)?control.cancel(id):false;
    });
    for (const command of ['start', 'action']) ipcMain.handle('desktop:' + command, (event, data) => {
        const control = shells.get(event.sender.id);
        return control?.senderIsShell(event) ? control[command](data) : { ok: false };
    });
    installAssets(session.defaultSession);
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
            const iconReady = await client.win.webContents.executeJavaScript('document.querySelector(".brand img")?.naturalWidth > 0');
            if (!iconReady || !fs.existsSync(path.join(__dirname, '../assets/app.ico'))) throw new Error('packaged app icon unavailable');
            const player = new WebContentsView({ webPreferences: securePreferences({session:client.state().mediaSession}) });
            await player.webContents.loadURL(PLAYER_URL);
            const playerReady = await player.webContents.executeJavaScript('typeof Hls === "function" && typeof window.__twBuiltin?.load === "function" && typeof window.desktop === "undefined"');
            player.webContents.close();
            if (!playerReady) throw new Error('packaged independent player or HLS library unavailable');
            const rules=require('./catalog-adapters.cjs');
            if (!rules.api.request('search',{source:'pkavi',q:'test'}) || !rules.script.includes('readDocument')) throw new Error('packaged catalogue rules unavailable');
            const discovery=new WebContentsView({webPreferences:securePreferences({session:client.state().mediaSession,preload:path.join(__dirname,'discovery-preload.cjs')})});
            await discovery.webContents.loadURL(PLAYER_URL);
            const bridgeReady=await discovery.webContents.executeJavaScript('typeof window.twSourceMetadata?.request === "function" && typeof require === "undefined"');
            const rejected=await discovery.webContents.executeJavaScript('window.twSourceMetadata.request("package-test","search",{source:"pkavi",q:"test"})');
            discovery.webContents.close();
            if(!bridgeReady || rejected.status!=='unavailable') throw new Error('packaged metadata bridge or sender guard unavailable');
            console.log('PACKAGE CHECK PASS: shell, branded icon, preload, independent player, HLS, catalogue rules and metadata IPC sender guard.');
            app.exit(0);
        } catch (error) { console.error(error); app.exit(1); }
    } else await createDesktop();
});
app.on('window-all-closed', () => { if (!SMOKE) app.quit(); });
