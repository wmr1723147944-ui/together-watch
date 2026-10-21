'use strict';
// Real Windows client + Android's packaged JS adapter in a separate Chromium
// view, with the real local room server. This is NOT a physical WebView test.
const {BrowserWindow, net} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {setTimeout:delay} = require('node:timers/promises');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const agent = read('desktop-app/src/player-agent.js');
const wrapper = read('android-app/app/src/main/assets/android-web-sync.js');
const layout = read('android-app/app/src/main/assets/android-page-layout.js');
const catalog = read('static/js/catalog-adapters.js');
// Same source composition as WebPlayerScripts.sample (also covered by JUnit).
const sampleScript = wrapper+';window.__twAndroidPage.sample(function(target){const window=target,document=target.document;\n'+agent+'\n})';
const page = 'https://www.kanju.ai/player/variant%3Acsp-fixture?episode=episode%3A1';
const csp = "default-src 'self'; script-src 'self' https:; style-src 'self' 'unsafe-inline'; media-src 'self' blob: https:; frame-src https:";

exports.run = async ({createDesktop,server,output,until}) => {
    let host, phone, room, stopped=false, polling=null, pollError=null, applied=false, bridgeRevision=1;
    const fixture = async request => {
        const u=new URL(request.url);
        if(!['www.kanju.ai','child.example.test'].includes(u.hostname))return new Response('blocked',{status:404});
        if(u.pathname==='/sample.mp4'){
            const r=await net.fetch(server+'/test-media.mp4',{headers:request.headers.has('range')?{range:request.headers.get('range')}:{}});
            return new Response(r.body,{status:r.status,headers:r.headers});
        }
        if(u.pathname==='/controls.js')return new Response(`
            document.addEventListener('keydown',e=>{
              const v=document.querySelector('video');if(!v)return;
              if(e.key==='p')v.play();if(e.key==='k')v.pause();
              if(e.key==='j'){v.pause();v.currentTime=10;}
              if(e.key==='l'){v.pause();v.currentTime=20;}
            });`,{headers:{'Content-Type':'text/javascript'}});
        const video='<video controls muted preload="auto" src="/sample.mp4" style="width:100%;aspect-ratio:16/9"></video>';
        let html;
        if(['/same','/cross'].includes(u.pathname)){
            html=`<iframe width="350" height="230" src="${u.pathname==='/cross'?'https://child.example.test':''}/child"></iframe>`;
        } else if(u.pathname==='/empty')html='<p>No video</p>';
        else if(u.pathname==='/child')html=video+'<script src="/controls.js"></script>';
        else html=`<meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{margin:0;background:#111;color:white}.movie-player-shell-layout-grid{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:8px}.movie-player-frame-region{min-width:0}</style>
            <div class="movie-player-shell-layout-grid">
              <div class="movie-player-frame-region">${video}</div>
              <aside class="movie-player-sidebar"><h2>Local layout fixture</h2><button data-directory-episode="episode:1" class="movie-button-primary">第1集</button></aside>
            </div><script src="/controls.js"></script>`;
        return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});
    };
    const focus = async wc => {
        wc.debugger.attach('1.3');
        await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
    };
    const key = async (wc,key) => {
        await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key,code:'Key'+key.toUpperCase(),windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)});
        await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key,code:'Key'+key.toUpperCase(),windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)});
    };
    const state = wc => wc.executeJavaScript('({time:document.querySelector("video").currentTime,paused:document.querySelector("video").paused})');
    const wait = (label,fn) => until(label,async()=>{if(pollError)throw pollError;return fn();});
    try {
        host=await createDesktop({server,visible:false});
        await host.start({nickname:'Windows CSP fixture',consent:true});
        await host.state().discoveryView.webContents.session.protocol.handle('https',fixture);
        assert.ok((await host.start({nickname:'Windows CSP fixture',source:page,consent:true})).ok);
        const hostVideo=host.state().video.webContents;
        await focus(hostVideo);
        await wait('Windows player',()=>!!host.state().selected);
        await wait('Windows sync',()=>host.state().roomView.webContents.executeJavaScript('document.getElementById("mobilePlayerStatus").textContent.includes("同步已连接")'));
        await key(hostVideo,'j');
        await wait('host paused at 10',async()=>{const s=await state(hostVideo);return s.paused&&Math.abs(s.time-10)<1;});
        const id=host.state().current.room;
        const program=await(await fetch(server+'/api/watch-rooms/'+id+'/program')).json();
        assert.equal(program.program.page,page);
        phone=new BrowserWindow({show:false,width:390,height:300,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'android-csp-video'}});
        room=new BrowserWindow({show:false,width:390,height:500,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'android-csp-room'}});
        const pv=phone.webContents, rv=room.webContents;
        await pv.session.protocol.handle('https',fixture);
        rv.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith(server+'/')&&!details.url.startsWith(server.replace('http:','ws:')+'/')}));
        await phone.loadURL(program.program.page);
        await focus(pv);
        assert.equal(await pv.executeJavaScript('(()=>{try{eval("1");return false;}catch(e){return e.name==="EvalError";}})()'),true);
        await pv.executeJavaScript(layout);
        await pv.executeJavaScript(catalog+';'+wrapper);
        assert.equal(await pv.executeJavaScript('window.__twAndroidPage.confirm("kanju","ep-episode:1")'),true);
        const bounds=await pv.executeJavaScript(`(()=>{const v=document.querySelector('video').getBoundingClientRect(),s=document.querySelector('aside').getBoundingClientRect();return {width:v.width,sideTop:s.top,videoBottom:v.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1};})()`);
        assert.ok(bounds.width>330,JSON.stringify(bounds));assert.ok(bounds.sideTop>=bounds.videoBottom-1);assert.equal(bounds.overflow,false);
        await delay(250); // let the hidden offscreen surface paint the new layout
        fs.writeFileSync(path.join(output,'android-kanju-narrow-layout.png'),(await pv.capturePage()).toPNG());
        await room.loadURL(server);
        await rv.executeJavaScript("localStorage.setItem('tw_username','Android adapter fixture');localStorage.setItem('tw_legal_notice_version','2026-07-28')");
        await room.loadURL(server+'/mobile-room/'+id);
        await wait('phone room bridge',()=>rv.executeJavaScript('!!window.TogetherWatchMobile?.program()'));
        async function poll() {
            if(stopped)return;
            try{
                const raw=await pv.executeJavaScript(sampleScript);
                // Match PlaybackBoundary session mapping. Java field allowlisting
                // and generation rejection are tested separately in JUnit.
                const s={...raw,session:'web-1-'+raw.session};
                const result=await rv.executeJavaScript(`(()=>{const b=window.TogetherWatchMobile;${!applied&&bridgeRevision?'b.applyProgram('+bridgeRevision+');':''}b.receive(${JSON.stringify(s)});return b.drain();})()`);
                applied=true;
                for(const command of result.commands||[]){
                    if(command.session!==s.session)continue;
                    await pv.executeJavaScript('window.__twAndroidPage.apply('+JSON.stringify({...command,session:raw.session})+')');
                }
            }catch(e){if(!stopped)pollError=e;}
        }
        polling=(async()=>{while(!stopped&&!pollError){await poll();await delay(300);}})();
        await wait('phone catches paused host',async()=>{const s=await state(pv);return s.paused&&Math.abs(s.time-10)<1;});
        await key(hostVideo,'p');
        await wait('Windows play reaches Android adapter',async()=>{const s=await state(pv);return !s.paused&&s.time>11;});
        await key(pv,'l');
        await wait('Android pause/seek reaches Windows',async()=>{const s=await state(hostVideo);return s.paused&&Math.abs(s.time-20)<1;});
        await key(pv,'p');
        await wait('Android play reaches Windows',async()=>!(await state(hostVideo)).paused);
        await key(hostVideo,'j');
        await wait('Windows pause/seek reaches Android',async()=>{const s=await state(pv);return s.paused&&Math.abs(s.time-10)<1;});
        // A page reload must acquire a new bridge/player and the room position.
        stopped=true;await polling;
        await phone.loadURL(page);
        await pv.executeJavaScript(layout);
        applied=false;stopped=false;
        polling=(async()=>{while(!stopped&&!pollError){await poll();await delay(300);}})();
        await wait('Android adapter reacquires after reload',async()=>{const s=await state(pv);return s.paused&&Math.abs(s.time-10)<1;});
        stopped=true;await polling;
        for(const route of ['/same','/cross','/empty']){
            await phone.loadURL('https://www.kanju.ai'+route);
            const raw=await pv.executeJavaScript(sampleScript);
            if(route==='/same')assert.equal(raw.active,true);
            else assert.equal(raw.reason,route==='/cross'?'cross_origin_frame':'no_video');
        }
        // Reverse the roles. Android finds the current episode on the original
        // page, creates the program via HTTP, and Windows enters just its ID.
        await host.action('settings');
        await phone.loadURL('https://www.kanju.ai/player/variant%3Acsp-fixture');
        await pv.executeJavaScript(catalog+';'+wrapper);
        const episode=await pv.executeJavaScript('window.__twAndroidPage.currentEpisode("kanju")');
        assert.equal(episode,'ep-episode:1');
        const createdResponse=await fetch(server+'/api/watch-rooms',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({selection:{source:'kanju',item:'variant:csp-fixture',episode}})});
        assert.equal(createdResponse.status,201);
        const created=await createdResponse.json(), androidId=created.room;
        await phone.loadURL(created.program.page);
        await pv.executeJavaScript(catalog+';'+wrapper);
        assert.equal(await pv.executeJavaScript('window.__twAndroidPage.confirm("kanju",'+JSON.stringify(episode)+')'),true);
        await room.loadURL(server+'/mobile-room/'+androidId);
        await wait('Android-created room program ready',()=>rv.executeJavaScript('!!window.TogetherWatchMobile?.program()'));
        applied=false;stopped=false;bridgeRevision=created.revision;
        polling=(async()=>{while(!stopped&&!pollError){await poll();await delay(300);}})();
        await wait('Android host controls connected',()=>rv.executeJavaScript('document.getElementById("mobilePlayerStatus").textContent.includes("同步已连接")'));
        await key(pv,'j');
        await wait('Android host timeline established',async()=>{const s=await state(pv);return s.paused&&Math.abs(s.time-10)<1;});
        await delay(800);
        // Exercise the visible Windows form, not only its internal start API.
        await host.win.webContents.executeJavaScript(`document.getElementById('room').value=${JSON.stringify(androidId)};
            document.getElementById('room').dispatchEvent(new Event('input'));document.getElementById('source').value='';
            document.getElementById('consent').checked=true;document.getElementById('startForm').requestSubmit();`);
        await wait('bare room number joins Android host',()=>host.state().current?.room===androidId&&!!host.state().selected);
        const guestVideo=host.state().video.webContents;await focus(guestVideo);
        await wait('Windows catches Android host pause and position',async()=>{const s=await state(guestVideo);return s.paused&&Math.abs(s.time-10)<1;});
        await key(pv,'p');
        await wait('Android host play reaches Windows guest',async()=>!(await state(guestVideo)).paused);
        await key(guestVideo,'l');
        await wait('Windows guest seek/pause reaches Android host',async()=>{const s=await state(pv);return s.paused&&Math.abs(s.time-20)<1;});
        const rejoined=await host.start({nickname:'Windows query invite',room:server+'/?room='+androidId,consent:true});
        assert.equal(rejoined.ok,true,rejoined.error);assert.equal(host.state().current.room,androidId);
        await wait('query invite keeps Android room position',async()=>{const s=await state(host.state().video.webContents);return s.paused&&Math.abs(s.time-20)<1;});
        const missing=await host.start({nickname:'missing room',room:'0'.repeat(24),consent:true});
        assert.equal(missing.ok,false);assert.equal(host.state().current.room,androidId,'failed join must not silently create another room');
        stopped=true;await polling;
        // Compatibility rooms must also use the compiled local bridge (no
        // bookmarklet popup and no program revision). This used to be skipped.
        const legacy='legacy-android-host-fixture';
        await room.loadURL(server+'/mobile-room/'+legacy);
        await wait('legacy Android bridge ready',()=>rv.executeJavaScript('!!window.TogetherWatchMobile'));
        applied=false;bridgeRevision=0;stopped=false;
        polling=(async()=>{while(!stopped&&!pollError){await poll();await delay(300);}})();
        const legacyJoin=await host.start({nickname:'legacy Windows guest',room:legacy,source:page,consent:true});
        assert.equal(legacyJoin.ok,true,legacyJoin.error);assert.equal(host.state().current.room,legacy);
        await wait('legacy Windows player ready',()=>!!host.state().selected);
        await wait('legacy Android connected',()=>rv.executeJavaScript('document.getElementById("mobilePlayerStatus").textContent.includes("同步已连接")'));
        await key(pv,'j');
        await wait('legacy Android pause/seek reaches Windows',async()=>{const s=await state(host.state().video.webContents);return s.paused&&Math.abs(s.time-10)<1;});
        console.log('ANDROID HOST PASS: selected episode -> create -> Windows visible form with bare room ID; bidirectional playback; query invite joins same room; missing room never creates a replacement; legacy Android local bridge syncs. Chromium adapter, not a physical Android test.');
        console.log('ANDROID WEB PASS: strict CSP preserved, compiled frame-local injection, invite-only program, bidirectional play/pause/seek with Windows, reload reacquisition, narrow layout, same-origin frame and explicit cross-origin limitation. Chromium fixture, not physical Android.');
    } finally {
        stopped=true;if(polling)await polling;
        for(const w of [phone,room])if(w&&!w.isDestroyed())w.destroy();
        if(host&&!host.win.isDestroyed())host.close();
    }
};
