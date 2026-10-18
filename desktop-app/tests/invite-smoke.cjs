'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {net} = require('electron');
const {setTimeout:delay} = require('node:timers/promises');
exports.run = async ({createDesktop,server,output,until}) => {
    const clients = [];
    async function newClient(name) {
        const client = await createDesktop({server,visible:false}); clients.push(client);
        const opened = await client.start({nickname:name,consent:true});
        assert.equal(opened.browsing,true);
        assert.equal(client.state().current,null,'searching must not create/join a room');
        assert.equal(client.state().roomView,null);
        const ses = client.state().discoveryView.webContents.session;
        // Code-owned local media fixture: no requests to third-party content.
        await ses.protocol.handle('https', async request => {
            const url = new URL(request.url);
            if (!['video.blender.org','media.w3.org'].includes(url.hostname)) return new Response('',{status:404});
            if (url.pathname.endsWith('.mp4')) {
                const r = await net.fetch(server+'/test-media.mp4',{headers:request.headers.has('range')?{range:request.headers.get('range')}:{}});
                return new Response(r.body,{status:r.status,headers:r.headers});
            }
            return new Response('<style>body{margin:0}video{width:100%;height:90vh}</style><video controls muted preload="auto" src="https://media.w3.org/2010/05/sintel/trailer.mp4"></video>',{headers:{'content-type':'text/html'}});
        });
        return client;
    }
    async function control(client, code) {
        const wc=client.state().video.webContents;
        if (!wc.debugger.isAttached()) { wc.debugger.attach('1.3'); await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true}); }
        await wc.executeJavaScript(`document.addEventListener('keydown',()=>{${code}},{once:true})`);
        await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'q',code:'KeyQ',windowsVirtualKeyCode:81});
        await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'q',code:'KeyQ',windowsVirtualKeyCode:81});
    }
    const read = (client,code) => client.state().video.webContents.executeJavaScript(code);
    try {
        const a = await newClient('host');
        const finder = a.state().discoveryView.webContents;
        await until('finder form ready',()=>finder.executeJavaScript('!!document.getElementById("discoveryQuery")'));
        fs.writeFileSync(path.join(output,'windows-search-first.png'),(await a.win.webContents.capturePage()).toPNG());
        await finder.executeJavaScript('document.getElementById("discoveryQuery").value="Sintel";document.getElementById("discoveryForm").requestSubmit()');
        await until('search result',()=>finder.executeJavaScript('!!document.querySelector(".discovery-title-card button")'));
        await delay(700);
        try { fs.writeFileSync(path.join(output,'windows-search-content.png'),(await finder.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG()); } catch { console.log('Hidden finder screenshot unavailable; DOM and navigation assertions still run.'); }
        assert.equal(a.state().current,null,'result list still must not create a room');
        await finder.executeJavaScript('document.querySelector(".discovery-title-card button").click()');
        await until('episode chooser',()=>finder.executeJavaScript('!!document.querySelector("#discoveryEpisodes a")'));
        await finder.executeJavaScript('document.querySelector("#discoveryEpisodes a").click()');
        await until('selection creates room',()=>!!a.state().current && !!a.state().selected);
        const id = a.state().current.room;
        const selection = await (await fetch(server+`/api/watch-rooms/${id}/program`)).json();
        assert.equal(selection.program.source,'blender'); assert.equal(selection.owner,undefined);
        assert.ok(a.state().video.getBounds().width > 0); assert.ok(a.state().roomView.getBounds().width > 0);
        await until('host bridge connected',()=>a.state().roomView.webContents.executeJavaScript('document.getElementById("mobilePlayerStatus").textContent.includes("同步已连接")'));
        await control(a,'const v=document.querySelector("video");v.currentTime=9;v.play()');
        await until('host is progressing',()=>read(a,'!document.querySelector("video").paused && document.querySelector("video").currentTime>11'));
        const b = await newClient('guest');
        const result=await b.start({nickname:'guest',room:server+'/room/'+id,consent:true});
        assert.equal(result.ok,true,result.error); // Deliberately NO source field.
        await until('guest opens matching page',()=>!!b.state().selected);
        assert.equal(b.state().video.webContents.getURL(),a.state().video.webContents.getURL());
        await until('guest catches host progress',()=>read(b,'document.querySelector("video").currentTime>10'));
        await until('guest playing automatically',()=>read(b,'!document.querySelector("video").paused'));
        await control(a,'const v=document.querySelector("video");v.pause();v.currentTime=18');
        await until('invited peer receives seek and pause',()=>read(b,'document.querySelector("video").paused && Math.abs(document.querySelector("video").currentTime-18)<1'));
        const rejected = await b.action({type:'source',source:'https://media.w3.org/2010/05/bunny/trailer.mp4'});
        assert.equal(rejected.ok,false);
        const changed = await a.action({type:'source',source:'https://media.w3.org/2010/05/bunny/trailer.mp4'});
        assert.equal(changed.ok,true,changed.error);
        await until('guest follows next episode',()=>b.state().video.webContents.getURL().includes('/bunny/'));
        await until('new source bridge ready',()=>!!b.state().selected);
        await delay(2500);
        assert.ok(await read(b,'document.querySelector("video").currentTime<15'),'old 18 second timeline must not leak into new episode');
        fs.writeFileSync(path.join(output,'windows-invite-follow.png'),(await b.win.webContents.capturePage()).toPNG());
        const invalid = await b.start({nickname:'guest',room:server+'/room/'+'0'.repeat(24),consent:true});
        assert.equal(invalid.ok,false,'missing invitation must not silently create a new room');
        console.log('INVITE PASS: search without room, result + episode creates room, invite-only opens source and catches playing host, pause/seek, guest cannot replace source, host next episode auto follows without old timeline, missing invite rejected.');
        if (process.env.TW_SMOKE_KANJU_LIVE === '1') {
            const k=await createDesktop({server,visible:false}); clients.push(k);
            await k.start({nickname:'entry-check',consent:true});
            await k.state().discoveryView.webContents.session.setProxy({mode:'direct'});
            await k.action('kanju');
            const wc=k.state().discoveryView.webContents;
            await until('Kanju original entry renders',()=>wc.executeJavaScript('document.body.innerText.length>40'),45000);
            console.log('KANJU ENTRY ONLY:',(await wc.executeJavaScript('document.body.innerText')).slice(0,600).replace(/\s+/g,' '));
            try { fs.writeFileSync(path.join(output,'windows-kanju-entry.png'),(await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG()); } catch { console.log('Hidden Kanju screenshot unavailable; real page text verified.'); }
        }
    } finally { for (const client of clients) if (!client.win.isDestroyed()) client.close(); }
};
