'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { net } = require('electron');
const { setTimeout: delay } = require('node:timers/promises');
exports.run = async ({createDesktop, server, output, until}) => {
    const clients = [];
    const fixture = 'https://media.example.com/watch';
    async function candidates(client) {
        await client.action('scan-media');
        return client.win.webContents.executeJavaScript('Array.from(document.querySelector("#mediaChoices").options).filter(o=>o.value).map(o=>({id:o.value,label:o.textContent}))');
    }
    async function control(wc, script) {
        await wc.executeJavaScript(`document.addEventListener('keydown',()=>{${script}},{once:true})`);
        await wc.debugger.sendCommand('Input.dispatchKeyEvent', {type:'keyDown',key:'q',code:'KeyQ',windowsVirtualKeyCode:81});
        await wc.debugger.sendCommand('Input.dispatchKeyEvent', {type:'keyUp',key:'q',code:'KeyQ',windowsVirtualKeyCode:81});
    }
    try {
        for (const name of ['builtin-alice','builtin-bob']) {
            const client = await createDesktop({server, testSource:'http://127.0.0.1:', visible:false}); clients.push(client);
            await client.start({nickname:name,room:'builtin-smoke',source:server+'/discover',consent:true});
            const ses = client.state().video.webContents.session;
            await ses.protocol.handle('https', async request => {
                if (new URL(request.url).hostname !== 'media.example.com') return new Response('', {status:404});
                const html = `<style>body{margin:0}video{width:100%;height:80vh}</style><video controls preload="auto" crossorigin="anonymous" src="https://media.example.com/movie.mp4"></video>`;
                if (request.url === fixture || request.url.endsWith('/next')) return new Response(html, {headers:{'content-type':'text/html'}});
                return new Response('', {status:404}); // Source video deliberately fails; transfer can still succeed.
            });
            await client.action({type:'source',source:fixture});
            await until('fixture loaded', () => !client.state().video.webContents.isLoadingMainFrame());
            await client.win.webContents.executeJavaScript('document.getElementById("setup").hidden=true;document.getElementById("tools").hidden=false');
            // Observe candidate and start the isolated view, then supply a seekable
            // MP4 on HTTPS within that view's session. No production overrides.
            const list = await candidates(client); assert.equal(list.length, 1);
            const playerSession = client.state().mediaSession;
            await playerSession.protocol.handle('https', async request => {
                if (new URL(request.url).hostname !== 'media.example.com') return new Response('', {status:404});
                if (request.url.endsWith('/broken.mp4')) return new Response('', {status:403,headers:{'access-control-allow-origin':'*'}});
                const response = await net.fetch(server + '/test-media.mp4', {headers: request.headers.has('range') ? {Range:request.headers.get('range')} : {}});
                const headers = new Headers(response.headers); headers.set('access-control-allow-origin','*');
                return new Response(response.body,{status:response.status,headers});
            });
            assert.equal((await client.action({type:'play-media',id:list[0].id})).ok, true);
            const wc = client.state().builtin.webContents;
            wc.debugger.attach('1.3'); await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
            await until('MP4 loaded', () => wc.executeJavaScript('document.querySelector("video").readyState>=3'));
            await until('player synchronized', () => client.state().selected?.frame.url === 'tw-app://desktop/player.html');
            assert.equal(await wc.executeJavaScript('typeof window.desktop'), 'undefined');
            assert.notEqual(playerSession, ses);
            assert.ok(client.state().video.webContents.isAudioMuted());
            if (name === 'builtin-alice') {
                await control(wc, 'document.querySelector("video").play()');
                await delay(2200);
                assert.equal(await wc.executeJavaScript('document.querySelector("video").paused'), false);
                assert.ok(await wc.executeJavaScript('document.querySelector("video").currentTime>1'));
            }
        }
        const [a,b] = clients, aw = a.state().builtin.webContents, bw = b.state().builtin.webContents;
        await control(aw, 'const v=document.querySelector("video");v.pause();v.currentTime=12');
        await until('built-in peer receives pause and seek', () => bw.executeJavaScript('document.querySelector("video").paused && Math.abs(document.querySelector("video").currentTime-12)<1'));
        await control(bw, 'const v=document.querySelector("video");v.playbackRate=1.5;v.play()');
        await until('built-in reverse play and speed', () => aw.executeJavaScript('!document.querySelector("video").paused && document.querySelector("video").playbackRate===1.5'));
        const room = a.state().roomView.webContents;
        fs.writeFileSync(path.join(output,'windows-builtin-toolbar.png'), (await a.win.webContents.capturePage()).toPNG());
        a.win.setContentSize(980,680);
        fs.writeFileSync(path.join(output,'windows-builtin-toolbar-small.png'), (await a.win.webContents.capturePage()).toPNG());
        a.win.setContentSize(1360,850);
        await aw.executeJavaScript('document.querySelector("video").requestFullscreen();true',true);
        await until('video control fullscreen',()=>a.state().full && a.win.isFullScreen());
        await delay(500); // Native Windows fullscreen transition is asynchronous.
        await aw.executeJavaScript('document.exitFullscreen().then(()=>true)');
        try { await until('video control exit fullscreen',()=>!a.state().full); }
        catch (error) { console.log('FULLSCREEN STATE',a.state().full,a.win.isFullScreen(),await aw.executeJavaScript('!!document.fullscreenElement'));throw error; }
        await a.toggleFullscreen(true);
        assert.equal(a.state().builtin.getBounds().y, 0);
        assert.equal(a.state().builtin.getBounds().height, a.win.getContentSize()[1]);
        await a.toggleFullscreen(false);
        fs.writeFileSync(path.join(output,'windows-builtin-player.png'), (await aw.capturePage()).toPNG());
        await a.action('original');
        assert.equal(a.state().builtin, null); assert.equal(a.state().roomView.webContents, room);
        assert.equal(a.state().video.webContents.isAudioMuted(), false);
        const old = (await candidates(a))[0].id;
        await until('original reattached',()=>!!a.state().selected);
        await a.state().selected.frame.executeJavaScript('window.__twDesktopPlayer.focus=()=>{window.testFocusWaiting=true;return new Promise(resolve=>setTimeout(()=>resolve(true),400))};true');
        const staleOpen = a.action({type:'play-media',id:old});
        await until('source transition pending',()=>a.state().video.webContents.executeJavaScript('window.testFocusWaiting===true'));
        await a.action({type:'source',source:fixture+'/next'});
        assert.equal((await staleOpen).ok,false);
        assert.equal(a.state().builtin,null);
        await until('new page loaded', () => !a.state().video.webContents.isLoadingMainFrame());
        assert.equal((await a.action({type:'play-media',id:old})).ok,false);
        // The trusted player presents an error, never claims a 403 is playing.
        await bw.executeJavaScript('window.__twBuiltin.load({url:"https://media.example.com/broken.mp4",kind:"mp4"})');
        await until('403 error visible', () => bw.executeJavaScript('!!window.__twBuiltin.state().error'));
        console.log('BUILTIN PASS: MP4 decode, solo advance, two-peer seek/pause/play/speed, isolated session, native and F11 fullscreen, original-page fallback, stale candidate/racing navigation rejection, 403 message.');
        if (process.env.TW_SMOKE_LIVE_MEDIA === '1') {
            // Real network media: an openly published trailer and HLS.js' public
            // demo. This does not validate third-party film catalogues.
            b.close(); a.close();
            const mp4 = 'https://media.w3.org/2010/05/sintel/trailer.mp4';
            for (const item of [{url:mp4,kind:'mp4'}, {url:'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',kind:'hls'}]) {
                const live = await createDesktop({server,testSource:'http://127.0.0.1:',visible:false}); clients.push(live);
                await live.start({nickname:'live-test',room:'live-media-'+item.kind,source:server+'/discover',consent:true});
                await live.state().video.webContents.session.setProxy({mode:'direct'});
                await live.state().mediaSession.setProxy({mode:'direct'});
                await live.action({type:'source',source:item.url});
                let list = [];
                await until('real '+item.kind+' candidate', async () => { list = await candidates(live); return list.length > 0; }, 30000);
                assert.equal((await live.action({type:'play-media',id:list[0].id})).ok,true);
                const wc = live.state().builtin.webContents;
                wc.on('console-message', (_event, _level, message) => console.log('LIVE CONSOLE:',message));
                wc.session.webRequest.onErrorOccurred(details => console.log('LIVE REQUEST:', new URL(details.url).pathname, details.error));
                wc.debugger.attach('1.3'); await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
                await until('real '+item.kind+' decoded', async () => {
                    const state = await wc.executeJavaScript('window.__twBuiltin.state()');
                    if (state.error) throw new Error(item.kind+': '+state.error);
                    return state.ready;
                }, 30000);
                await until('live bridge connected', () => live.state().selected?.frame.url === 'tw-app://desktop/player.html');
                await until('live room ready', () => live.state().roomView.webContents.executeJavaScript('document.querySelector("#mobilePlayerStatus").textContent.includes("同步已连接")'));
                await control(wc,'document.querySelector("video").play()');
                try {
                    const start = await wc.executeJavaScript('document.querySelector("video").currentTime');
                    await until('real '+item.kind+' advancing', () => wc.executeJavaScript(`document.querySelector("video").currentTime>${start+2} && !document.querySelector("video").paused`), 15000);
                } catch (error) {
                    console.log('LIVE FAILED STATE:',await wc.executeJavaScript('(()=>{const v=document.querySelector("video");return {time:v.currentTime,duration:v.duration,paused:v.paused,ready:v.readyState,seeking:v.seeking,error:v.error?.code,buffer:Array.from({length:v.buffered.length},(_,i)=>[v.buffered.start(i),v.buffered.end(i)])}})()'));
                    console.log('LIVE ROOM:',await live.state().roomView.webContents.executeJavaScript('document.querySelector("#mobilePlayerStatus").textContent'));
                    throw error;
                }
                if (item.kind === 'hls') {
                    assert.ok(await wc.executeJavaScript('document.querySelector("#levels").options.length>2'));
                    await control(wc,'document.querySelector("video").currentTime=30');
                    await until('real HLS seeking resumes',()=>wc.executeJavaScript('document.querySelector("video").currentTime>32 && !document.querySelector("video").paused'),20000);
                }
                console.log('LIVE '+item.kind.toUpperCase()+' PASS: real remote video decoded and advanced.');
                fs.writeFileSync(path.join(output, 'windows-live-'+item.kind+'.png'), (await wc.capturePage()).toPNG());
                live.close();
            }
        }
    } finally { for (const client of clients) if (!client.win.isDestroyed()) client.close(); }
};
