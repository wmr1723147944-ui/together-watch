'use strict';
// Offline end-to-end category pagination: real Flask parser/API, catalogue UI,
// year links and local poster fixture. No third-party availability/playback claim.
const {app,BrowserWindow,nativeImage}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'.review-artifacts','category-feed-20261028');
let backend,win,log='';
async function until(label,fn,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(75);}throw Error('Timed out: '+label);}
async function run(){
    fs.mkdirSync(out,{recursive:true});const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
    const port=reserve.address().port;await new Promise(r=>reserve.close(r));const server='http://127.0.0.1:'+port;
    backend=spawn(process.env.TW_SMOKE_PYTHON||'python',['-u','-c',`
from urllib.parse import urlsplit, parse_qs
import app as module
import source_search as search
import catalog_recommendations as feed
module.enabled_search_sources=lambda: [dict(search.PROVIDERS['cupfox'])]
feed.cupfox_years=lambda: ['2026', '2025']
def fixture(provider, path, **kwargs):
    assert provider['id']=='cupfox', 'Unexpected fixture provider'
    u=urlsplit(path)
    assert u.path=='/filter/', 'Unexpected fixture path'
    q=parse_qs(u.query); kind=q.get('type',['all'])[0]; year=q.get('year',[''])[0]
    title={'all':'推荐','movie':'电影','tv':'剧集','anime':'动漫','doc':'纪录片'}[kind]
    offset=['all','movie','tv','anime','doc'].index(kind)*1000+(100 if year=='2025' else 0)
    cards=''.join(f'<div class="movie-list-item"><a href="/vod-detail/{offset+i+1}.html"><img src="https://image.tmdb.org/category-fixture.png"><div class="movie-title">{title}测试影片 {offset+i+1}</div></a></div>' for i in range(24))
    prefix='?type='+kind+'&' if kind!='all' else '?'
    links=''.join(f'<a href="/filter/{prefix}year={y}">{y}</a>' for y in ['2026','2025'])
    return '<div class="movie-list-body">'+cards+'</div>'+links
search._fetch_path=fixture
module.app.run(host='127.0.0.1',port=${port},use_reloader=False)
`],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,APP_ENV:'development',SECRET_KEY:'category-feed-fixture'}});
    backend.stderr.on('data',d=>log=(log+d).slice(-5000));backend.stdout.on('data',d=>log=(log+d).slice(-5000));
    await until('backend',async()=>{try{return (await fetch(server+'/health')).ok;}catch{return false;}});
    win=new BrowserWindow({show:false,width:1440,height:900,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,nodeIntegration:false,contextIsolation:true,partition:'category-feed-fixture'}});
    const wc=win.webContents,js=s=>wc.executeJavaScript(s),requests=[];
    wc.session.webRequest.onBeforeRequest({urls:[server+'/api/discover/feed*']},(details,callback)=>{
        const q=new URL(details.url).searchParams;requests.push([q.get('category'),Number(q.get('page'))]);callback({});
    });
    const pixels=Buffer.alloc(400*600*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=150;pixels[i+1]=110;pixels[i+2]=70;pixels[i+3]=255;}
    const poster=nativeImage.createFromBitmap(pixels,{width:400,height:600}).toPNG();
    wc.session.protocol.handle('https',request=>request.url==='https://image.tmdb.org/category-fixture.png'
        ?new Response(poster,{headers:{'Content-Type':'image/png'}}):new Response('',{status:404}));
    await win.loadURL(server+'/discover');
    await until('initial recommendation',()=>js(`document.querySelectorAll('.catalog-feed-film').length===24 && document.getElementById('catalogFeedGrid').getAttribute('aria-busy')==='false'`));
    for(const width of [1440,390]){
        win.setContentSize(width,900);
        for(const category of ['movie','series','animation','documentary']){
            requests.length=0;
            await js(`scrollTo(0,0);document.querySelector('[data-catalog-category="${category}"]').click()`);
            await until('first '+category,()=>js(`document.querySelectorAll('.catalog-feed-film').length===24 && document.getElementById('catalogFeedGrid').getAttribute('aria-busy')==='false'`));
            await until('posters '+category,()=>js(`Array.from(document.querySelectorAll('#catalogFeedGrid img')).every(i=>i.complete && i.naturalWidth>0)`));
            assert.ok(await js(`document.querySelector('[data-catalog-category="${category}"]').getAttribute('aria-pressed')==='true'`));
            await js(`document.getElementById('catalogFeedSentinel').scrollIntoView();dispatchEvent(new Event('scroll'))`);
            try {
                await until('continued '+category,()=>js(`document.querySelectorAll('.catalog-feed-film').length===48 && document.getElementById('catalogFeedGrid').getAttribute('aria-busy')==='false'`));
            } catch(error) {
                console.log(await js(`({status:document.getElementById('catalogFeedStatus').textContent,notes:document.getElementById('catalogFeedNotesBody').textContent,
                    rect:document.getElementById('catalogFeedSentinel').getBoundingClientRect().toJSON(),height:innerHeight,y:scrollY,visibility:document.visibilityState,
                    cards:document.querySelectorAll('.catalog-feed-film').length})`));throw error;
            }
            assert.deepEqual(requests,[[category,1],[category,2],[category,3]],width+' '+category);
            assert.ok(await js(`document.getElementById('catalogFeedMore').hidden`));
            assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth+1`));
            await js(`document.getElementById('catalogFeedSentinel').scrollIntoView();dispatchEvent(new Event('scroll'))`);await delay(300);
            assert.equal(requests.length,3,'finite archive must stop');
            console.log('PASS',width,category,'24 -> overlap skipped -> 48, ended');
        }
        await js('scrollTo(0,0)');await delay(200);
        fs.writeFileSync(path.join(out,width+'-documentary.png'),(await wc.capturePage()).toPNG());
    }
    console.log('PASS category UI, real parser/API, overlap de-duplication, bounded scrolling. '+out);
}
function finish(code){backend?.kill();win?.destroy();app.exit(code);}
app.whenReady().then(run).then(()=>finish(0)).catch(e=>{console.error(e.stack,log);finish(1);});
