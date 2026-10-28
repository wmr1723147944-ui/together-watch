'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {BrowserWindow,WebContentsView}=require('electron');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function capture(wc,file){
    const state=await wc.executeJavaScript('({width:innerWidth,height:innerHeight,register:!document.getElementById("accountRegistration").hidden})');
    // Hidden native views may have no display surface. Render the same page,
    // cookie partition and viewport with an offscreen compositor for visual QA.
    const preview=new BrowserWindow({width:state.width,height:state.height,show:false,useContentSize:true,
        webPreferences:{offscreen:true,session:wc.session,backgroundThrottling:false,nodeIntegration:false,contextIsolation:true,sandbox:true}});
    let timer;
    try{
        await preview.loadURL(wc.getURL());
        await preview.webContents.executeJavaScript('TogetherWatchAccount.refresh()');
        await preview.webContents.executeJavaScript(`document.querySelector('[data-account-open]').click();${state.register?"document.getElementById('accountSwitch').click();":''}`);
        await delay(350);
        const img=await Promise.race([preview.webContents.capturePage(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Account screenshot timed out')),10000);})]);
        fs.writeFileSync(file,img.toPNG());
    }finally{clearTimeout(timer);preview.destroy();}
}
exports.run=async({createDesktop,server,output,until})=>{
    const client=await createDesktop({server,visible:false});
    const mobile=new BrowserWindow({width:390,height:844,show:false,webPreferences:{partition:'account-smoke-mobile',nodeIntegration:false,contextIsolation:true,sandbox:true}});
    let room;
    try{
        const desktop=client.state().discoveryView.webContents;
        await until('account catalogue',()=>desktop.executeJavaScript('!!window.TogetherWatchAccount?.ready'));
        console.log('ACCOUNTS: local history and registration');
        const episode={source:'kanju',item:'av-account-test',episode:'ep1'};
        await desktop.executeJavaScript(`window.testEpisode=${JSON.stringify(episode)};TogetherWatchHistory.store.remember(testEpisode,{title:'一起看账号测试',label:'第 1 集'});TogetherWatchHistory.store.record(testEpisode,{ready:true,time:88,duration:1200});document.querySelector('.account-nav').click();document.getElementById('accountSwitch').click()`);
        await delay(150);
        await capture(desktop,path.join(output,'account-desktop-register.png'));
        await desktop.executeJavaScript(`document.getElementById('accountLoginName').value='smoke_user';document.getElementById('accountPassword').value='smoke-password-only-123';document.getElementById('accountDisplayName').value='一起看测试';document.getElementById('accountConsent').checked=true;document.getElementById('accountForm').requestSubmit()`);
        await until('register and switch to private account',()=>desktop.executeJavaScript('!!TogetherWatchAccount.user && !document.getElementById("accountMember").hidden && !document.getElementById("accountSubmit").disabled'));
        console.log('ACCOUNTS: explicit import');
        assert.deepEqual(await desktop.executeJavaScript('TogetherWatchHistory.store.list()'),[],'guest history requires explicit import');
        assert.equal(await desktop.executeJavaScript('TogetherWatchHistory.localStore.list().length'),1);
        await desktop.executeJavaScript('document.getElementById("accountImport").click()');
        await until('explicit import completes',()=>desktop.executeJavaScript('TogetherWatchHistory.store.list().length===1 && TogetherWatchAccount.status==="已同步"'));
        assert.equal(await desktop.executeJavaScript('TogetherWatchHistory.store.list()[0].time'),88);
        await delay(100);
        await capture(desktop,path.join(output,'account-desktop-member.png'));
        await mobile.loadURL(server+'/discover');const mw=mobile.webContents;
        console.log('ACCOUNTS: independent mobile login');
        await until('mobile guest account',()=>mw.executeJavaScript('!!TogetherWatchAccount?.ready'));
        assert.equal(await mw.executeJavaScript('TogetherWatchAccount.user'),null);
        assert.equal(await mw.executeJavaScript('TogetherWatchHistory.store.list().length'),0);
        await mw.executeJavaScript('document.querySelector(".catalog-mobile-nav [data-account-open]").click()');
        await delay(150);
        await capture(mw,path.join(output,'account-mobile-login.png'));
        await mw.executeJavaScript(`document.getElementById('accountLoginName').value='smoke_user';document.getElementById('accountPassword').value='smoke-password-only-123';document.getElementById('accountForm').requestSubmit()`);
        await until('same account history on isolated mobile session',()=>mw.executeJavaScript('TogetherWatchHistory.store.list()[0]?.time===88'));
        assert.ok(await mw.executeJavaScript('document.documentElement.scrollWidth<=innerWidth && document.getElementById("accountDialog").getBoundingClientRect().width<=innerWidth'));
        await delay(100);
        await capture(mw,path.join(output,'account-mobile-member.png'));
        // The actual Windows room page uses the catalogue's first-party partition.
        room=new WebContentsView({webPreferences:{session:desktop.session,nodeIntegration:false,contextIsolation:true,sandbox:true}});
        console.log('ACCOUNTS: room progress, deletion and logout');
        await room.webContents.loadURL(server+'/mobile-room/account-smoke');
        await until('room shares login/history',()=>room.webContents.executeJavaScript('TogetherWatchAccount?.user?.username==="smoke_user" && TogetherWatchHistory.store.list().length===1'));
        await room.webContents.executeJavaScript(`TogetherWatchHistory.store.record(${JSON.stringify(episode)},{ready:true,time:150,duration:1200});TogetherWatchAccount.flush()`);
        await mw.executeJavaScript('TogetherWatchAccount.refresh()');
        assert.equal(await mw.executeJavaScript('TogetherWatchHistory.store.list()[0].time'),150);
        await mw.executeJavaScript('TogetherWatchHistory.store.remove(TogetherWatchHistory.store.list()[0]);TogetherWatchAccount.flush()');
        await desktop.executeJavaScript('TogetherWatchAccount.refresh()');
        assert.equal(await desktop.executeJavaScript('TogetherWatchHistory.store.list().length'),0);
        await desktop.executeJavaScript('TogetherWatchAccount.logout()');
        assert.equal(await desktop.executeJavaScript('TogetherWatchHistory.store.list()[0].time'),88,'guest original survives account deletion of row');
        await room.webContents.executeJavaScript('TogetherWatchAccount.refresh()');
        assert.equal(await room.webContents.executeJavaScript('TogetherWatchAccount.user'),null);
        assert.equal(await mw.executeJavaScript('TogetherWatchAccount.user.username'),'smoke_user','logout revokes current device only');
        console.log('ACCOUNTS PASS: real registration/login forms, separate device sessions, manual import, guest preservation, room account sharing, cross-device progress/delete, logout, desktop and 390px layout.');
    }finally{room?.webContents.close();mobile.destroy();client.win.destroy();}
};
