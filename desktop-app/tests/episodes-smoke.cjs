'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {net,BrowserWindow}=require('electron');
const {setTimeout:delay}=require('node:timers/promises');
exports.run=async({createDesktop,server,output,until})=>{
    const clients=[];let preview;
    async function capture(wc,name) {
        let timer;
        // Visual QA uses an offscreen compositor. Hidden native-fullscreen
        // views can have no capturable display surface on Windows.
        const image=await Promise.race([wc.capturePage(),
            new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Picker screenshot timed out')),10000);})]).finally(()=>clearTimeout(timer));
        fs.writeFileSync(path.join(output,name),image.toPNG());
    }
    const media=async request=>{
        const r=await net.fetch(server+'/test-media.mp4',{headers:request.headers.has('range')?{range:request.headers.get('range')}:{}});
        return new Response(r.body,{status:r.status,headers:r.headers});
    };
    async function client(name,room='') {
        const c=await createDesktop({server,visible:false});clients.push(c);
        // Intercept only this test's independent source partition. No remote
        // catalogue or media is queried by the fixture.
        await c.start({nickname:name,consent:true});
        await c.action('kanju');
        await c.state().discoveryView.webContents.session.protocol.handle('https',async request=>{
            if(request.url.startsWith('https://media.w3.org/'))return media(request);
            return new Response(`<style>body{margin:0}video{width:100%;height:90vh}</style><video controls muted src="https://media.w3.org/2010/05/sintel/trailer.mp4"></video>
                ${[1,2,3].map(n=>`<span class="play-btn ${n===1?'on':''}" ep_slug="ep${n}" onclick="document.querySelectorAll('.play-btn').forEach(e=>e.classList.remove('on'));this.classList.add('on')">第${n}集</span>`).join('')}`,{headers:{'content-type':'text/html'}});
        });
        const result=await c.start({nickname:name,consent:true,...(room?{room}:{source:server+'/discover/play/cupfox/12/ep1'})});
        assert.equal(result.ok,true,result.error);
        await until(name+' player ready',()=>!!c.state().selected);
        return c;
    }
    const readProgram=async room=>(await(await fetch(server+'/api/watch-rooms/'+room+'/program')).json());
    try {
        console.log('EPISODES: creating host and guest');
        const host=await client('host'),room=host.state().current.room,roomView=host.state().roomView;
        const guest=await client('guest',room);
        console.log('EPISODES: clients ready; opening built-in player');
        assert.equal(await guest.action('episodes'),false,'guest cannot change room programme');
        assert.equal(await guest.state().video.webContents.executeJavaScript('typeof window.twPlayer'),'undefined');
        await host.action('scan-media');
        const choices=await host.win.webContents.executeJavaScript('Array.from(document.getElementById("mediaChoices").options).map(o=>o.value).filter(Boolean)');
        assert.ok(choices.length);
        await host.state().mediaSession.protocol.handle('https',media);
        assert.equal((await host.action({type:'play-media',id:choices[0]})).ok,true);
        const player=host.state().builtin.webContents;
        console.log('EPISODES: built-in player ready; entering fullscreen');
        assert.equal(await player.executeJavaScript('typeof window.desktop'),'undefined');
        assert.equal(await player.executeJavaScript('typeof window.twPlayer.episodes'),'function');
        await player.executeJavaScript('document.getElementById("player-fullscreen").click()',true);
        await until('native fullscreen event',()=>host.state().full);
        console.log('EPISODES: fullscreen ready; opening drawer');
        await player.executeJavaScript('document.dispatchEvent(new MouseEvent("mousemove"))');
        assert.ok(await player.executeJavaScript('!document.getElementById("episodes").disabled && getComputedStyle(document.querySelector("footer")).opacity==="1"'));
        await delay(2700);
        assert.equal(await player.executeJavaScript('getComputedStyle(document.querySelector("footer")).opacity'),'0','fullscreen controls auto-hide');
        await player.executeJavaScript('document.getElementById("episodes").click()');
        await until('episode dialog',()=>host.state().episodeView?.webContents.executeJavaScript('document.querySelectorAll("#discoveryEpisodes a").length===3'));
        let finder=host.state().episodeView.webContents;
        assert.equal(host.state().full,true);assert.equal(host.state().browsing,false);
        assert.equal(host.state().builtin.webContents,player);assert.equal(host.state().builtin.getVisible(),true);
        assert.equal(host.state().current.room,room);assert.equal(host.state().roomView,roomView);
        assert.equal(await finder.executeJavaScript('document.querySelector("#discoveryEpisodes [aria-current]").getAttribute("href")'),'/discover/play/cupfox/12/ep1');
        await finder.executeJavaScript('document.querySelector("#discoveryEpisodes [aria-current]").click()');await delay(300);
        assert.equal((await readProgram(room)).revision,1,'clicking current episode must not restart timeline');
        await finder.executeJavaScript('document.getElementById("discoveryDetailClose").click()');
        await until('drawer closes in place',()=>!host.state().episodeView);
        console.log('EPISODES: drawer closed in place; switching episode');
        assert.equal(host.state().full,true);assert.equal(host.state().builtin.webContents,player);assert.equal(host.state().browsing,false);
        await host.action('episodes');finder=host.state().episodeView.webContents;
        await until('reopened drawer',()=>finder.executeJavaScript('document.querySelectorAll("#discoveryEpisodes a").length===3'));
        // The click closes its own WebContents after the room update. Return
        // the evaluation result before navigation destroys its reply channel.
        await finder.executeJavaScript('setTimeout(()=>document.querySelectorAll("#discoveryEpisodes a")[1].click(),100);true');
        await until('host second episode',async()=>(await readProgram(room)).program.episode==='ep2');
        await until('guest second episode',()=>guest.state().video.webContents.executeJavaScript('document.querySelector(".play-btn.on")?.getAttribute("ep_slug")==="ep2"'));
        assert.equal(host.state().current.room,room);assert.equal(host.state().roomView,roomView);assert.equal(guest.state().current.room,room);
        assert.equal((await readProgram(room)).revision,2);
        console.log('EPISODES: guest follows; narrow layout and back');
        await host.action('episodes');
        finder=host.state().episodeView.webContents;
        await until('new current highlight',()=>finder.executeJavaScript('document.querySelector("#discoveryEpisodes [aria-current]")?.getAttribute("href")==="/discover/play/cupfox/12/ep2"'));
        // The same first-party picker is invoked by Android; verify narrow layout
        // independently of desktop native frame minimum sizes.
        const debug=finder.debugger;if(!debug.isAttached())debug.attach('1.3');
        await debug.sendCommand('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        await delay(300);
        console.log('PICKER METRICS',await finder.executeJavaScript('({width:innerWidth,dialog:document.getElementById("discoveryDetail").getBoundingClientRect().toJSON(),sizing:getComputedStyle(document.getElementById("discoveryDetail")).boxSizing,viewport:document.querySelector("meta[name=viewport]").content})'));
        assert.ok(await finder.executeJavaScript('document.getElementById("discoveryDetail").getBoundingClientRect().width<=innerWidth+1 && document.documentElement.scrollWidth<=innerWidth+1'));
        await host.action('back');
        assert.equal(host.state().episodeView,null);
        assert.equal(host.state().current.room,room);assert.equal(host.state().browsing,false);
        preview=new BrowserWindow({show:false,width:420,height:800,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'episode-visual-'+process.pid}});
        preview.webContents.session.webRequest.onBeforeRequest((request,cb)=>cb({cancel:!request.url.startsWith(server+'/')}));
        await preview.loadURL(server+'/discover?picker=1');
        await preview.webContents.executeJavaScript('TogetherWatchCatalogNavigation.episodes({source:"cupfox",item:"12",episode:"ep2"})');
        await until('offscreen episode layout',()=>preview.webContents.executeJavaScript('document.querySelectorAll("#discoveryEpisodes a").length===3'));
        await delay(300);await capture(preview.webContents,'player-episodes-desktop.png');
        preview.setSize(390,844);await delay(300);await capture(preview.webContents,'player-episodes-mobile.png');
        console.log('EPISODES PASS: in-player drawer, stays fullscreen, original player retained, close/back without leaving playback, no reset on current, same-room ep2, guest follows, 390px picker.');
    } finally {if(preview && !preview.isDestroyed())preview.destroy();for(const c of clients)if(!c.win.isDestroyed())c.close();}
};
