'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {BrowserWindow, dialog, net} = require('electron');
const {setTimeout:delay} = require('node:timers/promises');

exports.run = async ({createDesktop,server,output,until}) => {
    const client = await createDesktop({server,visible:false});
    const originalDialog = dialog.showMessageBox;
    let preview = null;
    try {
        const result = await client.start({nickname:'directory-test',consent:true});
        assert.ok(result.browsing);
        const catalog = client.state().discoveryView.webContents;
        const ses = catalog.session;
        let pageLoads = 0, dialogs = 0;
        // Local fixtures ONLY: this is not a real captcha or source-site test.
        await ses.protocol.handle('https',async request => {
            const url = new URL(request.url);
            if (url.hostname !== 'www.aafun.cc') return new Response('blocked fixture',{status:404});
            pageLoads++;
            if (url.pathname === '/sample.mp4') {
                const r = await net.fetch(server+'/test-media.mp4',{headers:request.headers.has('range')?{range:request.headers.get('range')}:{}});
                return new Response(r.body,{status:r.status,headers:r.headers});
            }
            if (url.pathname === '/watch') return new Response('<video controls muted preload="auto" src="/sample.mp4"></video>',{headers:{'content-type':'text/html'}});
            return new Response('<h1>Manual verification fixture</h1><button id="verify">User continues</button><script>window.verified=false;document.getElementById("verify").onclick=()=>{window.verified=true;location.href="/watch";};</script>',{headers:{'content-type':'text/html'}});
        });
        await until('catalog ready',()=>catalog.executeJavaScript('!!document.querySelector("#recommendedSites")'));
        assert.equal(await catalog.executeJavaScript('document.querySelectorAll("[data-directory-site]").length'),19);
        assert.equal(pageLoads,0,'rendering directory must not contact source sites');
        assert.equal(client.state().current,null);
        await catalog.executeJavaScript('document.querySelector("[data-directory-site=aafun] a").click()');
        await until('site opened inside client',()=>client.state().discoveryView.webContents.getURL()==='https://www.aafun.cc/');
        const wc = client.state().discoveryView.webContents;
        await until('verification fixture ready',()=>wc.executeJavaScript('!!document.getElementById("verify")'));
        await delay(500);
        assert.equal(await wc.executeJavaScript('window.verified'),false,'application must not solve/click a challenge');
        assert.equal(await wc.executeJavaScript('typeof window.desktop'), 'undefined');
        assert.equal(await wc.executeJavaScript('typeof require'), 'undefined');
        assert.equal(client.state().current,null,'visiting verification page must not join a room');
        assert.match((await client.action('pick-current')).error,/未找到视频/);
        await client.action('finder-reload');
        await until('reload retains manual challenge',()=>wc.executeJavaScript('!!document.getElementById("verify") && window.verified === false'));
        // Simulated human action on our local mock page, not a real challenge.
        await wc.executeJavaScript('document.getElementById("verify").click()',true);
        await until('same-site navigation after manual interaction',()=>wc.getURL()==='https://www.aafun.cc/watch');
        await until('fixture video present',()=>wc.executeJavaScript('!!document.querySelector("video")'));
        dialog.showMessageBox = async (_win,options) => {
            assert.match(options.detail,/朋友仍需各自打开同一播放页/); dialogs++;
            return {response:1};
        };
        const joined = await client.action('pick-current');
        assert.ok(joined.ok, joined.error);
        assert.match(joined.room,/^legacy-/,'unsupported source must not fake automatic invite compatibility');
        assert.equal(dialogs,1,'compatibility limitation requires user confirmation');
        assert.equal(client.state().video.webContents.getURL(),'https://www.aafun.cc/watch');
        await until('compatibility player detected',()=>!!client.state().selected);
        await client.action('discover');
        assert.equal(client.state().current.room,joined.room,'browsing cannot replace current room');
        await until('return to directory',()=>client.state().discoveryView.webContents.executeJavaScript('!!document.querySelector("#recommendedSites")'));

        preview = new BrowserWindow({show:false,width:1380,height:1000,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
        await preview.loadURL(server+'/discover');
        await preview.webContents.executeJavaScript('document.getElementById("recommendedSites").open=true;document.getElementById("recommendedSites").scrollIntoView()');
        await delay(700);
        fs.writeFileSync(path.join(output,'site-directory-desktop.png'),(await preview.webContents.capturePage()).toPNG());
        preview.setSize(390,844);
        await delay(400);
        await preview.webContents.executeJavaScript('document.getElementById("recommendedSites").scrollIntoView()');
        assert.ok(await preview.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth + 1'),'directory must not overflow mobile');
        fs.writeFileSync(path.join(output,'site-directory-mobile.png'),(await preview.webContents.capturePage()).toPNG());
        console.log('DIRECTORY PASS: 19 entries, no eager third-party requests, manual verification untouched, isolated original-site view, retry/navigation, explicit compatibility-room confirmation, player detection, preserved room, desktop/mobile layout.');
    } finally {
        dialog.showMessageBox = originalDialog;
        if (preview && !preview.isDestroyed()) preview.close();
        client.close();
    }
};
