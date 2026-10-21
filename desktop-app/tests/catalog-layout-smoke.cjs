'use strict';
// Local-only UI regression: fixture metadata, public CDN covers. Not a playback test.
const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'.review-artifacts/film-home-20261021');
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
rows = source_search.parse_results(source_search.PROVIDERS['ddys'], Path('tests/poster-search-fixture.json').read_text(encoding='utf8'), '星')
def search(source, query):
    matching = rows if source == 'ddys' else [dict(title='绿色星球',year='2022',page_url='https://www.cupfox.in/vod-detail/1234.html')] if source == 'cupfox' else []
    return dict(source_id=source, status='unavailable' if source == 'huarw' else 'ok', results=matching, cached=False)
def detail(source, page):
    if source == 'cupfox':
        return dict(source_id=source,page_url=page,item_id='1234',status='ok',description='本地第二来源测试',episodes=[dict(id='ep1',title='第 1 集',launch_path='/discover/play/cupfox/1234/ep1')])
    return dict(source_id=source, page_url=page, item_id='the-green-planet', status='ok', title='绿色星球', description='本地界面测试：公开目录样例，不代表已验证可播。', episodes=[dict(id='page',title='在原站选集',launch_path='/discover/play/ddys/the-green-planet/page')])
module.search_provider=search
module.load_detail=detail
module.app.run(host='127.0.0.1',port=${port},use_reloader=False)
`],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,APP_ENV:'development',SECRET_KEY:'catalog-ui-test-only'}});
    backend.stdout.on('data',d=>log=(log+d).slice(-5000));backend.stderr.on('data',d=>log=(log+d).slice(-5000));
    backend.on('error',e=>{log+=e.message;});
    await until('backend',async()=>{try{return (await fetch(server+'/health')).ok;}catch{return false;}});
    win=new BrowserWindow({show:false,width:1440,height:1100,useContentSize:true,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,partition:'catalog-layout-test'}});
    const wc=win.webContents,js=s=>wc.executeJavaScript(s);
    async function shot(name){await delay(350);fs.writeFileSync(path.join(output,name+'.png'),(await wc.capturePage()).toPNG());}
    async function noOverflow(){assert.ok(await js('document.documentElement.scrollWidth <= innerWidth + 1'),'horizontal overflow');}
    await win.loadURL(server+'/discover');
    await until('initial recommendation images',()=>js('Array.from(document.querySelectorAll(".catalog-film-poster img")).every(i=>i.complete)'),25000);
    await noOverflow();await shot('desktop-welcome');
    await js(`for(const c of document.querySelectorAll('[data-live-source]'))c.checked=['ddys','huarw','blender','cupfox'].includes(c.dataset.liveSource);document.getElementById('discoveryQuery').value='星';document.getElementById('discoveryForm').requestSubmit();`);
    await until('eight poster results',()=>js('document.querySelectorAll(".discovery-title-card").length===8'));
    await until('loaded cover',()=>js('Array.from(document.querySelectorAll(".discovery-poster-image")).filter(i=>i.complete && i.naturalWidth>0).length>=6'),30000);
    await until('completed query',()=>js('document.getElementById("discoveryLive").getAttribute("aria-busy")==="false"'));
    await noOverflow();await shot('desktop-results');
    const desktop=await js(`({images:document.querySelectorAll('.discovery-poster-image:not([hidden])').length,columns:getComputedStyle(document.querySelector('#discoveryLiveResults')).gridTemplateColumns.split(' ').length})`);
    assert.ok(desktop.columns>=5);console.log('Desktop:',desktop);
    await js(`document.querySelector('.discovery-title-art').click()`);
    await until('detail dialog',()=>js('document.getElementById("discoveryDetail").open && document.querySelectorAll(".discovery-episode").length===1'));
    assert.equal(await js('document.querySelectorAll("#catalogSourceChoices button").length'),2);
    await js('document.querySelector("#catalogSourceChoices [data-source=ddys]").click()');
    await until('switch to DDYS',()=>js('document.querySelector(".discovery-episode")?.getAttribute("href").startsWith("/discover/play/ddys/")'));
    await js('document.querySelector("#catalogSourceChoices [data-source=cupfox]").click()');
    await until('switch to cupfox',()=>js('document.querySelector(".discovery-episode")?.getAttribute("href")==="/discover/play/cupfox/1234/ep1"'));
    await shot('desktop-detail');await js('document.getElementById("discoveryDetailClose").click()');
    for(const width of [390,320]){
        win.setContentSize(width,1000);await delay(400);await noOverflow();
        const cols=await js(`getComputedStyle(document.querySelector('#discoveryLiveResults')).gridTemplateColumns.split(' ').length`);
        assert.equal(cols,2);if(width===390)await shot('mobile-results');
    }
    await js(`const i=document.querySelector('#discoveryLiveResults .discovery-poster-image');i.dispatchEvent(new Event('error'));`);
    assert.ok(await js(`!document.querySelector('#discoveryLiveResults .discovery-poster-fallback').hidden && document.querySelector('#discoveryLiveResults .discovery-poster-image').hidden`));
    await js(`document.querySelector('.discovery-title-art').click()`);
    await until('failed-cover still opens',()=>js('document.getElementById("discoveryDetail").open'));await noOverflow();
    await js('document.getElementById("discoveryDetailClose").click();document.getElementById("discoveryClear").click()');
    assert.ok(await js('!document.getElementById("discoveryWelcome").hidden'));
    win.setContentSize(390,1000);await shot('mobile-welcome');
    await win.loadURL(server+'/');await delay(500);await noOverflow();await shot('mobile-home');
    assert.equal(await js('document.getElementById("roomEntry").open'),false);
    assert.equal(await js('document.querySelectorAll(".discovery-live-source, .recommended-sites, .discovery-search-options").length'),0);
    await js('document.querySelector(".nav-room-link").click()');
    assert.ok(await js('document.getElementById("roomEntry").open'));await noOverflow();await shot('mobile-join');
    await js('document.getElementById("roomEntryClose").click()');
    await win.loadURL(server+'/?room=4ccfa3f3db24a52c2b5c68bc');
    await until('invitation opens join form',()=>js('document.getElementById("roomEntry").open'));
    assert.equal(await js('document.getElementById("roomId").value'),'4ccfa3f3db24a52c2b5c68bc');
    console.log('PASS: film-first home, unified results, covers, fallback, detail/episode, clear, responsive widths, invitation dialog');
}
function finish(code){backend?.kill();win?.destroy();app.exit(code);}
app.whenReady().then(run).then(()=>finish(0)).catch(e=>{console.error(e.stack,log);finish(1);});
