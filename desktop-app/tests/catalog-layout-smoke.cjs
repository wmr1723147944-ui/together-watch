'use strict';
// Local-only UI regression: fixture metadata, public CDN covers. Not a playback test.
const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..'),output=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'together-watch-catalog-qa-'));
let backend,win,log='';
async function until(name,fn,ms=18000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(150);}throw Error('Timeout: '+name);}
async function run(){
    fs.mkdirSync(output,{recursive:true});
    const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
    const port=reserve.address().port;await new Promise(r=>reserve.close(r));const server='http://127.0.0.1:'+port;
    backend=spawn(process.env.TW_SMOKE_PYTHON||'python',['-u','-c',`
from pathlib import Path
import app as module
import source_search
import catalog_recommendations
# Reuse local poster metadata with active-source identities; never re-enable a
# retired provider just to make the UI test pass.
posters = source_search.parse_results(source_search.PROVIDERS['ddys'], Path('tests/poster-search-fixture.json').read_text(encoding='utf8'), '星')
rows = [dict(row, page_url=f'https://yhdmoe.com/watch/{1000+i}') for i, row in enumerate(posters)]
def search(source, query):
    matching = rows if source == 'yhdmoe' else [dict(title='绿色星球',year='2022',page_url='https://www.cupfox.in/vod-detail/1234.html')] if source == 'cupfox' else []
    return dict(source_id=source, status='unavailable' if source == 'pkavi' else 'ok', results=matching, cached=False)
def detail(source, page):
    if source == 'cupfox':
        return dict(source_id=source,page_url=page,item_id='1234',status='ok',description='本地第二来源测试',episodes=[dict(id='ep1',title='第 1 集',launch_path='/discover/play/cupfox/1234/ep1')])
    item = page.rsplit('/',1)[-1]
    return dict(source_id=source, page_url=page, item_id=item, status='ok', title='绿色星球', description='本地界面测试：公开目录样例，不代表已验证可播。', episodes=[dict(id='EP1',title='第 1 集',launch_path=f'/discover/play/yhdmoe/{item}/EP1')])
module.search_provider=search
module.load_detail=detail
def feed(source, category, page):
    matching = []
    if source == 'yhdmoe':
        for batch in range(3):
            for i, r in enumerate(rows):
                matching.append(r if page == 1 and batch == 0 else dict(r,
                    title=f'分页测试 {page}-{batch} · ' + r['title'], page_url=f'https://yhdmoe.com/watch/{page * 10000 + batch * 100 + i}'))
    elif source == 'cupfox' and category in ('movie', 'series'):
        matching = [dict(r, page_url=f'https://www.cupfox.in/vod-detail/{1000+i}.html') for i, r in enumerate(rows)]
    return dict(source_id=source, category=category, page=page, status='ok', results=matching,
                has_more=source == 'yhdmoe' and page == 1, next_page=2 if source == 'yhdmoe' and page == 1 else None)
catalog_recommendations.load_page=feed
module.app.run(host='127.0.0.1',port=${port},use_reloader=False)
`],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,APP_ENV:'development',SECRET_KEY:'catalog-ui-test-only'}});
    backend.stdout.on('data',d=>log=(log+d).slice(-5000));backend.stderr.on('data',d=>log=(log+d).slice(-5000));
    backend.on('error',e=>{log+=e.message;});
    await until('backend',async()=>{try{return (await fetch(server+'/health')).ok;}catch{return false;}});
    win=new BrowserWindow({show:false,width:1440,height:900,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,partition:'catalog-layout-test'}});
    const wc=win.webContents,js=s=>wc.executeJavaScript(s);
    const errors=[];
    wc.on('console-message',(_event,details,message)=>{
        const level=typeof details==='object'?details.level:details;
        const text=typeof details==='object'?details.message:message;
        if(level==='error'||level===3)errors.push(text);
    });
    wc.on('render-process-gone',(_event,details)=>errors.push('renderer: '+details.reason));
    async function shot(name){await delay(350);fs.writeFileSync(path.join(output,name+'.png'),(await wc.capturePage()).toPNG());}
    async function noOverflow(){assert.ok(await js('document.documentElement.scrollWidth <= innerWidth + 1'),'horizontal overflow');}
    await win.loadURL(server+'/discover');
    assert.equal(wc.getURL(),server+'/discover');assert.match(wc.getTitle(),/一起看|影片|Together/i);
    assert.equal(await js('document.querySelectorAll("[data-live-source=ddys], [data-feed-source=ddys], [data-live-source=fcma], [data-feed-source=fcma]").length'),0,'retired sources must stay hidden');
    await until('initial catalogue',()=>js('document.querySelectorAll(".catalog-feed-film").length===24'));
    assert.ok(await js('!document.querySelector("vite-error-overlay, #webpack-dev-server-client-overlay, nextjs-portal")'));
    await until('visible recommendation images',()=>js('Array.from(document.querySelectorAll("#catalogFeedGrid img")).slice(0,8).every(i=>i.complete)'),30000);
    await noOverflow();await shot('desktop-welcome');
    assert.equal(await js('document.querySelectorAll(".catalog-spotlight-film").length'),4);
    assert.equal(await js('getComputedStyle(document.body).backgroundColor'),'rgb(255, 255, 255)');
    assert.ok(await js('document.querySelector(".site-nav #discoveryForm") !== null'));
    assert.equal(await js('getComputedStyle(document.querySelector(".catalog-mobile-nav")).display'),'none','desktop must not gain mobile navigation');
    assert.ok(await js(`(()=>{
        const rgb=s=>s.match(/[0-9.]+/g).slice(0,3).map(Number);
        const lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
        const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
        return ['.nav-room-link','.catalog-primary','#catalogFeedStatus','.catalog-feed-film > p'].every(selector=>{
            const s=getComputedStyle(document.querySelector(selector)),bg=s.backgroundColor==='rgba(0, 0, 0, 0)'?[255,255,255]:rgb(s.backgroundColor);
            return contrast(rgb(s.color),bg)>=4.5;
        });
    })()`),'key catalogue text has readable contrast');
    await js('document.querySelector("#catalogSpotlightGrid .catalog-film-poster").click()');
    await until('spotlight opens real detail',()=>js('document.getElementById("discoveryDetail").open'));
    await js('document.getElementById("discoveryDetailClose").click()');
    assert.equal(await js('document.querySelectorAll(".catalog-feed-film").length'),24,'next page must wait for scroll');
    await js('document.getElementById("catalogFeedSentinel").scrollIntoView();dispatchEvent(new Event("scroll"))');
    await until('scroll appends second page',()=>js('document.querySelectorAll(".catalog-feed-film").length===48'));
    assert.ok(await js('document.getElementById("catalogFeedMore").hidden'));
    await shot('desktop-page-two');
    await js('scrollTo(0,0);document.querySelector("#catalogFeedGrid .catalog-film-poster").click()');
    await until('feed detail',()=>js('document.getElementById("discoveryDetail").open'));
    assert.ok(await js('!document.getElementById("catalogFindOtherSources").hidden'));
    await js('document.getElementById("discoveryDetailClose").click()');
    await js(`for(const c of document.querySelectorAll('[data-live-source]'))c.checked=['yhdmoe','pkavi','blender','cupfox'].includes(c.dataset.liveSource);document.getElementById('discoveryQuery').value='星';document.getElementById('discoveryForm').requestSubmit();`);
    await until('eight poster results',()=>js('document.querySelectorAll(".discovery-title-card").length===8'));
    await until('loaded cover',()=>js('Array.from(document.querySelectorAll(".discovery-poster-image")).filter(i=>i.complete && i.naturalWidth>0).length>=6'),30000);
    await until('completed query',()=>js('document.getElementById("discoveryLive").getAttribute("aria-busy")==="false"'));
    await noOverflow();await shot('desktop-results');
    const desktop=await js(`({images:document.querySelectorAll('.discovery-poster-image:not([hidden])').length,columns:getComputedStyle(document.querySelector('#discoveryLiveResults')).gridTemplateColumns.split(' ').length})`);
    assert.ok(desktop.columns>=5);console.log('Desktop:',desktop);
    await js(`document.querySelector('.discovery-title-art').click()`);
    await until('detail dialog',()=>js('document.getElementById("discoveryDetail").open && document.querySelectorAll(".discovery-episode").length===1'));
    assert.equal(await js('document.querySelectorAll("#catalogSourceChoices button").length'),2);
    await js('document.querySelector("#catalogSourceChoices [data-source=yhdmoe]").click()');
    await until('switch to YHDMOE',()=>js('document.querySelector(".discovery-episode")?.getAttribute("href").startsWith("/discover/play/yhdmoe/")'));
    await js('document.querySelector("#catalogSourceChoices [data-source=cupfox]").click()');
    await until('switch to cupfox',()=>js('document.querySelector(".discovery-episode")?.getAttribute("href")==="/discover/play/cupfox/1234/ep1"'));
    await shot('desktop-detail');await js('document.getElementById("discoveryDetailClose").click()');
    for(const width of [1920,1024,768,390,320]){
        win.setContentSize(width,1000);await delay(400);await noOverflow();
        const cols=await js(`getComputedStyle(document.querySelector('#discoveryLiveResults')).gridTemplateColumns.split(' ').length`);
        assert.equal(cols,width>1190?6:width>900?5:width>680?4:2);
        assert.ok(await js('(()=>{const r=document.getElementById("discoveryForm").getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.width>150})()'),'search remains within viewport');
        if(width<=390) {
            assert.equal(await js('getComputedStyle(document.querySelector(".catalog-mobile-nav")).position'),'fixed');
            assert.ok(await js('document.querySelector(".site-nav").getBoundingClientRect().height<=66'),'mobile header is a single compact row');
            assert.ok(await js('(()=>{const r=document.querySelector(".catalog-mobile-nav").getBoundingClientRect();return r.bottom<=innerHeight+1 && r.top>=innerHeight-90})()'));
            assert.equal(await js('document.getElementById("catalogMobileSearch").getAttribute("aria-current")'),'page');
        }
        if(width===390)await shot('mobile-results');
    }
    await js(`const i=document.querySelector('#discoveryLiveResults .discovery-poster-image');i.dispatchEvent(new Event('error'));`);
    assert.ok(await js(`!document.querySelector('#discoveryLiveResults .discovery-poster-fallback').hidden && document.querySelector('#discoveryLiveResults .discovery-poster-image').hidden`));
    await js(`document.querySelector('.discovery-title-art').click()`);
    await until('failed-cover still opens',()=>js('document.getElementById("discoveryDetail").open'));await noOverflow();
    await js('document.getElementById("discoveryDetailClose").click();document.getElementById("discoveryClear").click()');
    assert.ok(await js('!document.getElementById("discoveryWelcome").hidden'));
    assert.equal(await js('document.querySelectorAll(".catalog-feed-film").length'),48,'return preserves loaded recommendations');
    await js('document.querySelector("[data-catalog-category=movie]").click()');
    await until('movie category loads',()=>js('document.getElementById("recommendationTitle").textContent==="电影片单" && document.querySelectorAll(".catalog-feed-film").length>=8'));
    await noOverflow();
    await js('document.getElementById("catalogFeedRefresh").click()');
    await until('refresh completes',()=>js('document.getElementById("catalogFeedGrid").getAttribute("aria-busy")==="false" && document.querySelectorAll(".catalog-feed-film").length>=8'));
    await js('document.querySelector("[data-catalog-category=all]").click();scrollTo(0,0)');
    await until('mobile feed ready',()=>js('document.querySelectorAll(".catalog-feed-film").length===24'));
    win.setContentSize(320,1000);await delay(250);await noOverflow();
    win.setContentSize(390,844);await delay(350);
    console.log('Mobile viewport:',await js('({width:innerWidth,height:innerHeight,visualHeight:visualViewport.height})'));
    await until('mobile viewport height',()=>js('Math.abs(innerHeight-844)<=2'));
    await js('document.getElementById("catalogMobileHome").click()');
    assert.equal(await js('getComputedStyle(document.querySelector(".catalog-mobile-nav")).display'),'flex','bottom tabs restore after input blur / viewport shrink');
    await shot('mobile-welcome');
    assert.equal(await js('getComputedStyle(document.getElementById("catalogSpotlightGrid")).display'),'none','mobile avoids duplicate preview cards');
    assert.ok(await js('document.getElementById("catalogHero").getBoundingClientRect().height<=170'),'compact app banner');
    await js('document.getElementById("catalogMobileSearch").click()');
    assert.equal(await js('document.activeElement.id'),'discoveryQuery');
    assert.equal(await js('document.querySelectorAll(".catalog-feed-film").length'),24,'search tab must not reset or query the feed');
    await js('document.getElementById("catalogMobileHome").click()');
    assert.notEqual(await js('document.activeElement.id'),'discoveryQuery','home must not summon the keyboard');
    assert.equal(await js('document.getElementById("catalogMobileHome").getAttribute("aria-current")'),'page');
    await js('document.querySelector("#catalogFeedGrid .catalog-film-poster").click()');
    await until('mobile detail sheet',()=>js('document.getElementById("discoveryDetail").open'));
    assert.ok(await js('(()=>{const r=document.getElementById("discoveryDetail").getBoundingClientRect();return Math.abs(r.bottom-innerHeight)<2 && r.width<=innerWidth && r.top>=0})()'));
    await shot('mobile-detail');await js('document.getElementById("discoveryDetailClose").click()');
    await win.loadURL(server+'/');await delay(500);await noOverflow();await shot('mobile-home');
    assert.equal(await js('document.getElementById("roomEntry").open'),false);
    assert.equal(await js('document.querySelectorAll(".discovery-live-source, .recommended-sites, .discovery-search-options").length'),0);
    await js('document.querySelector(".catalog-mobile-nav a").click()');
    assert.ok(await js('document.getElementById("roomEntry").open'));await noOverflow();await shot('mobile-join');
    await js('document.getElementById("roomEntryClose").click()');
    await win.loadURL(server+'/?room=4ccfa3f3db24a52c2b5c68bc');
    await until('invitation opens join form',()=>js('document.getElementById("roomEntry").open'));
    assert.equal(await js('document.getElementById("roomId").value'),'4ccfa3f3db24a52c2b5c68bc');
    const appErrors=errors.filter(e=>!/net::|Failed to load resource|Electron Security Warning/.test(e));
    assert.deepEqual(appErrors,[],'runtime console errors');
    console.log('External cover errors (fallback tested):',errors.filter(e=>/net::|Failed to load resource/.test(e)).length);
    console.log('Evidence:',output);
    console.log('PASS: real rendered feed append on scroll, dedup, preserved return, categories, refresh, unified search, covers, fallback, detail/episode, responsive widths, invitation dialog, no runtime console errors');
}
function finish(code){backend?.kill();win?.destroy();app.exit(code);}
app.whenReady().then(run).then(()=>finish(0)).catch(e=>{console.error(e.stack,log);finish(1);});
