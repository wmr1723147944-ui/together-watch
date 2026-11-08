'use strict';
// Standalone rendering check: real Flask template/CSS, synthetic release metadata.
// Run with electron tests/downloads-ui-smoke.cjs --headless --disable-gpu.
const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict'),{setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'.review-artifacts/downloads-ui');
let backend,win,log='';
app.setPath('userData',path.join(app.getPath('temp'),'tw-downloads-ui-'+process.pid));
async function until(name,fn){const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await delay(120);}throw Error('Timeout: '+name);}
async function run(){
    fs.mkdirSync(out,{recursive:true});
    const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
    const port=reserve.address().port;await new Promise(r=>reserve.close(r));const server='http://127.0.0.1:'+port;
    backend=spawn(process.env.TW_SMOKE_PYTHON||'python',['-u','-c',`
import app as module
from flask import request
def fixture_release(directory, platform):
    fixture=request.args.get('fixture','both')
    if fixture == 'empty' or fixture == 'windows-only' and platform == 'android' or fixture == 'android-only' and platform == 'windows':
        return None
    android=platform == 'android'
    version='0.3.34' if android else '0.6.25'
    name=f'TogetherWatch-Android-{version}.apk' if android else f'TogetherWatch-Windows-{version}-x64.zip'
    return dict(platform=platform,version=version,size=5767361 if android else 163074946,sha256='a1'*32,
                download_path='/downloads/files/'+name,notes=['全屏观看时返回，先退出全屏。','回到推荐首页后，再次返回即可退出应用。'])
module.client_updates.release=fixture_release
module.app.run(host='127.0.0.1',port=${port},use_reloader=False)
`],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,APP_ENV:'development',SECRET_KEY:'downloads-ui-test-only',ACCOUNT_DATABASE:path.join(out,'test-accounts.sqlite3')}});
    backend.stdout.on('data',d=>log=(log+d).slice(-3000));backend.stderr.on('data',d=>log=(log+d).slice(-3000));backend.on('error',e=>log+=e.message);
    await until('backend',async()=>{try{return (await fetch(server+'/health')).ok;}catch{return false;}});
    win=new BrowserWindow({show:false,width:390,height:844,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,partition:'downloads-ui-'+process.pid}});
    const wc=win.webContents,external=[],errors=[];
    wc.session.webRequest.onBeforeRequest((details,done)=>{const blocked=!details.url.startsWith(server+'/');if(blocked)external.push(details.url);done({cancel:blocked});});
    wc.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
    const js=code=>wc.executeJavaScript(code);
    async function shot(name){await delay(200);fs.writeFileSync(path.join(out,name+'.png'),(await wc.capturePage()).toPNG());}
    await win.loadURL(server+'/downloads');
    assert.equal(await js('document.compatMode'),'CSS1Compat');
    assert.equal(await js('document.querySelector(".other-platform").open'),false);
    assert.equal(await js('document.querySelector(".download").textContent.includes("下载安卓版")'),true);
    await js('document.querySelector(".other-platform > summary").click()');
    await until('Windows section opens',()=>js('document.querySelector(".other-platform").open'));
    assert.ok(await js('document.querySelector(".secondary").getBoundingClientRect().height >= 48'));
    await js('document.querySelector(".other-platform > summary").click()');
    await until('Windows section closes',()=>js('!document.querySelector(".other-platform").open'));
    await js('document.querySelector(".release-details > summary").click()');
    await until('release notes open',()=>js('document.querySelector(".release-details").open'));
    await js('document.querySelector(".release-details > summary").click()');
    await until('release notes close',()=>js('!document.querySelector(".release-details").open'));
    for(const [w,h] of [[390,844],[320,640],[430,932],[1280,900]]){
        win.setContentSize(w,h);await delay(180);
        assert.ok(await js('document.documentElement.scrollWidth<=innerWidth+1'),'no horizontal overflow at '+w);
        assert.ok(await js('(()=>{const r=document.querySelector(".download").getBoundingClientRect();return r.height>=48&&r.top>=0&&r.bottom<=innerHeight;})()'),'primary download above fold at '+w);
        assert.ok(await js('[...document.images].every(i=>i.complete&&i.naturalWidth>0)'),'brand assets loaded');
        if(w!==430)await shot('downloads-'+w);
    }
    win.setContentSize(320,720);await delay(150);
    await js('document.querySelectorAll("details").forEach(d=>d.open=true)');
    assert.ok(await js('document.documentElement.scrollWidth<=innerWidth+1'),'expanded checksum and Windows fit narrow screen');
    await js('document.querySelector(".other-platform").scrollIntoView()');await shot('downloads-320-expanded');
    win.setContentSize(390,844);await win.loadURL(server+'/downloads');wc.setZoomFactor(1.5);await delay(200);
    assert.ok(await js('document.documentElement.scrollWidth<=innerWidth+1'),'150% zoom remains usable');wc.setZoomFactor(1);
    for(const [fixture,count] of [['empty',0],['windows-only',1],['android-only',1]]){
        await win.loadURL(server+'/downloads?fixture='+fixture);
        assert.equal(await js('document.querySelectorAll("a[download]").length'),count,fixture);
        assert.ok(await js('document.documentElement.scrollWidth<=innerWidth+1'),fixture+' fits');
    }
    assert.deepEqual(external,[],'no external scripts, fonts or tracking requests');
    assert.deepEqual(errors,[],'no renderer errors');
    console.log('PASS downloads UI: 320/390/430/1280 widths, primary CTA, expanded metadata, 150% zoom, missing releases, local-only assets.');
}
app.whenReady().then(run).then(()=>{if(win&&!win.isDestroyed())win.destroy();if(backend)backend.kill();app.exit(0);}).catch(e=>{console.error(e,log);if(win&&!win.isDestroyed())win.destroy();if(backend)backend.kill();app.exit(1);});
