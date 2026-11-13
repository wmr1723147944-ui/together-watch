'use strict';
const assert=require('node:assert/strict');
const {net}=require('electron');
const {setTimeout:delay}=require('node:timers/promises');
// All HTTPS handlers are isolated test partitions, backed by our local MP4.
// The failed HLS manifest simulates a decoder path the original can play.
exports.run=async({createDesktop,server,until})=>{
    const clients=[];
    async function client(name,room=''){
        const testMediaFetch=async url=>({url,status:200,headers:{'content-type':'application/vnd.apple.mpegurl'},body:new Response('not a manifest').body});
        const c=await createDesktop({server,visible:false,testMediaFetch});clients.push(c);
        await c.start({nickname:name,consent:true});await c.action('kanju');
        await c.state().discoveryView.webContents.session.protocol.handle('https',async request=>{
            const u=new URL(request.url);
            if(u.hostname==='fixture.example.com'){
                const r=await net.fetch(server+'/test-media.mp4');const headers=new Headers(r.headers);headers.set('access-control-allow-origin','*');
                return new Response(r.body,{status:r.status,headers});
            }
            if(u.hostname!=='www.kanju.ai' && u.hostname!=='kanju.ai')return new Response('',{status:404});
            const ep=u.searchParams.get('episode')||'av_ep1';
            return new Response(`<style>body{margin:0}video{width:100%;height:70vh}</style><div id="ad">unrelated site panel</div>
                <video controls muted preload="auto"></video><button data-directory-episode="${ep}" class="movie-button-primary">第${ep.endsWith('1')?'1':'2'}集</button>
                <script>(async()=>{const v=document.querySelector('video');
                    const blob=await(await fetch('https://fixture.example.com/clip.mp4')).blob();v.src=URL.createObjectURL(blob);
                    ${name==='hls' ? 'window.hls={media:v,url:"https://fixture.example.com/failed.m3u8"};' : ''}
                })();</script>`,{headers:{'content-type':'text/html','access-control-allow-origin':'*'}});
        });
        // The real original decoder has video data, but the anonymous transfer
        // receives an invalid playlist. Keep CORS enabled in production.
        await c.state().mediaSession.protocol.handle('https',()=>new Response('not a manifest',{headers:{'access-control-allow-origin':'*','content-type':'application/vnd.apple.mpegurl'}}));
        assert.equal((await c.start({nickname:name,consent:true,...(room?{room}:{source:server+'/discover/play/kanju/av_fixture/ep-av_ep1'})})).ok,true);
        await until('fixture metadata',()=>c.state().video.webContents.executeJavaScript('document.querySelector("video")?.readyState>=2'));
        assert.ok(await c.state().video.webContents.executeJavaScript('document.querySelector("video").duration>=120'),'TW_SMOKE_MEDIA must be a real seekable MP4 of at least 120 seconds');
        try{await until(name+' automatically adopted',()=>c.state().inline && !!c.state().selected,35000);}
        catch(error){
            console.log('INLINE DIAGNOSTIC',name,await c.win.webContents.executeJavaScript('({status:document.getElementById("status").textContent,gate:document.getElementById("gateText").textContent})'),
                await c.state().video.webContents.executeJavaScript('(()=>{const v=document.querySelector("video");return {path:location.pathname,query:location.search,blob:v?.currentSrc.startsWith("blob:"),ready:v?.readyState,duration:v?.duration,error:v?.error?.code,mark:v?.getAttribute("data-tw-inline"),ep:document.querySelector("button")?.getAttribute("data-directory-episode")};})()'));
            throw error;
        }
        const wc=c.state().video.webContents;
        assert.ok(await wc.executeJavaScript('document.querySelector("video").videoWidth>0'),'real frames decoded');
        assert.equal(await wc.executeJavaScript('getComputedStyle(document.getElementById("ad")).visibility'),'hidden');
        assert.equal(await wc.executeJavaScript('getComputedStyle(document.querySelector("video")).visibility'),'visible');
        assert.equal(await wc.executeJavaScript('typeof window.desktop'),'undefined');
        assert.equal(c.state().builtin,null);
        console.log('INLINE READY: '+name);
        wc.debugger.attach('1.3');await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
        return c;
    }
    async function control(c,script){
        const wc=c.state().video.webContents;
        await wc.executeJavaScript(`document.addEventListener('keydown',()=>{${script}},{once:true});true`);
        await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'q',code:'KeyQ',windowsVirtualKeyCode:81});
        await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'q',code:'KeyQ',windowsVirtualKeyCode:81});
    }
    try{
        const a=await client('blob'),room=a.state().current.room,b=await client('hls',room);
        const aw=a.state().video.webContents,bw=b.state().video.webContents;
        await control(a,'const v=document.querySelector("video");v.currentTime=8;v.play()');
        await until('compatible room playback advances',()=>bw.executeJavaScript('document.querySelector("video").currentTime>9 && !document.querySelector("video").paused'));
        await control(b,'const v=document.querySelector("video");v.currentTime=17;v.pause()');
        await until('compatible reverse seek/pause',()=>aw.executeJavaScript('Math.abs(document.querySelector("video").currentTime-17)<1 && document.querySelector("video").paused'));
        await a.toggleFullscreen(true);assert.equal(a.state().full,true);await a.toggleFullscreen(false);
        await a.action({type:'source',source:server+'/discover/play/kanju/av_fixture/ep-av_ep2'});
        await until('compatible guest follows episode',()=>b.state().inline && bw.getURL().includes('episode=av_ep2'),35000);
        assert.equal(a.state().current.room,room);assert.equal(b.state().current.room,room);
        assert.equal(await bw.executeJavaScript('getComputedStyle(document.getElementById("ad")).visibility'),'hidden');
        // A removed video must fail closed, with no flash of the rest of the page.
        await bw.executeJavaScript('document.querySelector("video").remove();true');await delay(1600);
        assert.equal(b.state().inline,false);assert.equal(b.state().video.getVisible(),false);
        await a.action('original');
        assert.equal(a.state().inline,false);assert.equal(a.state().video.getVisible(),true);
        try{await until('explicit original restores page',()=>aw.executeJavaScript('getComputedStyle(document.getElementById("ad")).visibility==="visible"'));}
        catch(error){console.log('RESTORE STATE',a.state().inline,await aw.executeJavaScript('({ad:getComputedStyle(document.getElementById("ad")).visibility,video:getComputedStyle(document.querySelector("video")).visibility,mark:document.querySelector("video").getAttribute("data-tw-inline"),sheets:document.styleSheets.length})'));throw error;}
        console.log('INLINE PASS: actual decode and clock, blob adoption, failed HLS fallback, no page panels, two-peer seek/play/pause, fullscreen, episode follow, fail-closed replacement, explicit original restore.');
    }finally{for(const c of clients)if(!c.win.isDestroyed())c.close();}
};
