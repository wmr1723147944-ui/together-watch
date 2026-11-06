'use strict';
const {dialog,shell,net,session}=require('electron');
const assert=require('node:assert/strict');
exports.run=async({createDesktop,server,until})=>{
    const client=await createDesktop({server,visible:false}),messages=[],opened=[];
    const oldDialog=dialog.showMessageBox,oldOpen=shell.openExternal;
    let reply={schema:1,available:false},answer=1,calls=0;
    try {
        dialog.showMessageBox=async(_win,options)=>{messages.push(options);return {response:answer};};
        shell.openExternal=async url=>{opened.push(url);};
        await session.defaultSession.protocol.handle('http',request=>{
            if(request.url===server+'/api/client-updates/windows'){calls++;return new Response(JSON.stringify(reply));}
            return net.fetch(request,{bypassCustomProtocolHandlers:true});
        });
        await client.action('check-updates');assert.match(messages.pop().message,/尚未发布/);
        reply={schema:1,available:true,release:{platform:'windows',version:'0.6.25',filename:'TogetherWatch-Windows-0.6.25-x64.zip',
            download_path:'/downloads/files/TogetherWatch-Windows-0.6.25-x64.zip',size:123,sha256:'a'.repeat(64),notes:['测试更新']}};
        await client.win.webContents.executeJavaScript('document.getElementById("checkUpdates").click();true');
        await until('manual update dialog',()=>messages.length===1);
        assert.match(messages[0].message,/0\.6\.25/);assert.ok(messages[0].buttons.includes('稍后提醒'));
        assert.equal(opened.length,0,'later must not open browser or install');messages.length=0;
        answer=0;await client.action('check-updates');
        assert.deepEqual(opened,['https://watchtogethernow.cloud/downloads']);
        reply.release.download_path='https://evil.invalid/installer.exe';messages.length=0;
        await client.action('check-updates');assert.match(messages[0].message,/无法检查/);
        assert.equal(opened.length,1);assert.equal(calls,4);
        assert.equal(await client.win.webContents.executeJavaScript('document.getElementById("checkUpdates").disabled'),false);
        console.log('CLIENT UPDATES PASS: real shell button and IPC, unpublished server, release notes, later without download, fixed first-party download page, malformed response stays non-blocking.');
    } finally {dialog.showMessageBox=oldDialog;shell.openExternal=oldOpen;session.defaultSession.protocol.unhandle('http');client.close();}
};
