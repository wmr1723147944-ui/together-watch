'use strict';
// A real room web page at phone width paired with the real Windows client.
// This checks Chromium integration, not physical Android/iOS browser behavior.
const { BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');

exports.run = async ({ createDesktop, server, source, output, until, inputKey }) => {
    console.log('MIXED: preparing direct-media room');
    const seed = await new Promise((resolve, reject) => {
        const req = http.get(server + '/test-seed', res => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => req.destroy(new Error('Seed request timed out')));
    });
    const phone = new BrowserWindow({ show: false, width: 390, height: 844,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
            partition: 'mixed-smoke-phone' } });
    let desktop;
    const wc = phone.webContents;
    const js = code => wc.executeJavaScript(code);
    const phoneState = () => js('({paused:mainVideo.paused,time:mainVideo.currentTime,rate:mainVideo.playbackRate})');
    try {
        await phone.loadURL(server);
        wc.debugger.attach('1.3');
        await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
        await js(`localStorage.setItem('tw_legal_notice_version',${JSON.stringify(seed.legal_version)});localStorage.setItem('tw_username','Phone');`);
        await phone.loadURL(server + '/room/mixed-smoke');
        console.log('MIXED: phone page loaded');
        await until('phone direct video loaded', () => js('mainVideo.readyState >= 2'));
        await js(`window.testEvents=[];
            for(const name of ['play','pause','seeking','seeked'])mainVideo.addEventListener(name,()=>testEvents.push([name,mainVideo.currentTime]));
            mainVideo.muted=true;
            mainVideo.addEventListener('keydown',event=>{if(event.key==='k'){event.preventDefault();mainVideo.pause();}else if(event.key==='j'){event.preventDefault();mainVideo.currentTime=8;}else if(event.key==='p'){event.preventDefault();mainVideo.play();}});`);
        desktop = await createDesktop({ server, testSource: 'http://127.0.0.1:', visible: false });
        const result = await desktop.win.webContents.executeJavaScript(`window.desktop.start(${JSON.stringify({ nickname: 'Desktop', room: 'mixed-smoke', source, consent: true })})`);
        assert.equal(result.ok, true, result.error);
        const debuggerApi = desktop.state().video.webContents.debugger;
        debuggerApi.attach('1.3');
        await debuggerApi.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
        await until('mixed desktop player', () => !!desktop.state().selected);
        const desktopJs = code => desktop.state().selected.frame.executeJavaScript(code);
        await until('mixed bridge ready', () => desktop.state().roomView.webContents.executeJavaScript("document.getElementById('mobilePlayerStatus').textContent.includes('同步已连接')"));
        console.log('MIXED: both players ready');
        await delay(3500); // initial source loading guards
        await inputKey(desktop, 'Enter', 'Enter', 13);
        await until('desktop pause/seek reaches room video', async () => {
            const v = await phoneState(); return v.paused && Math.abs(v.time - 12) < 1;
        });
        await delay(1000);
        await inputKey(desktop, 'p', 'KeyP', 80);
        await until('desktop play reaches room video', async () => !(await phoneState()).paused);
        await delay(11000); // periodic room_state must not flip phone into external mode
        assert.equal((await phoneState()).paused, false);
        await inputKey(desktop, 'Enter', 'Enter', 13);
        await until('phone pause still works after periodic snapshot', async () => (await phoneState()).paused);

        const phoneKey = async (key, code, keyCode) => {
            await js('mainVideo.focus()');
            await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode });
            await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
        };
        await phoneKey('j', 'KeyJ', 74);
        await until('phone seek reaches desktop', () => desktopJs('Math.abs(document.querySelector("video").currentTime-8)<1'));
        await phoneKey('p', 'KeyP', 80);
        await until('phone play reaches desktop', () => desktopJs('!document.querySelector("video").paused'));
        await delay(800);
        await phoneKey('k', 'KeyK', 75);
        await until('phone pause reaches desktop', () => desktopJs('document.querySelector("video").paused'));
        await delay(800);

        // Fault injection: deny play exactly as a mobile autoplay policy would.
        // No browser policy is disabled, and no production code is substituted.
        await js(`window.originalPlay=mainVideo.play;
            mainVideo.play=function(){return Promise.reject(new DOMException('Test policy denial','NotAllowedError'));};void 0;`);
        await inputKey(desktop, 'p', 'KeyP', 80);
        await until('visible mobile autoplay recovery', () => js('!playbackResumePrompt.classList.contains("hidden")'));
        await delay(1500);
        assert.equal(await desktopJs('document.querySelector("video").paused'), false, 'blocked phone must not pause desktop');
        await js('mainVideo.scrollIntoView({block:"center"});');
        fs.writeFileSync(path.join(output, 'mobile-resume-prompt.png'), (await wc.capturePage()).toPNG());
        await js('mainVideo.play=window.originalPlay;window.resumeClicks=0;resumePlaybackBtn.addEventListener("click",()=>window.resumeClicks++);');
        const button = await js('(()=>{const r=resumePlaybackBtn.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
        await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...button, button: 'left', clickCount: 1 });
        await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...button, button: 'left', clickCount: 1 });
        await until('trusted resume click delivered', () => js('window.resumeClicks===1'), 3000);
        await until('phone unlock resumes and catches current position', async () => {
            const v = await phoneState();
            const d = await desktopJs('({time:document.querySelector("video").currentTime,paused:document.querySelector("video").paused})');
            return !v.paused && !d.paused && Math.abs(v.time - d.time) < 2;
        });
        assert.equal(await js('playbackResumePrompt.classList.contains("hidden")'), true);
        console.log('MIXED PASS: phone-width room browser + Windows client, periodic state, bidirectional pause/play/seek, autoplay denial and local-only recovery.');
    } catch (error) {
        console.error('PHONE', await js('({text:document.body.innerText,events:window.testEvents})').catch(() => 'unavailable'));
        throw error;
    } finally {
        if (desktop && !desktop.win.isDestroyed()) desktop.close();
        if (!phone.isDestroyed()) phone.destroy();
    }
};
