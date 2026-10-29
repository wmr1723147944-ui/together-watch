'use strict';
// Offline fixture regression: real catalogue renderer + Android queue bridge.
// This does not claim that any third-party site is reachable or playable.
const {app,BrowserWindow,nativeImage}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'.review-artifacts','mobile-search-0317');
let backend,win,log='';
async function until(fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(100);}throw Error('Timed out');}
async function run(){
    fs.mkdirSync(out,{recursive:true});const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
    const port=reserve.address().port;await new Promise(r=>reserve.close(r));const server='http://127.0.0.1:'+port;
    backend=spawn(process.env.TW_SMOKE_PYTHON||'python',['-u','-c',`
import app as module
import catalog_recommendations
def search(source, query):
    return dict(source_id=source, status='ok', results=[dict(title=query+label,year='2024',page_url=f'https://www.233dm.com/anime/{i+1:024x}.html',poster_url=f'https://image.tmdb.org/fixture-{i}.png') for i,label in enumerate([' 竖版海报',' 横版剧照',' 方形封面'])] if source=='233dm' else [])
module.search_provider=search
catalog_recommendations.load_page=lambda source,category,page: dict(source_id=source,category=category,page=page,status='ok',results=[],has_more=False,next_page=None)
module.app.run(host='127.0.0.1',port=${port},use_reloader=False)
`],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,APP_ENV:'development',SECRET_KEY:'search-recovery-fixture'}});
    backend.stderr.on('data',d=>log=(log+d).slice(-4000));backend.stdout.on('data',d=>log=(log+d).slice(-4000));
    await until(async()=>{try{return (await fetch(server+'/health')).ok;}catch{return false;}});
    win=new BrowserWindow({show:false,width:390,height:844,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,nodeIntegration:false,contextIsolation:true,partition:'mobile-search-recovery'}});
    const wc=win.webContents,js=s=>wc.executeJavaScript(s);
    const images=[[600,900],[1200,675],[600,600]].map(([width,height],i)=>{
        const buf=Buffer.alloc(width*height*4);for(let p=0;p<buf.length;p+=4){buf[p]=120+i*30;buf[p+1]=155;buf[p+2]=195-i*40;buf[p+3]=255;}
        return nativeImage.createFromBitmap(buf,{width,height}).toPNG();
    });
    await wc.session.protocol.handle('https',req=>{
        const u=new URL(req.url),m=/^\/fixture-([012])\.png$/.exec(u.pathname);
        return u.hostname==='image.tmdb.org'&&m?new Response(images[Number(m[1])],{headers:{'Content-Type':'image/png'}}):new Response('',{status:404});
    });
    await win.loadURL(server+'/discover');
    await js(fs.readFileSync(path.join(root,'android-app/app/src/main/assets/catalog-metadata-bridge.js'),'utf8'));
    await js(`window.testRequests=[];window.testPump=setInterval(()=>{
        const batch=__twMetadataQueue.drain();for(const r of batch.requests){testRequests.push(r);
            const reply=r.interactive && r.payload.source==='kanju'
                ? {status:'ok',results:[{title:'元气少女 原站回传测试',page_url:'https://www.kanju.ai/player/test-return',poster_url:'https://image.tmdb.org/fixture-0.png'}]}
                : {status:r.payload.source==='pkavi'?'verification_required':'unavailable'};
            __twMetadataQueue.complete(batch.token,r.id,reply);
        }
    },25);
    for(const c of document.querySelectorAll('[data-live-source]'))c.checked=['233dm','kanju','pkavi'].includes(c.dataset.liveSource);
    document.getElementById('discoveryQuery').value='元气少女';document.getElementById('discoveryForm').requestSubmit();`);
    await until(()=>js(`document.getElementById('discoveryLive').getAttribute('aria-busy')==='false' && document.querySelectorAll('#discoveryLiveResults .catalog-film').length===3`));
    await until(()=>js(`Array.from(document.querySelectorAll('#discoveryLiveResults img')).every(i=>i.naturalWidth>0)`));
    assert.equal(await js('testRequests.length'),3);assert.equal(await js('testRequests.some(r=>r.interactive)'),false);
    const notes=await js(`Array.from(document.querySelectorAll('.catalog-query-note')).map(n=>n.textContent)`);
    assert.ok(notes.some(n=>n.includes('看剧')&&n.includes('重试此来源')&&n.includes('打开原站检查')));
    assert.ok(notes.some(n=>n.includes('七味')&&n.includes('手动验证')));
    assert.ok(!notes.some(n=>n.includes('233')),'server fallback recovers 233dm without an error card');
    for(const width of [320,390,768,1440]) {
        win.setContentSize(width,844);await delay(200);
        const sizes=await js(`Array.from(document.querySelectorAll('#discoveryLiveResults .catalog-film-poster')).map(el=>{
            const r=el.getBoundingClientRect(),i=el.querySelector('img');return {ratio:r.width/r.height,w:i.naturalWidth,h:i.naturalHeight,fit:getComputedStyle(i).objectFit};})`);
        for(const size of sizes){assert.ok(Math.abs(size.ratio-size.w/size.h)<.01,JSON.stringify(size));assert.equal(size.fit,'contain');}
        assert.ok(await js('document.documentElement.scrollWidth<=innerWidth+1'));
    }
    win.setContentSize(390,844);await js('scrollTo(0,0)');await delay(300);
    fs.writeFileSync(path.join(out,'mobile-adaptive-posters.png'),(await wc.capturePage()).toPNG());
    await js(`document.getElementById('catalogSearchNotes').open=true;document.getElementById('catalogSearchNotes').scrollIntoView()`);await delay(150);
    fs.writeFileSync(path.join(out,'mobile-search-recovery.png'),(await wc.capturePage()).toPNG());
    // Exercise the user's exact retry action through the real catalogue UI and
    // Android queue. This is a local fixture, not an Android WebView emulation.
    await js(`Array.from(document.querySelectorAll('.catalog-query-note')).find(n=>n.textContent.includes('看剧'))
        .querySelectorAll('button')[1].click()`);
    await until(()=>js(`document.getElementById('discoveryLive').getAttribute('aria-busy')==='false'
        && document.getElementById('discoveryLiveResults').textContent.includes('元气少女 原站回传测试')`));
    assert.equal(await js('testRequests.filter(r=>r.interactive).length'),1);
    assert.ok(await js(`Array.from(document.querySelectorAll('.catalog-query-note')).some(n=>n.textContent.includes('看剧') && n.textContent.includes('结果已合入上方影片') && !n.querySelector('button'))`));
    assert.equal(await js(`document.querySelectorAll('#discoveryLiveResults .catalog-film').length`),4);
    await js(`scrollTo(0,0)`);await delay(200);
    fs.writeFileSync(path.join(out,'manual-results-returned.png'),(await wc.capturePage()).toPNG());
    await js('clearInterval(testPump)');
    console.log('PASS: Android queue, local failure/server recovery, explicit manual result return, no automatic verification, separate retry actions, real image ratios at 4 widths, no overflow. Evidence: '+out);
}
function finish(code){backend?.kill();win?.destroy();app.exit(code);}
app.whenReady().then(run).then(()=>finish(0)).catch(e=>{console.error(e.stack,log);finish(1);});
