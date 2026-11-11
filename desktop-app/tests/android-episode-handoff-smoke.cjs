'use strict';
// Real Chromium media elements + public-style DOM. All responses are local fixtures.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..'),asset=n=>fs.readFileSync(path.join(root,n),'utf8');
let win;
app.setPath('userData',path.join(app.getPath('temp'),'tw-episode-handoff-'+process.pid));
async function until(name,fn){const end=Date.now()+12000;while(Date.now()<end){if(await fn())return;await delay(100);}throw Error('Timeout: '+name);}
async function run(){
    const media=fs.readFileSync(path.join(root,'.review-artifacts/desktop-smoke/inline-150s.mp4'));
    win=new BrowserWindow({show:false,width:900,height:500,webPreferences:{offscreen:true,backgroundThrottling:false,nodeIntegration:false,contextIsolation:true,partition:'episode-handoff-'+process.pid}});
    const wc=win.webContents,js=c=>wc.executeJavaScript(c);
    await wc.session.protocol.handle('https',request=>{
        const u=new URL(request.url);
        if(!['www.kanju.ai','www.pkavi.com','www.233dm.com','www.cupfox.in','yhdmoe.com'].includes(u.host))throw Error('Unexpected external request');
        if(u.pathname.endsWith('.mp4')){
            const range=/bytes=(\d+)-(\d*)/.exec(request.headers.get('range')||'');
            const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),media.length-1):media.length-1;
            return new Response(media.subarray(start,end+1),{status:range?206:200,headers:{'Content-Type':'video/mp4','Accept-Ranges':'bytes',
                'Content-Length':String(end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${media.length}`}:{})}});
        }
        return new Response(`<!doctype html><h1>本地切集回归测试</h1>
            <video controls preload="auto" style="width:640px;height:360px" src="/last.mp4"></video>
            <button data-directory-episode="five" title="第5集">5</button>
            <button data-directory-episode="last" title="第30集" class="movie-button-primary">30</button>
            <script>window.selectEpisode=id=>{document.querySelectorAll('button').forEach(b=>b.classList.toggle('movie-button-primary',b.dataset.directoryEpisode===id));};
            document.querySelectorAll('button').forEach(b=>b.onclick=()=>selectEpisode(b.dataset.directoryEpisode));</script>`,{headers:{'Content-Type':'text/html; charset=utf-8'}});
    });
    await win.loadURL('https://www.kanju.ai/player/drama?episode=five');
    await until('default episode metadata',()=>js('document.querySelector("video").duration>=120'));
    await js(asset('static/js/catalog-adapters.js')+';'+asset('android-app/app/src/main/assets/android-web-sync.js')+';'+asset('android-app/app/src/main/assets/episode-media-guard.js'));
    const productionScript=require('./java-player-script.cjs')({source:'kanju',item:'drama',episode:'ep-five'});
    const broken=productionScript.replace('function(){return (\n','function(){return ').replace('\n);})',';})');
    await assert.rejects(()=>js(broken),'0.3.35/36 bare return followed by asset comment/newline loses the scan');
    const scan=()=>js(productionScript);
    assert.equal((await scan()).episodeMatched,false);
    assert.equal(await js('window.__twAndroidPage.confirm("kanju","ep-five")'),false);
    assert.equal(await js('window.__twAndroidPage.confirm("kanju","ep-five")'),true);
    await delay(1650);assert.equal((await scan()).candidates.length,0,'UI is fifth but final-episode media must not escape');
    await js('document.querySelector("video").src="/fifth.mp4"');
    await until('requested media metadata',()=>js('document.querySelector("video").currentSrc.endsWith("/fifth.mp4")&&document.querySelector("video").readyState>=1'));
    assert.equal((await scan()).episodeSettled,false);await delay(1650);
    assert.equal((await scan()).candidates[0].url,'https://www.kanju.ai/fifth.mp4');
    // The source changes again between detection and the native handoff.
    await js('selectEpisode("last");document.querySelector("video").src="/last.mp4"');
    assert.equal((await scan()).episodeMatched,false,'final handoff must reject the late default restore');
    await js('selectEpisode("five");document.querySelectorAll("button").forEach(b=>b.classList.add("movie-button-primary"))');
    assert.equal((await scan()).episodeMatched,false,'ambiguous mobile/desktop directory markers');
    for(const [source,item,episode,url,marker] of [
        ['pkavi','12','1-2','https://www.pkavi.com/py/12-1-2.html',''],
        ['233dm','0123456789abcdef01234567','1-2','https://www.233dm.com/anime/0123456789abcdef01234567/play/1/2.html',''],
        ['cupfox','12','ep2','https://www.cupfox.in/vod-detail/12.html','<span class="play-btn on" ep_slug="ep2">第2集</span>'],
        ['yhdmoe','12','EP2','https://yhdmoe.com/watch/12','<a class="my-episode disabled" play_ep="EP2">第2集</a>']
    ]) {
        await win.loadURL(url);await js('document.body.insertAdjacentHTML("beforeend",'+JSON.stringify(marker)+')');
        await until(source+' decoded metadata',()=>js('document.querySelector("video").readyState>=1'));
        const code=require('./java-player-script.cjs')({source,item,episode});
        assert.equal((await js(code)).episodeMatched,true,source);await delay(1650);
        assert.equal((await js(code)).candidates.length,1,source+' production scan');
    }
    console.log('PASS real DOM/media: target button, delayed video switch, stable correct media, late last-episode restore, ambiguous markers.');
}
app.whenReady().then(run).then(()=>{win?.destroy();app.exit(0);}).catch(e=>{console.error(e);win?.destroy();app.exit(1);});
