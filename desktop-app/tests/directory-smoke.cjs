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
            return new Response('<h1>Manual verification fixture</h1><input id="fixtureInput"><button id="verify">User continues</button><script>window.verified=document.cookie.includes("tw_fixture_verified=1");if(window.verified)location.replace("/watch");document.getElementById("verify").onclick=()=>{document.cookie="tw_fixture_verified=1; Max-Age=3600; Path=/; Secure; SameSite=Lax";window.verified=true;location.href="/watch";};</script>',{headers:{'content-type':'text/html'}});
        });
        await until('catalog ready',()=>catalog.executeJavaScript('!!document.getElementById("discoveryQuery")'));
        assert.equal(pageLoads,0,'rendering directory must not contact source sites');
        assert.equal(client.state().current,null);
        await catalog.executeJavaScript('document.getElementById("discoveryQuery").value="retained search"');
        await client.action({type:'source',source:server+'/discover/site/aafun'});
        await until('site opened inside client',()=>client.state().discoveryView.webContents.getURL()==='https://www.aafun.cc/');
        const wc = client.state().discoveryView.webContents;
        await until('verification fixture ready',()=>wc.executeJavaScript('!!document.getElementById("verify")'));
        await delay(500);
        assert.equal(await wc.executeJavaScript('window.verified'),false,'application must not solve/click a challenge');
        assert.equal(await wc.executeJavaScript('typeof window.desktop'), 'undefined');
        assert.equal(await wc.executeJavaScript('typeof require'), 'undefined');
        assert.equal(client.state().current,null,'visiting verification page must not join a room');
        await wc.executeJavaScript('document.getElementById("fixtureInput").value="unfinished form"');
        const firstLoads = pageLoads;
        await client.action('discover');
        assert.equal(client.state().discoveryView.webContents,catalog,'returning must retain catalogue DOM');
        assert.equal(await catalog.executeJavaScript('document.getElementById("discoveryQuery").value'),'retained search');
        assert.equal(wc.isAudioMuted(),true,'hidden original must be muted');
        await client.action({type:'source',source:server+'/discover/site/aafun'});
        await until('resume the original without reloading',()=>client.state().discoveryView?.webContents===wc);
        assert.equal(pageLoads,firstLoads,'switching back must not reload the original');
        assert.equal(await wc.executeJavaScript('document.getElementById("fixtureInput").value'),'unfinished form');
        assert.equal(wc.isAudioMuted(),false);
        const hiddenRequest = await catalog.executeJavaScript('window.twSourceMetadata.request("hidden-test","search",{source:"pkavi",q:"test"})');
        assert.equal(hiddenRequest.status,'unavailable','parked catalogue cannot start metadata work');
        assert.match((await client.action('pick-current')).error,/未找到视频/);
        await client.action('finder-reload');
        await until('reload retains manual challenge',()=>wc.executeJavaScript('!!document.getElementById("verify") && window.verified === false'));
        // Simulated human action on our local mock page, not a real challenge.
        await wc.executeJavaScript('document.getElementById("verify").click()',true);
        await until('same-site navigation after manual interaction',()=>wc.getURL()==='https://www.aafun.cc/watch');
        await until('fixture video present',()=>wc.executeJavaScript('!!document.querySelector("video")'));
        await wc.executeJavaScript('document.querySelector("video").play()',true);
        await client.action('discover');
        assert.equal(await wc.executeJavaScript('document.querySelector("video").paused'),true,'hidden media must pause');
        await client.action({type:'source',source:server+'/discover/site/aafun'});
        await until('resume playback page, not homepage',()=>client.state().discoveryView?.webContents===wc);
        assert.equal(wc.getURL(),'https://www.aafun.cc/watch');
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
        await until('return to catalogue',()=>client.state().discoveryView.webContents.executeJavaScript('!!document.getElementById("discoveryQuery")'));
        await client.action({type:'source',source:server+'/discover/site/aafun'});
        await until('local source session reused after returning to finder',()=>client.state().discoveryView.webContents.getURL()==='https://www.aafun.cc/watch');
        assert.equal(client.state().current.room,joined.room,'reusing original session must not change room');
        assert.equal(await client.state().discoveryView.webContents.executeJavaScript('typeof window.twSourceMetadata'),'undefined');
        const resumedOriginal = client.state().discoveryView.webContents;
        await client.action('discover');
        const resumedCatalog = client.state().discoveryView.webContents;
        await client.action({type:'source',source:server+'/discover/site/noxx'});
        await until('opening another original evicts previous original',()=>resumedOriginal.isDestroyed());
        assert.equal(resumedCatalog.isDestroyed(),false,'bounded original cache must retain catalogue');
        const nextOriginal = client.state().discoveryView.webContents;
        await client.action('settings');
        assert.equal(resumedCatalog.isDestroyed(),false,'setup must retain search');
        assert.equal(nextOriginal.isDestroyed(),false,'setup must retain original-site history');
        await client.action('back');
        assert.equal(client.state().discoveryView.webContents,nextOriginal);
        client.close();
        await until('window close releases both cached views',()=>resumedCatalog.isDestroyed() && nextOriginal.isDestroyed());

        preview = new BrowserWindow({show:false,width:1380,height:1000,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
        await preview.loadURL(server+'/discover');
        await preview.webContents.executeJavaScript('document.getElementById("sourceDiscovery").scrollIntoView()');
        await delay(700);
        fs.writeFileSync(path.join(output,'site-directory-desktop.png'),(await preview.webContents.capturePage()).toPNG());
        preview.setSize(390,844);
        await delay(400);
        await preview.webContents.executeJavaScript('document.getElementById("sourceDiscovery").scrollIntoView()');
        assert.ok(await preview.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth + 1'),'directory must not overflow mobile');
        fs.writeFileSync(path.join(output,'site-directory-mobile.png'),(await preview.webContents.capturePage()).toPNG());
        console.log('ORIGINAL NAVIGATION PASS: manual verification untouched, retained search/forms/current page, paused hidden media, inactive IPC rejected, bounded view cleanup, local session reuse, isolated original-site view, retry/navigation, compatibility-room confirmation, player detection, preserved room, desktop/mobile layout.');
    } finally {
        dialog.showMessageBox = originalDialog;
        if (preview && !preview.isDestroyed()) preview.close();
        if(!client.win.isDestroyed())client.close();
    }
};
