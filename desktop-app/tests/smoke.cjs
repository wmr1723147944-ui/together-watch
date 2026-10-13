'use strict';
// Developer-only integration check. Never included in the packaged application.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, '.review-artifacts/desktop-smoke');
const media = process.env.TW_SMOKE_MEDIA || path.join(output, 'sintel.mp4');
async function until(label, fn, ms = 20000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await fn()) return; await delay(150); }
    throw new Error('Timed out: ' + label);
}
async function listen(handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return server;
}
async function continuousPlayback(client, ms) {
    const frame = client.state().selected.frame;
    const start = await frame.executeJavaScript('document.querySelector("video").currentTime');
    const end = Date.now() + ms;
    while (Date.now() < end) {
        assert.equal(await frame.executeJavaScript('document.querySelector("video").paused'), false,
            'single-person playback must not be paused by a stale room echo');
        await delay(250);
    }
    assert.ok(await frame.executeJavaScript(`document.querySelector("video").currentTime > ${start + ms / 2000}`),
        'the video must advance, not just report an unpaused state');
}
async function inputKey(client, key, code, windowsVirtualKeyCode) {
    const debug = client.state().video.webContents.debugger;
    if (!debug.isAttached()) debug.attach('1.3');
    await debug.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    await client.state().selected.frame.executeJavaScript('document.getElementById("seek").focus()');
    await debug.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
    await debug.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    // Keep focus emulation until close: detaching it pauses a hidden Chromium
    // window's media, which is unrelated to Together Watch synchronization.
}
exports.run = async createDesktop => {
    assert.ok(fs.existsSync(media), 'Set TW_SMOKE_MEDIA to a local, seekable MP4 test fixture.');
    fs.mkdirSync(output, { recursive: true });
    let frameOrigin;
    const fixture = (req, res) => {
        if (req.url === '/sample.mp4') {
            const size = fs.statSync(media).size;
            const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
            const start = range ? Number(range[1]) : 0;
            const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
            res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
                'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
            fs.createReadStream(media, { start, end }).pipe(res); return;
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        if (req.url === '/outer') {
            res.end(`<body style="margin:0;background:#234;color:white">External player fixture<iframe src="${frameOrigin}/player" style="position:absolute;left:24px;top:40px;width:calc(100% - 48px);height:calc(100% - 64px);border:0"></iframe></body>`); return;
        }
        res.end(`<!doctype html><style>body{margin:0;background:#080810}video{width:100%;height:90vh}button{position:fixed;left:10px;top:10px;z-index:5;width:140px;height:36px}</style>
            <video controls muted preload="auto" src="/sample.mp4"></video><button id="seek">Pause at 12s</button>
            <script>window.testClicks=0;document.getElementById('seek').onclick=()=>{window.testClicks++;const v=document.querySelector('video');v.pause();v.currentTime=12;};document.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();document.getElementById('seek').click();}else if(e.key==='x'||e.key==='p'){e.preventDefault();const v=document.querySelector('video');if(e.key==='x')v.playbackRate=1.5;v.play();}});</script>`);
    };
    const inner = await listen(fixture);
    frameOrigin = `http://127.0.0.1:${inner.address().port}`;
    const outer = await listen(fixture);
    const source = `http://127.0.0.1:${outer.address().port}/outer`;
    const reserve = await listen((_req, res) => res.end());
    const port = reserve.address().port;
    await new Promise(resolve => reserve.close(resolve));
    const server = `http://127.0.0.1:${port}`;
    const python = process.env.TW_SMOKE_PYTHON || 'python';
    // Local-only fixture route/state. Never relax production URL validation.
    const backend = spawn(python, ['-u', '-c', `
from app import app, socketio, ensure_room_state, LEGAL_NOTICE_VERSION
from flask import send_file
@app.get('/test-media.mp4')
def test_media():
    return send_file(${JSON.stringify(media)}, mimetype='video/mp4', conditional=True)
@app.get('/test-seed')
def test_seed():
    url = '${server}/test-media.mp4'
    source = dict(mode='direct_media', provider_key='direct', provider_name='Local fixture', media_id=None, title='Test video', page_url=url, media_url=url, requires_companion=False)
    ensure_room_state('mixed-smoke').update(video_src=url, media_source=source)
    return dict(legal_version=LEGAL_NOTICE_VERSION)
socketio.run(app, host='127.0.0.1', port=${port}, debug=False, allow_unsafe_werkzeug=True)
`],
        { cwd: root, windowsHide: true, env: { ...process.env, APP_ENV: 'development', SECRET_KEY: 'desktop-local-smoke-only',
            SERVICE_OPERATOR_NAME: 'Local test', COPYRIGHT_CONTACT_EMAIL: 'test@example.invalid' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let backendLog = ''; backend.stdout.on('data', data => backendLog = (backendLog + data).slice(-12000));
    backend.stderr.on('data', data => backendLog = (backendLog + data).slice(-12000));
    backend.on('error', error => { backendLog += error.message; });
    const clients = [];
    try {
        await until('local backend', async () => { try { return (await fetch(server + '/health')).ok; } catch { return false; } });
        if (process.env.TW_SMOKE_MIXED_ONLY === '1') {
            await require('./mixed-smoke.cjs').run({ createDesktop, server, source, output, until, inputKey });
            return;
        }
        for (const name of ['Alice', 'Bob']) {
            const client = await createDesktop({ server, testSource: 'http://127.0.0.1:', visible: false });
            clients.push(client);
            const shellWc = client.win.webContents;
            assert.equal(await shellWc.executeJavaScript('typeof window.desktop.start'), 'function');
            if (name === 'Alice') fs.writeFileSync(path.join(output, 'windows-setup.png'), (await shellWc.capturePage()).toPNG());
            const result = await shellWc.executeJavaScript(`window.desktop.start(${JSON.stringify({ nickname: name, room: 'desktop-smoke', source, consent: true })})`);
            assert.equal(result.ok, true, result.error);
            await shellWc.executeJavaScript("document.getElementById('setup').hidden=true;document.getElementById('tools').hidden=false;");
            const { video, roomView } = client.state();
            // These windows stay hidden to avoid stealing desktop focus.
            // Establish emulated focus before the first autoplay/seek command,
            // not halfway through its pending play() promise.
            video.webContents.debugger.attach('1.3');
            await video.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
            assert.equal(await video.webContents.executeJavaScript('typeof require'), 'undefined');
            assert.equal(await video.webContents.executeJavaScript('typeof window.desktop'), 'undefined');
            assert.equal(await roomView.webContents.executeJavaScript('typeof window.desktop'), 'undefined');
            await until(name + ' cross-origin player', () => !!client.state().selected);
            await client.state().selected.frame.executeJavaScript(`window.testTrace=[];
                const originalSample=window.__twDesktopPlayer.sample;window.__twDesktopPlayer.sample=()=>{const s=originalSample();if(s?.events.length)testTrace.push(['events',s.events]);return s;};
                const originalApply=window.__twDesktopPlayer.apply;window.__twDesktopPlayer.apply=c=>{testTrace.push(['command',c]);return originalApply(c);};
                for(const name of ['play','pause','ratechange'])document.querySelector('video').addEventListener(name,()=>testTrace.push([name,document.querySelector('video').currentTime]));`);
            if (name === 'Alice') {
                await until('single member connected', async () => (await roomView.webContents.executeJavaScript("document.getElementById('onlineCount').textContent")).includes('1'));
                await until('solo bridge initialized', () => roomView.webContents.executeJavaScript("document.getElementById('mobilePlayerStatus').textContent.includes('同步已连接')"));
                await inputKey(client, 'Enter', 'Enter', 13);
                await until('solo user pause', () => client.state().selected.frame.executeJavaScript('document.querySelector("video").paused && Math.abs(document.querySelector("video").currentTime-12)<1'));
                await delay(3500);
                assert.equal(await client.state().selected.frame.executeJavaScript('document.querySelector("video").paused'), true);
                // Simulate a site's buffering indicator and delayed script
                // resume. The video, room sockets and server are all real.
                await client.state().selected.frame.executeJavaScript('Object.defineProperty(document.querySelector("video"),"readyState",{configurable:true,get:()=>2})');
                await delay(1100);
                await client.state().selected.frame.executeJavaScript('delete document.querySelector("video").readyState;document.querySelector("video").play()', true);
                await continuousPlayback(client, 14000); // crosses the 10s room-state probe
                console.log('SOLO PASS: manual pause, buffered script resume and uninterrupted playback across periodic state refresh.');
            } else {
                // A hidden Chromium window can require an initial gesture.
                // Wait for the room seek, then imitate the user's first play
                // click without globally bypassing the autoplay policy.
                await until('late join receives room position', () => client.state().selected.frame.executeJavaScript('document.querySelector("video").currentTime > 20'));
                await delay(1000); // allow the initial seek/play promise to settle
                await inputKey(client, 'p', 'KeyP', 80);
                await until('late join play gesture reaches sync bridge', () => roomView.webContents.executeJavaScript("document.getElementById('mobilePlayerStatus').textContent.includes('同步已连接')"));
            }
        }
        await until('two connected members', async () => (await clients[0].state().roomView.webContents.executeJavaScript("document.getElementById('onlineCount').textContent")).includes('2'));
        await until('both cross-origin players', async () => clients.every(c => c.state().selected));
        assert.notEqual(new URL(clients[0].state().selected.frame.url).origin, new URL(source).origin);
        await until('both sync bridges initialized', async () => {
            const values = await Promise.all(clients.map(c => c.state().roomView.webContents.executeJavaScript("document.getElementById('mobilePlayerStatus').textContent")));
            return values.every(value => value.includes('同步已连接'));
        });
        const [a,b] = clients;
        await until('late join follows the solo player without resetting it', async () => {
            const values = await Promise.all(clients.map(c => c.state().selected.frame.executeJavaScript('({time:document.querySelector("video").currentTime,paused:document.querySelector("video").paused})')));
            return values.every(v => !v.paused && v.time > 20) && Math.abs(values[0].time - values[1].time) < 2.5;
        });
        // DevTools input reaches an unfocused hidden test window without
        // stealing the user's desktop focus. The page receives trusted input.
        await inputKey(a, 'Enter', 'Enter', 13);
        await until('trusted click delivered to video page', () => a.state().selected.frame.executeJavaScript('window.testClicks > 0'), 3000);
        await until('peer receives seek and pause', async () => b.state().selected.frame.executeJavaScript('Math.abs(document.querySelector("video").currentTime-12)<1 && document.querySelector("video").paused'));
        await delay(3500);
        assert.ok(await a.state().selected.frame.executeJavaScript('Math.abs(document.querySelector("video").currentTime-12)<1 && document.querySelector("video").paused'));
        await inputKey(b, 'x', 'KeyX', 88);
        await until('reverse-direction play and speed', () => a.state().selected.frame.executeJavaScript('document.querySelector("video").playbackRate===1.5 && !document.querySelector("video").paused'));
        // Keep the emulated focus until the check ends: detaching from a
        // hidden window makes Chromium itself pause the background fixture.
        await a.state().roomView.webContents.executeJavaScript("document.getElementById('mobileVideoVolume').value=25;document.getElementById('mobileVideoVolume').dispatchEvent(new Event('input'))");
        await until('local volume', () => a.state().selected.frame.executeJavaScript('document.querySelector("video").volume===.25'));
        assert.equal(await b.state().selected.frame.executeJavaScript('document.querySelector("video").volume'), 1);
        await a.state().roomView.webContents.executeJavaScript("document.getElementById('chatInput').value='desktop smoke message';document.getElementById('sendBtn').click()");
        await until('chat received', () => b.state().roomView.webContents.executeJavaScript("document.getElementById('chatContainer').textContent.includes('desktop smoke message')"));
        await a.toggleFullscreen(true); await delay(600);
        assert.equal(a.state().video.getBounds().y, 0);
        assert.equal(a.state().video.getBounds().height, a.win.getContentSize()[1]);
        const dimensions = await a.state().selected.frame.executeJavaScript('({width:innerWidth,height:innerHeight,video:document.querySelector("video").getBoundingClientRect().toJSON()})');
        assert.ok(Math.abs(dimensions.video.width - dimensions.width) <= 2);
        assert.ok(Math.abs(dimensions.video.height - dimensions.height) <= 2);
        // Hidden WebContentsViews may not expose a capturable compositor surface.
        // Geometry and restored styles above/below are the fullscreen assertions.
        await a.toggleFullscreen(false); await delay(400);
        assert.equal(a.state().video.getBounds().y, 156);
        assert.equal(await a.state().selected.frame.executeJavaScript('document.querySelector("video").style.position'), '');
        b.close();
        await until('back to one member', async () => (await a.state().roomView.webContents.executeJavaScript("document.getElementById('onlineCount').textContent")).includes('1'));
        await continuousPlayback(a, 11000);
        const oldVideo = a.state().video.webContents;
        await a.action('settings');
        await until('old playback view destroyed', () => oldVideo.isDestroyed(), 5000);
        assert.equal(a.state().current, null);
        console.log('SMOKE PASS: solo playback and buffer recovery, late join, bidirectional seek/pause/play/speed, return to solo, isolated IPC, cross-origin detection, local volume, chat, fullscreen and cleanup.');
        await require('./mixed-smoke.cjs').run({ createDesktop, server, source, output, until, inputKey });
    } catch (error) {
        console.error(backendLog);
        for (const client of clients) {
            try { console.error('STATE', await client.state().roomView.webContents.executeJavaScript('document.body.innerText')); } catch {}
            try { console.error('VIDEO', await client.state().selected.frame.executeJavaScript('({clicked:window.testClicks,time:document.querySelector("video").currentTime,paused:document.querySelector("video").paused,agent:window.__twDesktopPlayer.sample()})')); } catch {}
            try { console.error('TRACE', await client.state().selected.frame.executeJavaScript('JSON.stringify(window.testTrace)')); } catch {}
        }
        throw error;
    } finally {
        for (const client of clients) if (!client.win.isDestroyed()) client.close();
        backend.kill(); inner.closeAllConnections(); outer.closeAllConnections(); inner.close(); outer.close();
    }
};
