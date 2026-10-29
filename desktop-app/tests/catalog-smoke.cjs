'use strict';
const assert=require('node:assert/strict');
const {BrowserWindow,net,session}=require('electron');
const {setTimeout:delay}=require('node:timers/promises');
const {api}=require('../src/catalog-adapters.cjs');
const fs=require('node:fs'),path=require('node:path');
exports.run=async({createDesktop,server,output,until})=>{
    const clients=[];
    async function client(name,source,item) {
        const c=await createDesktop({server,visible:false});clients.push(c);
        assert.ok((await c.start({nickname:name,consent:true})).browsing);
        let verified=source!=='233dm',verifications=0;
        const host=api.sources[source].host;
        const detail=source==='huarw'?`/movie/${item}`:source==='kanju'?`/player/${encodeURIComponent(item)}`:source==='233dm'?`/anime/${item}.html`:`/mv/${item}.html`;
        // Catalogue and original-site readers now use isolated partitions.
        // Mock the reader partition, not the first-party catalogue session.
        await session.fromPartition('video-test-'+c.win.id).protocol.handle('https',async req=>{
            const u=new URL(req.url);
            if(u.hostname!==host)return new Response('fixture blocked',{status:404});
            // The search DOM is ready while its image is still pending. The
            // metadata reader must not wait for the whole page's load event.
            if(source==='pkavi' && u.pathname==='/covers/fixture.jpg') {
                await delay(14000);return new Response('',{headers:{'content-type':'image/jpeg'}});
            }
            if(u.pathname==='/sample.mp4'){
                const r=await net.fetch(server+'/test-media.mp4',{headers:req.headers.has('range')?{range:req.headers.get('range')}:{}});
                return new Response(r.body,{status:r.status,headers:r.headers});
            }
            let html;
            if(u.pathname==='/search' || u.pathname.startsWith('/search/') || u.pathname.startsWith('/vs/') || u.pathname==='/collections/browse') {
                if(u.pathname.endsWith('/fixture-verified')){verified=true;verifications++;}
                // Local mock only. The test supplies the human action; production
                // never clicks or solves verification controls.
                html=!verified?`<title>系统安全验证</title><button id="verify" onclick="location.href='/search/fixture-verified?wd=测试'">Mock human continue</button>`
                    : source==='kanju' ? `<title>看剧 AI</title><div id="results"></div><script>setTimeout(()=>document.getElementById('results').innerHTML='<a href="${detail}?from=collection" aria-label="打开播放器：测试动画"><img src="/covers/fixture.jpg">封面</a>',600)</script>`
                    : `<title>搜索结果</title><div class="search-box"><h3><a href="${detail}" title="测试动画"><img src="/covers/fixture.jpg">测试动画</a></h3></div>`;
            } else if(u.pathname===detail) {
                html=source==='kanju' ? `<title>测试动画 · 看剧 AI</title><h1>测试动画</h1><div id="episodes"></div>`
                    + (u.searchParams.has('episode')?'<style>body{margin:0}video{width:100%;height:90vh}</style><video controls muted preload="auto" src="/sample.mp4"></video>':'')
                    + `<script>setTimeout(()=>{document.getElementById('episodes').innerHTML=[1,2].map(n=>'<button data-directory-episode="episode:'+n+'" title="第'+n+'集" class="'+(new URL(location.href).searchParams.get('episode')==='episode:'+n?'movie-button-primary':'movie-button-secondary')+'">第'+n+'集</button>').join('')},1200)</script>`
                    : `<title>测试动画</title><h1>测试动画</h1><meta name="description" content="本地测试目录">`
                    +[1,2].map(n=>`<a href="${api.selection(source,item,source==='huarw'?item+'-'+n:'3-'+n).page}">第${n}集</a>`).join('');
            } else if(api.fromPage(req.url)) {
                html='<style>body{margin:0}video{width:100%;height:95vh}</style><video controls muted preload="auto" src="/sample.mp4"></video>';
            } else return new Response('fixture not found',{status:404});
            return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});
        });
        return {c,verifications:()=>verifications};
    }
    const read=(c,js)=>c.state().video.webContents.executeJavaScript(js);
    async function gesture(c,js){
        const wc=c.state().video.webContents;
        if(!wc.debugger.isAttached()){wc.debugger.attach('1.3');await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});}
        await wc.executeJavaScript(`document.addEventListener('keydown',()=>{${js}},{once:true})`);
        await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'q',code:'KeyQ',windowsVirtualKeyCode:81});
        await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'q',code:'KeyQ',windowsVirtualKeyCode:81});
    }
    try {
        for(const [source,item] of [['233dm','251f681f349a5832bcb61768'],['pkavi','514960'],['kanju','variant:test-123']]) {
            const episode=n=>source==='huarw'?item+'-'+n:source==='kanju'?'ep-episode:'+n:'3-'+n;
            const host=await client('host-'+source,source,item),a=host.c;
            const finder=a.state().discoveryView.webContents;
            await until('native catalogue bridge ready',()=>finder.executeJavaScript('!!window.twSourceMetadata && !!document.getElementById("discoveryQuery")'));
            assert.equal((await finder.executeJavaScript('twSourceMetadata.request("bad-source","search",{source:"constructor",q:"test"})')).status,'unavailable');
            assert.equal((await finder.executeJavaScript('twSourceMetadata.request("bad-url","detail",{source:"pkavi",page_url:"https://127.0.0.1/"})')).status,'unavailable');
            await finder.executeJavaScript(`for(const c of document.querySelectorAll('[data-live-source]'))c.checked=c.dataset.liveSource===${JSON.stringify(source)};document.getElementById('discoveryQuery').value='测试';document.getElementById('discoveryForm').requestSubmit()`);
            if(source==='233dm') {
                await until('manual verification choice',()=>finder.executeJavaScript('!!document.querySelector(".catalog-query-note button:not(:disabled)")'));
                assert.equal(host.verifications(),0);assert.equal(a.state().current,null);
                await finder.executeJavaScript('document.querySelector(".catalog-query-note button").click()');
                let manual;
                await until('isolated original verification window',()=>{
                    manual=BrowserWindow.getAllWindows().find(w=>w.id!==a.win.id && w.webContents.getURL().startsWith('https://www.233dm.com/search/'));return !!manual;
                });
                await until('mock button ready',()=>manual.webContents.executeJavaScript('!!document.getElementById("verify")'));
                assert.equal(await manual.webContents.executeJavaScript('typeof window.twSourceMetadata'),'undefined');
                assert.equal(await manual.webContents.executeJavaScript('typeof require'),'undefined');
                await finder.executeJavaScript('document.getElementById("discoveryClear").click()');
                await until('clearing search closes verification window',()=>manual.isDestroyed());
                assert.equal(host.verifications(),0);assert.equal(a.state().current,null);
                await finder.executeJavaScript('document.getElementById("discoveryQuery").value="测试";document.getElementById("discoveryForm").requestSubmit()');
                await until('challenge can be retried after cancellation',()=>finder.executeJavaScript('!!document.querySelector(".catalog-query-note button:not(:disabled)")'));
                await finder.executeJavaScript('document.querySelector(".catalog-query-note button").click()');
                await until('new verification window',()=>{
                    manual=BrowserWindow.getAllWindows().find(w=>w.id!==a.win.id && w.webContents.getURL().startsWith('https://www.233dm.com/search/'));return !!manual;
                });
                await until('new verification button ready',()=>manual.webContents.executeJavaScript('!!document.getElementById("verify")'));
                await manual.webContents.executeJavaScript('document.getElementById("verify").click()',true);
            }
            await until('unified search result',()=>finder.executeJavaScript('!!document.querySelector(".discovery-title-card button")'));
            assert.equal(await finder.executeJavaScript('document.querySelector("#discoveryLiveResults .discovery-poster-image")?.src'),`https://${api.sources[source].host}/covers/fixture.jpg`);
            assert.equal(a.state().current,null);
            await finder.executeJavaScript('document.querySelector(".discovery-title-card button").click()');
            await until('unified episodes',()=>finder.executeJavaScript('document.querySelectorAll("#discoveryEpisodes a").length===2'));
            if(source==='kanju')assert.ok(await finder.executeJavaScript('document.getElementById("discoveryDetailStatus").textContent.includes("这里只显示原站当前已加载的集数")'));
            // Hidden WebContentsViews may not have a capturable display surface.
            // DOM assertions above are mandatory; visual QA uses an offscreen window.
            await finder.executeJavaScript('document.querySelector("#discoveryEpisodes a").click()');
            await until('selection creates room and detects player',()=>!!a.state().current && !!a.state().selected);
            const id=a.state().current.room;
            const roomView=a.state().roomView;
            await a.action('back');
            assert.equal(a.state().discoveryView.webContents,finder,'playback back restores the same search document');
            assert.ok(a.state().browsing);
            assert.equal(await finder.executeJavaScript('document.getElementById("discoveryDetail").open'),true);
            assert.equal(await finder.executeJavaScript('document.getElementById("discoveryQuery").value'),'测试');
            assert.equal(await finder.executeJavaScript('document.querySelectorAll("#discoveryEpisodes a").length'),2);
            await a.action('back');
            assert.equal(await finder.executeJavaScript('document.getElementById("discoveryDetail").open'),false);
            assert.ok(await finder.executeJavaScript('!!document.querySelector(".discovery-title-card button")'));
            assert.equal(a.state().current.room,id);assert.equal(a.state().roomView,roomView);
            await a.action('return-video');
            const room=await(await fetch(server+'/api/watch-rooms/'+id+'/program')).json();
            assert.equal(room.program.source,source);assert.equal(room.program.episode,episode(1));assert.equal(room.owner,undefined);
            try {await until('host sync connected',()=>a.state().roomView.webContents.executeJavaScript('document.getElementById("mobilePlayerStatus").textContent.includes("同步已连接")'));}
            catch(error){console.error('FIXTURE SYNC',source,await a.state().roomView.webContents.executeJavaScript('document.getElementById("mobilePlayerStatus").textContent'),{browsing:a.state().browsing,selected:!!a.state().selected});throw error;}
            await gesture(a,'const v=document.querySelector("video");v.currentTime=9;v.play()');
            await until('host progressing',()=>read(a,'!document.querySelector("video").paused && document.querySelector("video").currentTime>11'));
            const {c:b}=await client('guest-'+source,source,item);
            const joined=await b.start({nickname:'guest',room:server+'/room/'+id,consent:true});
            assert.ok(joined.ok,joined.error);
            await until('guest player without reentering source',()=>!!b.state().selected);
            assert.equal(b.state().video.webContents.getURL(),api.selection(source,item,episode(1)).page);
            await until('guest catches up',()=>read(b,'document.querySelector("video").currentTime>10 && !document.querySelector("video").paused'));
            await gesture(a,'const v=document.querySelector("video");v.pause();v.currentTime=18');
            await until('peer pause and seek',()=>read(b,'document.querySelector("video").paused && Math.abs(document.querySelector("video").currentTime-18)<1'));
            const next=server+api.selection(source,item,episode(2)).path;
            assert.equal((await b.action({type:'source',source:next})).ok,false);
            assert.equal(await a.action('episodes'),true);
            const picker=a.state().episodeView.webContents;
            assert.equal(a.state().browsing,false);
            await until('native in-player episode directory '+source,()=>picker.executeJavaScript('document.querySelectorAll("#discoveryEpisodes a").length===2'));
            assert.equal((await picker.executeJavaScript('twSourceMetadata.request("not-search","search",{source:"kanju",q:"test"})')).status,'unavailable');
            assert.equal(await picker.executeJavaScript('document.querySelector("#discoveryEpisodes [aria-current]").getAttribute("href")'),api.selection(source,item,episode(1)).path);
            await picker.executeJavaScript('document.querySelectorAll("#discoveryEpisodes a")[1].click()');
            await until('invited guest changes episode',()=>b.state().video.webContents.getURL()===api.selection(source,item,episode(2)).page && !!b.state().selected);
            assert.equal(a.state().episodeView,null);assert.equal(a.state().roomView,roomView);assert.equal(a.state().current.room,id);
            await delay(1800);
            assert.ok(await read(b,'document.querySelector("video").currentTime<15'));
            a.close();b.close();
            console.log('CATALOG PASS '+source+': search, manual challenge when needed, details, episodes, room creation, invite-only join, progress, pause/seek, host-only episode change.');
        }
        const preview=new BrowserWindow({show:false,width:1360,height:900,webPreferences:{partition:'catalog-visual-'+process.pid,offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
        try {
            preview.webContents.session.webRequest.onBeforeRequest((details,cb)=>cb({cancel:!details.url.startsWith(server+'/')}));
            // Uses the dedicated visual fixture in the local smoke backend.
            await preview.loadURL(server+'/discover');
            // Optional local captures of public HTML. DOMParser is inert, and
            // external requests are blocked; no site scripts or media execute.
            if(process.env.TW_CATALOG_SAMPLES) {
                const manifest=JSON.parse(fs.readFileSync(process.env.TW_CATALOG_SAMPLES,'utf8'));
                for(const sample of manifest) {
                    const html=fs.readFileSync(path.resolve(path.dirname(process.env.TW_CATALOG_SAMPLES),sample.file),'utf8');
                    const req=api.request(sample.kind,sample.payload);
                    assert.ok(req);
                    const parsed=await preview.webContents.executeJavaScript(`TogetherWatchCatalogAdapters.readDocument(new DOMParser().parseFromString(${JSON.stringify(html)},'text/html'),${JSON.stringify(req)})`);
                    assert.equal(parsed.status,sample.status);
                    if(sample.episodes!==undefined) assert.equal(parsed.episodes.length,sample.episodes);
                    console.log('SAVED HTML PASS '+req.source+' '+req.kind+': '+parsed.status+(parsed.episodes?' ('+parsed.episodes.length+' entries)':''));
                }
            }
            await preview.webContents.executeJavaScript(`for(const c of document.querySelectorAll('[data-live-source]'))c.checked=c.dataset.liveSource==='pkavi';document.getElementById('discoveryQuery').value='视觉测试';document.getElementById('discoveryForm').requestSubmit()`);
            await until('visual search results',()=>preview.webContents.executeJavaScript('!!document.querySelector(".discovery-title-card button")'));
            await preview.webContents.executeJavaScript('document.querySelector(".discovery-title-card button").click()');
            await until('visual episode selection',()=>preview.webContents.executeJavaScript('document.querySelectorAll("#discoveryEpisodes a").length===2'));
            await delay(500);
            fs.writeFileSync(path.join(output,'catalog-episodes-desktop.png'),(await preview.webContents.capturePage()).toPNG());
            preview.setSize(390,844);await delay(500);
            assert.ok(await preview.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth+1'));
            fs.writeFileSync(path.join(output,'catalog-episodes-mobile.png'),(await preview.webContents.capturePage()).toPNG());
            console.log('CATALOG VISUAL PASS: desktop/mobile episode picker and no horizontal overflow.');
        } finally {preview.destroy();}
    } finally {for(const c of clients)if(!c.win.isDestroyed())c.close();}
};
