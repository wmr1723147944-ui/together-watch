'use strict';
// Executes Java-generated room scripts in real Chromium; not an Android UI test.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),{setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..');
app.setPath('userData',path.join(app.getPath('temp'),'tw-room-bootstrap-'+process.pid));
let win,releaseImage;
async function until(fn){const end=Date.now()+10000;while(Date.now()<end){if(await fn())return;await delay(100);}throw Error('Document not ready');}
async function run(){
    assert.ok(process.env.JAVA_HOME && process.env.TW_JSON_JAR,'JAVA_HOME and TW_JSON_JAR required');
    const build=fs.mkdtempSync(path.join(os.tmpdir(),'tw-room-script-'));
    for(const [base,file] of [['main','RoomPageScripts.java'],['test','RoomPageScriptFixture.java']])
        fs.copyFileSync(path.join(root,'android-app/app/src',base,'java/cloud/watchtogethernow/mobile',file),path.join(build,file));
    const exe=name=>path.join(process.env.JAVA_HOME,'bin',name+(process.platform==='win32'?'.exe':''));
    const compile=spawnSync(exe('javac'),['-encoding','UTF-8','-cp',process.env.TW_JSON_JAR,'-d',build,path.join(build,'RoomPageScripts.java'),path.join(build,'RoomPageScriptFixture.java')],{encoding:'utf8',windowsHide:true});
    assert.equal(compile.status,0,compile.stderr||String(compile.error));
    const emitted=spawnSync(exe('java'),['-cp',build+path.delimiter+process.env.TW_JSON_JAR,'cloud.watchtogethernow.mobile.RoomPageScriptFixture'],{encoding:'utf8',windowsHide:true});
    assert.equal(emitted.status,0,emitted.stderr);const scripts=JSON.parse(Buffer.from(emitted.stdout,'base64').toString('utf8'));
    win=new BrowserWindow({show:false,webPreferences:{offscreen:true,backgroundThrottling:false,nodeIntegration:false,contextIsolation:true,partition:'room-init-'+process.pid}});
    const wc=win.webContents,requests=[];
    wc.debugger.attach('1.3');
    // Electron executeJavaScript waits for did-finish-load. CDP, like WebView's
    // evaluateJavascript, can inspect the committed DOM while images still load.
    const js=async code=>{const result=await wc.debugger.sendCommand('Runtime.evaluate',{expression:code,returnByValue:true,awaitPromise:true});
        if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
    await wc.session.protocol.handle('https',async req=>{
        const u=new URL(req.url);assert.equal(u.origin,'https://watchtogethernow.cloud');requests.push(u.pathname);
        if(req.url===scripts.bootstrap)return new Response(scripts.document,{headers:{'Content-Type':'text/html'}});
        if(u.pathname==='/slow.png')return new Promise(resolve=>{releaseImage=()=>resolve(new Response('',{status:404}));});
        if(req.url===scripts.room)return new Response('<input id="roomData" value="fixture-room"><script>window.TogetherWatchMobile={program(){},receive(){},drain(){}};</script><img src="/slow.png">',{headers:{'Content-Type':'text/html'}});
        return new Response('',{status:404});
    });
    await win.loadURL(scripts.bootstrap);
    assert.equal(await js(scripts.initialize),'initialized');
    assert.equal(await js('localStorage.getItem("tw_username")'),'观影者"<test>');
    assert.equal(await js(scripts.probe),'waiting','bootstrap cannot masquerade as room');
    const loading=win.loadURL(scripts.room).catch(()=>{});
    await until(async()=>await js(scripts.probe)==='ready');
    await until(()=>!!releaseImage);
    assert.ok(wc.isLoading(),'room bridge becomes ready without waiting for a slow image/onPageFinished');
    assert.equal(await js(scripts.initialize),'waiting','late bootstrap script cannot write in room');
    await js('roomData.value="old-room"');assert.equal(await js(scripts.probe),'waiting');
    await js('roomData.value="fixture-room";window.TW_LEGAL_GATE_BLOCKED=true');assert.equal(await js(scripts.probe),'legal');
    await js('window.TW_LEGAL_GATE_BLOCKED=false;window.TogetherWatchMobile=null');assert.equal(await js(scripts.probe),'waiting');
    releaseImage();await loading;
    await win.loadURL(scripts.bootstrap);
    await js('document.body.dataset.roomBootstrap="old-token";localStorage.removeItem("tw_last_room")');
    assert.equal(await js(scripts.initialize),'waiting');assert.equal(await js('localStorage.getItem("tw_last_room")'),null);
    await js('document.body.dataset.roomBootstrap="1234-abcd";Object.defineProperty(window,"localStorage",{get(){throw Error("blocked")}});true');
    assert.equal(await js(scripts.initialize),'storage-error');
    assert.ok(!requests.includes('/')&&!requests.includes('/discover'),'no homepage request in initialization');
    console.log('ANDROID ROOM SCRIPTS PASS: exact-origin bootstrap, escaped nickname, no homepage requests, bridge-ready before slow image, wrong room/late document rejected, consent and storage failures.');
}
app.whenReady().then(run).then(()=>{win?.destroy();app.exit(0);}).catch(error=>{console.error(error);releaseImage?.();win?.destroy();app.exit(1);});
