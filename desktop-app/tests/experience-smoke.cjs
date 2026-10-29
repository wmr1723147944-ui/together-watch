'use strict';
// Real renderer + Socket.IO server. Synthetic timing and public API fixture; no third-party playback.
const {app,BrowserWindow,session}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..');
app.setPath('userData',path.join(app.getPath('temp'),'tw-experience-'+process.pid));
let server,windows=[];
async function until(test,label){for(let i=0;i<120;i++){if(await test())return;await delay(100);}throw Error('timeout: '+label);}
app.whenReady().then(async()=>{
    const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
    const origin='http://127.0.0.1:'+port, output=path.join(root,'.review-artifacts','history-danmaku');fs.mkdirSync(output,{recursive:true});
    server=spawn(process.env.TW_PYTHON||'D:/python3.14/python.exe',['-c',"import runpy;runpy.run_path('tests/experience_test_server.py',run_name='__main__')"],{cwd:root,windowsHide:true,env:{...process.env,PORT:String(port),DISCOVERY_SEARCH_ENABLED:'1'},stdio:['ignore','pipe','pipe']});
    let logs='';server.stdout.on('data',b=>logs=(logs+b).slice(-4000));server.stderr.on('data',b=>logs=(logs+b).slice(-4000));
    try{
        await until(async()=>{try{return(await fetch(origin+'/api/danmaku/status')).ok;}catch{return false;}},'server');
        const p={source:'cupfox',item:'123',episode:'ep1'};
        const room=await(await fetch(origin+'/api/watch-rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selection:p})})).json();
        assert.ok(room.room);
        const errors=[];
        async function client(index,owner,time){
            const ses=session.fromPartition('experience-'+process.pid+'-'+index);
            ses.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith(origin)&&!details.url.startsWith(origin.replace('http:','ws:'))&&!details.url.startsWith('data:')}));
            const win=new BrowserWindow({show:false,width:420,height:850,webPreferences:{sandbox:true,contextIsolation:true,session:ses,backgroundThrottling:false}});windows.push(win);
            win.webContents.on('console-message',(_e,level,message)=>{if(level>=3 && !/Content Security|ERR_BLOCKED_BY_CLIENT|favicon/.test(message))errors.push(message);});
            await win.loadURL(origin+'/terms');
            await win.webContents.executeJavaScript(`localStorage.setItem('tw_legal_notice_version','2026-07-28');localStorage.setItem('tw_username','测试成员${index}');`);
            await win.loadURL(origin+'/mobile-room/'+room.room);
            await until(()=>win.webContents.executeJavaScript('!!window.TogetherWatchMobile?.program()'),'program');
            await win.webContents.executeJavaScript(`(()=>{
                const p=${JSON.stringify(p)},h=TogetherWatchHistory.store;h.remember(p,{title:'集成测试影片',label:'第1集'});h.record(p,{ready:true,time:${time},duration:600});h.prepare(p);
                TogetherWatchMobile.applyProgram(${room.revision});
                window.fixture={active:true,session:1,time:0,duration:600,speed:1,playing:false,ready:true,seeking:false,appliedCommand:0,events:[]};
                window.fixtureTick=setInterval(()=>{TogetherWatchMobile.context({owner:${owner}});TogetherWatchMobile.receive({...fixture});fixture.events=[];
                    const reply=TogetherWatchMobile.drain();window.lastOverlay=reply.overlay;
                    for(const command of reply.commands){if(command.type==='state'){if(command.seek)fixture.time=command.time;fixture.playing=command.playing;fixture.appliedCommand=command.id;}}
                },100);
            })()`);
            return win;
        }
        const host=await client(1,true,85);
        await until(async()=>{const t=await host.webContents.executeJavaScript('fixture.time');return t>=84&&t<90;},'history resume owner');
        const guest=await client(2,false,400);
        await until(async()=>{const t=await guest.webContents.executeJavaScript('fixture.time');return t>=84&&t<100;},'guest follows host not own 400s history');
        await host.webContents.executeJavaScript("fixture.events=[{type:'seek',time:85,speed:1}];fixture.time=85;fixture.playing=false;");
        await delay(500);
        await host.webContents.executeJavaScript("document.getElementById('messageMode').value='danmaku';document.getElementById('chatInput').value='好友弹幕测试';document.getElementById('sendBtn').click();");
        await until(()=>guest.webContents.executeJavaScript("document.getElementById('chatContainer').textContent.includes('好友弹幕测试')"),'peer receives friend comment');
        assert.ok(await guest.webContents.executeJavaScript("lastOverlay.items.some(r=>r.text==='好友弹幕测试')"));
        await guest.webContents.executeJavaScript("document.querySelector('.danmaku-options').open=true;document.getElementById('danmakuQuery').value='集成测试影片';document.getElementById('danmakuSearch').click();");
        await until(()=>guest.webContents.executeJavaScript("document.getElementById('danmakuEpisode').options.length===1"),'public episode matching');
        await guest.webContents.executeJavaScript("document.getElementById('danmakuUse').click()");
        await until(()=>guest.webContents.executeJavaScript("lastOverlay.items.some(r=>r.text==='公共弹幕测试')"),'public timeline');
        await guest.webContents.executeJavaScript("document.getElementById('roomDanmakuEnabled').click()");await delay(200);
        assert.equal(await guest.webContents.executeJavaScript("lastOverlay.items.some(r=>r.kind==='room')"),false);
        await host.webContents.executeJavaScript("fixture.events=[{type:'seek',time:120,speed:1}];fixture.time=120;");
        await until(()=>guest.webContents.executeJavaScript('fixture.time>=119 && lastOverlay.items.length===0'),'seek clears old comments');
        await guest.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(output,'room-settings.png'),(await guest.webContents.capturePage()).toPNG());
        await fetch(origin+'/api/watch-rooms/'+room.room+'/program',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+room.owner},body:JSON.stringify({selection:{...p,episode:'ep2'}})});
        await until(()=>guest.webContents.executeJavaScript('TogetherWatchMobile.program().revision===2'),'episode changed');
        assert.equal(await guest.webContents.executeJavaScript('TogetherWatchMobile.drain().overlay.items.length'),0);
        await host.webContents.executeJavaScript('clearInterval(fixtureTick)');
        // Reuse the same first-party partition, just as the desktop catalogue now does.
        await host.loadURL(origin+'/discover');
        await until(()=>host.webContents.executeJavaScript('!!document.querySelector("#continueWatchingList .history-card")'),'home history card');
        await host.webContents.executeJavaScript("document.querySelector('[data-watch-history]').click()");
        assert.ok(await host.webContents.executeJavaScript('document.getElementById("watchHistoryDialog").open'));
        await host.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(output,'history-mobile.png'),(await host.webContents.capturePage()).toPNG());
        await host.webContents.executeJavaScript("document.querySelector('#watchHistoryList article>button').click()");
        assert.equal(await host.webContents.executeJavaScript('TogetherWatchHistory.store.list().length'),0);
        await host.webContents.executeJavaScript(`(()=>{
            const retired={source:'huarw',item:'123',episode:'123-1'};
            TogetherWatchHistory.store.remember(retired,{title:'已停用来源的旧记录',label:'第1集'});
            TogetherWatchHistory.store.record(retired,{ready:true,time:90});
            dispatchEvent(new Event('tw-history-change'));
        })()`);
        assert.equal(await host.webContents.executeJavaScript('TogetherWatchHistory.store.list().length'),1,'retiring a source preserves history');
        assert.equal(await host.webContents.executeJavaScript('document.querySelectorAll("#watchHistoryList a").length'),0,'retired history must not launch a native room');
        assert.ok(await host.webContents.executeJavaScript('document.getElementById("watchHistoryList").textContent.includes("来源已移除或未启用")'));
        assert.equal(await host.webContents.executeJavaScript('document.getElementById("continueWatching").hidden'),true);
        await host.webContents.executeJavaScript("document.querySelector('#watchHistoryList article>button').click()");
        assert.equal(await host.webContents.executeJavaScript('TogetherWatchHistory.store.list().length'),0,'retired records can still be deleted');
        await host.webContents.executeJavaScript(`TogetherWatchHistory.store.remember(${JSON.stringify(p)},{title:'集成测试影片',label:'第1集'});TogetherWatchHistory.store.record(${JSON.stringify(p)},{ready:true,time:90});document.getElementById('watchHistoryClear').click();`);
        assert.equal(await host.webContents.executeJavaScript('TogetherWatchHistory.store.list().length'),1,'clear requires explicit confirmation');
        await host.webContents.executeJavaScript("document.getElementById('watchHistoryConfirmYes').click()");
        assert.equal(await host.webContents.executeJavaScript('TogetherWatchHistory.store.list().length'),0);
        // Verify the real canvas renderer paints text without intercepting controls.
        const canvasWin=new BrowserWindow({show:false,width:960,height:540,webPreferences:{sandbox:true,backgroundThrottling:false}});windows.push(canvasWin);
        await canvasWin.loadURL('data:text/html,<body style="margin:0;background:%23191e28"><video style="width:100vw;height:100vh;display:block"></video>');
        await canvasWin.webContents.executeJavaScript(fs.readFileSync(path.join(root,'desktop-app/src/danmaku-overlay.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'desktop-app/src/player-agent.js'),'utf8'));
        await canvasWin.webContents.executeJavaScript(`(()=>{const v=document.querySelector('video');Object.defineProperty(v,'currentTime',{get:()=>86});window.__twDesktopPlayer.sample();window.__twDesktopPlayer.overlay({enabled:true,opacity:.85,size:22,items:[{time:84,lane:0,text:'公共弹幕 · 随视频进度显示',kind:'public'},{time:83,lane:1,text:'好友弹幕 · 只在房间内分享',kind:'room'}]});})()`);
        await delay(200);
        assert.ok(await canvasWin.webContents.executeJavaScript("document.querySelector('canvas').getContext('2d').getImageData(0,0,960,540).data.some((v,i)=>i%4===3&&v>0)"));
        assert.equal(await canvasWin.webContents.executeJavaScript("getComputedStyle(document.querySelector('canvas')).pointerEvents"),'none');
        fs.writeFileSync(path.join(output,'danmaku-canvas.png'),(await canvasWin.webContents.capturePage()).toPNG());
        assert.deepEqual(errors,[]);
        console.log('PASS: owner resume, guest progress safety, real room danmaku, public fixture matching, switches, seek, episode reset, history UI, canvas rendering');
    }catch(e){console.error(e);console.error(logs);process.exitCode=1;}
    finally{for(const w of windows)if(!w.isDestroyed())w.destroy();server?.kill();app.exit(process.exitCode||0);}
});
