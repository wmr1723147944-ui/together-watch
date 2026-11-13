'use strict';
// Real MSE/HLS frames, private ES module Hls instance and production preload.
// Every request is served from local fixtures. No third-party network traffic.
const {app,BrowserWindow,protocol}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const mediaDir=process.env.TW_HLS_FIXTURE||path.join(root,'.review-artifacts/handoff-hls');
app.setPath('userData',path.join(app.getPath('temp'),'tw-bindings-'+process.pid));
const {MediaTransport}=require('../src/media-transport.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'tw-app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let win,native;
async function until(label,fn){for(let i=0;i<150;i++){if(await fn())return;await delay(100);}throw Error('Timeout '+label);}
async function run(){
    assert.ok(fs.existsSync(path.join(mediaDir,'index.m3u8')),'Set TW_HLS_FIXTURE to a local HLS fixture directory (see NATIVE_MEDIA_HANDOFF_2026-11-13.md).');
    win=new BrowserWindow({show:false,width:900,height:600,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,
        partition:'bindings-'+process.pid,preload:path.join(root,'desktop-app/src/media-preload.cjs')}});
    const wc=win.webContents,js=code=>wc.executeJavaScript(code);
    await wc.session.protocol.handle('https',req=>{
        const u=new URL(req.url);assert.equal(u.host,'www.kanju.ai','no external requests');
        let body,mime='text/html';
        if(u.pathname==='/assets/hls-fixture.js'){
            body='const module={exports:{}},exports=module.exports;'+read('static/vendor/hls-1.5.18.min.js')+'\nexport const Hls=module.exports;export default Hls;';mime='text/javascript';
        }else if(u.pathname.endsWith('.m3u8')){body=fs.readFileSync(path.join(mediaDir,'index.m3u8'),'utf8');mime='application/vnd.apple.mpegurl';}
        else if(u.pathname.endsWith('.ts')){body=fs.readFileSync(path.join(mediaDir,path.basename(u.pathname)));mime='video/mp2t';}
        else body=`<!doctype html><h1>测试剧</h1><video id="v" style="width:640px;height:360px" muted></video>
            <button data-directory-episode="five" class="movie-button-primary">第5集</button><button data-directory-episode="six">第6集</button>
            <script type="module">import Hls from '/assets/hls-fixture.js';
            const h=new Hls({enableWorker:false});h.loadSource('/five.m3u8');h.attachMedia(v);
            const prewarm=new Hls({enableWorker:false});prewarm.loadSource('/last.m3u8');
            window.testNext=()=>{document.querySelectorAll('button').forEach(b=>b.classList.toggle('movie-button-primary',b.dataset.directoryEpisode==='six'));h.destroy();const next=new Hls({enableWorker:false});next.loadSource('/six.m3u8');next.attachMedia(v);};
            </script>`;
        return new Response(body,{headers:{'Content-Type':mime}});
    });
    await win.loadURL('https://www.kanju.ai/player/show?episode=five');
    await until('private ESM instance and decoded metadata',()=>js(`(()=>{const v=document.querySelector('video');return v.readyState>=2&&window.__twMediaBindings?.read(v).length===1})()`));
    assert.equal(await js('typeof require'), 'undefined');
    assert.equal(await js('typeof window.Hls'), 'undefined','must discover private runtime, not a global');
    const adapter=read('static/js/catalog-adapters.js'),guard=read('android-app/app/src/main/assets/episode-media-guard.js'),scan=read('android-app/app/src/main/assets/media-discovery.js');
    const program={source:'kanju',item:'show',episode:'ep-five'};
    const sample=p=>js(adapter+';'+guard+';window.__twEpisodeMediaGuard.read('+JSON.stringify(p)+',()=>('+scan+'))');
    await sample(program);await delay(1650);
    const result=await sample(program);
    assert.equal(result.episodeSettled,true);assert.equal(result.candidates.length,1);
    assert.equal(result.candidates[0].url,'https://www.kanju.ai/five.m3u8','preloaded last episode is never selected');
    assert.equal(result.candidates[0].mime,'application/x-mpegURL');
    await js(read('desktop-app/src/media-handoff.js')+"('hold')");
    assert.equal(await js('document.querySelector("video").paused'),true);
    assert.equal((await sample(program)).candidates[0].url,'https://www.kanju.ai/five.m3u8','holding retains live blob binding');
    await js(read('desktop-app/src/media-handoff.js')+"('restore')");
    await js('testNext()');assert.equal((await sample(program)).episodeMatched,false);
    await until('next episode actual MSE',()=>js(`window.__twMediaBindings.read(document.querySelector('video')).some(x=>x.url.endsWith('/six.m3u8'))&&document.querySelector('video').readyState>=2`));
    const next={...program,episode:'ep-six'};await sample(next);await delay(1650);
    assert.equal((await sample(next)).candidates[0].url,'https://www.kanju.ai/six.m3u8');
    const transport=new MediaTransport(async url=>{
        const pathname=new URL(url).pathname,isList=pathname.endsWith('.m3u8');
        const body=fs.readFileSync(path.join(mediaDir,isList?'index.m3u8':path.basename(pathname)));
        return {url,status:200,headers:{'content-type':isList?'application/vnd.apple.mpegurl':'video/mp2t'},body:new Response(body).body};
    });
    native=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,partition:'native-fixture-'+process.pid}});
    const player=native.webContents;
    player.session.protocol.handle('tw-app',req=>{
        const u=new URL(req.url);if(u.pathname.startsWith('/media/'))return transport.handle(req);
        const name=u.pathname.slice(1);assert.ok(['player.html','player.css','player.js','hls.min.js'].includes(name));
        return new Response(read('desktop-app/ui/'+name),{headers:{'Content-Type':name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript'}});
    });
    await native.loadURL('tw-app://desktop/player.html');
    const local=transport.start({url:'https://www.kanju.ai/six.m3u8',kind:'hls'});
    await player.executeJavaScript('window.__twBuiltin.load('+JSON.stringify({url:local,kind:'hls'})+')');
    await until('independent player decodes real HLS',()=>player.executeJavaScript('document.querySelector("video").readyState>=2&&document.querySelector("video").getVideoPlaybackQuality().totalVideoFrames>0'));
    assert.equal((await player.executeJavaScript('window.__twBuiltin.state()')).error,'');
    console.log('PASS independent player: rewritten HLS playlist + segments -> decoded first frame through scoped local transport.');
    console.log('PASS private ESM HLS: decoded metadata; current-episode binding; ignored prewarm; safe hold/restore; episode 5 -> 6; no page Node/IPC.');
}
app.whenReady().then(run).then(()=>{win.destroy();native?.destroy();app.exit(0);}).catch(e=>{console.error(e);win?.destroy();native?.destroy();app.exit(1);});
