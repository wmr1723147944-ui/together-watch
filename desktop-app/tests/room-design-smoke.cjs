'use strict';
const {BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
exports.run=async({client,server,output,until})=>{
    fs.writeFileSync(path.join(output,'room-design-windows.png'),(await client.win.capturePage()).toPNG());
    const win=new BrowserWindow({show:false,width:390,height:420,useContentSize:true,webPreferences:{
        offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true,nodeIntegration:false,session:client.state().roomView.webContents.session}});
    try{
        const wc=win.webContents;await win.loadURL(server+'/mobile-room/'+client.state().current.room);
        await until('room rail connected',()=>wc.executeJavaScript('document.getElementById("mobileStatus").textContent.includes("已连接")'));
        for(const [width,height] of [[390,420],[320,360],[400,786]]){
            win.setContentSize(width,height);await delay(150);
            for(const open of [false,true]){
                await wc.executeJavaScript('document.querySelector(".lounge-settings").open='+open+';document.querySelector(".danmaku-options").open='+open);
                const bounds=await wc.executeJavaScript('({width:innerWidth,scroll:document.documentElement.scrollWidth,form:document.getElementById("chatForm").getBoundingClientRect().toJSON(),height:innerHeight,chat:document.getElementById("chatContainer").getBoundingClientRect().height})');
                assert.ok(bounds.scroll<=bounds.width,'no horizontal overflow');
                assert.ok(bounds.form.bottom<=bounds.height+1 && bounds.chat>=48,'chat input remains on screen with settings open');
                await delay(180);fs.writeFileSync(path.join(output,'room-rail-'+width+'-'+(open?'settings':'chat')+'.png'),(await wc.capturePage()).toPNG());
                if(open){
                    await wc.executeJavaScript('document.getElementById("callDock").classList.remove("hidden")');
                    const voice=await wc.executeJavaScript('({bottom:document.getElementById("chatForm").getBoundingClientRect().bottom,height:innerHeight})');
                    assert.ok(voice.bottom<=voice.height+1,'voice and settings must not push the composer off screen: '+JSON.stringify({width,...voice}));
                    await wc.executeJavaScript('document.getElementById("callDock").classList.add("hidden")');
                }
            }
        }
        await wc.executeJavaScript('document.querySelector(".lounge-account").click()');assert.equal(await wc.executeJavaScript('document.getElementById("accountDialog").open'),true);
        console.log('ROOM DESIGN PASS: 320/390/400px rail, settings collapse, composer stays visible, account dialog accessible.');
    }finally{win.destroy();}
};
