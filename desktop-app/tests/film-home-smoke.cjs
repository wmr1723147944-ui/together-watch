'use strict';
const assert=require('node:assert/strict');
const {net,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path');
exports.run=async({createDesktop,server,until,output})=>{
    const c=await createDesktop({server,visible:false});
    try {
        const shell=c.win.webContents;
        await shell.executeJavaScript('localStorage.removeItem("tw_desktop_consent");document.getElementById("consent").checked=false');
        assert.ok(c.state().browsing);assert.equal(c.state().current,null);
        await until('film home without consent form',()=>shell.executeJavaScript('document.getElementById("setup").hidden && document.getElementById("finderTools").hidden'));
        assert.equal(c.state().discoveryView.getBounds().y,72);
        await until('catalogue ready',()=>c.state().discoveryView.webContents.executeJavaScript('!!document.getElementById("discoveryQuery")'));
        const finder=c.state().discoveryView;
        await finder.webContents.executeJavaScript('window.navigationSentinel="keep-search-document"');
        await c.state().discoveryView.webContents.executeJavaScript('document.querySelector(".nav-room-link").click()');
        await until('join navigation opens native form',()=>shell.executeJavaScript('!document.getElementById("setup").hidden'));
        assert.ok(await shell.executeJavaScript('document.getElementById("setup").open && document.getElementById("setup").getBoundingClientRect().width<=480 && !document.getElementById("manualEntry").open'));
        assert.equal(c.state().current,null);
        await c.action('back');
        assert.equal(c.state().discoveryView,finder,'setup back must keep the original catalogue document');
        assert.equal(await finder.webContents.executeJavaScript('window.navigationSentinel'),'keep-search-document');
        await c.action('home');
        await c.action({type:'source',source:'https://media.w3.org/2010/05/sintel/trailer.mp4'});
        assert.equal(c.state().current,null,'selection alone must not create a room before consent');
        await until('selected film retained in native confirmation',()=>shell.executeJavaScript('document.getElementById("source").value==="https://media.w3.org/2010/05/sintel/trailer.mp4" && !document.getElementById("setup").hidden'));
        assert.ok(await shell.executeJavaScript('document.getElementById("roomField").hidden && document.getElementById("manualEntry").hidden && document.getElementById("profileFields").open'));
        await new Promise(resolve=>setTimeout(resolve,250));
        fs.writeFileSync(path.join(output,'first-watch-dialog.png'),(await shell.capturePage()).toPNG());
        await c.action('back');
        assert.equal(c.state().discoveryView,finder);
        assert.equal(c.state().current,null);
        await c.action({type:'source',source:'https://media.w3.org/2010/05/sintel/trailer.mp4'});
        await c.state().mediaSession.protocol.handle('https',async request=>{
            const r=await net.fetch(server+'/test-media.mp4',{headers:request.headers.has('range')?{range:request.headers.get('range')}:{}});
            return new Response(r.body,{status:r.status,headers:r.headers});
        });
        // Failed validation must preserve the pending selection and not create a room.
        assert.equal((await c.start({nickname:'guest',source:'https://media.w3.org/2010/05/sintel/trailer.mp4',consent:false})).ok,false);
        assert.equal(c.state().current,null);
        await shell.executeJavaScript('document.getElementById("nickname").value="选片房主";document.getElementById("consent").checked=true;document.getElementById("startForm").requestSubmit()');
        await until('confirmed film creates managed room',()=>!!c.state().current);
        await until('room initialization finished',()=>shell.executeJavaScript('!document.getElementById("tools").hidden'));
        const data=await(await fetch(server+'/api/watch-rooms/'+c.state().current.room+'/program')).json();
        assert.equal(data.program.source,'sample');assert.equal(data.program.item,'sintel');
        const room=c.state().current.room, roomView=c.state().roomView;
        assert.equal(c.state().video.getBounds().y,128);
        assert.deepEqual(await shell.executeJavaScript('Array.from(document.querySelectorAll(".room-actions button")).filter(b=>!b.hidden).map(b=>b.textContent)'),['选集','邀请朋友','全屏','更多 ···']);
        assert.ok(await shell.executeJavaScript('document.getElementById("roomMore").hidden && document.getElementById("settings").hidden'));
        await shell.executeJavaScript('document.getElementById("more").click()');
        await until('advanced options expand above native video',()=>c.state().video.getBounds().y===328);
        await until('options rendered',()=>shell.executeJavaScript('!document.getElementById("roomMore").hidden'));
        assert.equal(c.state().current.room,room);assert.equal(c.state().roomView,roomView);
        assert.ok(await shell.executeJavaScript('document.getElementById("more").getAttribute("aria-expanded")==="true"'));
        for(const width of [980,1360]) {
            c.win.setContentSize(width,850);
            assert.ok(await shell.executeJavaScript('document.documentElement.scrollWidth<=innerWidth && document.getElementById("sourceForm").getBoundingClientRect().bottom<=328'));
        }
        fs.writeFileSync(path.join(output,'room-controls-expanded.png'),(await shell.capturePage({x:0,y:0,width:1360,height:328})).toPNG());
        await c.action('back');assert.equal(c.state().browsing,false,'back closes options before navigating');
        assert.equal(c.state().video.getBounds().y,128);
        await new Promise(resolve=>setTimeout(resolve,250));
        fs.writeFileSync(path.join(output,'room-controls-compact.png'),(await shell.capturePage({x:0,y:0,width:1360,height:128})).toPNG());
        const realDialog=dialog.showMessageBox;
        try {
            dialog.showMessageBox=async(_win,options)=>{assert.equal(options.cancelId,0);assert.match(options.message,/离开/);return {response:0};};
            await c.action('leave');assert.equal(c.state().current.room,room,'cancel leave keeps room and voice connected');
        } finally {dialog.showMessageBox=realDialog;}
        await c.action('discover');
        assert.equal(c.state().discoveryView,finder,'creating a room must not destroy search');
        await c.action('home');
        assert.equal(c.state().roomView,roomView,'recommendations must not recreate or disconnect room');
        assert.equal(c.state().current.room,room);
        await c.action('back');assert.equal(c.state().browsing,false);
        try {
            dialog.showMessageBox=async()=>({response:1});
            await c.action('leave');
        } finally {dialog.showMessageBox=realDialog;}
        await until('leave returns to films not an entry form',()=>!c.state().current && c.state().browsing && shell.executeJavaScript('document.getElementById("setup").hidden'));
        assert.equal(c.state().discoveryView,finder);
        assert.equal(await shell.executeJavaScript('localStorage.getItem("tw_desktop_consent")'),'2026-07-28');
        await c.action({type:'source',source:'https://media.w3.org/2010/05/sintel/trailer.mp4'});
        await until('returning viewer automatically enters selected film',()=>!!c.state().current && c.state().current.room!==room);
        await until('automatic room ready without form',()=>shell.executeJavaScript('document.getElementById("setup").hidden && !document.getElementById("tools").hidden'));
        const guest=await createDesktop({server,visible:false});
        try {
            const guestShell=guest.win.webContents;
            await guest.action('settings');
            await until('join-only modal',()=>guestShell.executeJavaScript('document.getElementById("setup").open && !document.getElementById("profileFields").open'));
            await new Promise(resolve=>setTimeout(resolve,250));
            fs.writeFileSync(path.join(output,'join-invitation-dialog.png'),(await guestShell.capturePage()).toPNG());
            await guestShell.executeJavaScript(`document.getElementById('room').value=${JSON.stringify(c.state().current.room)};document.getElementById('startForm').requestSubmit()`);
            await until('invitation joins same room without re-entering source',()=>guest.state().current?.room===c.state().current.room);
        } finally {guest.close();}
        console.log('ROOM CONTROLS PASS: four primary actions, advanced drawer and native bounds, responsive header, back collapse, cancelled leave preserves room; film-home navigation retained.');
        console.log('QUICK ENTRY PASS: first-use consent only, returning selection auto-creates room, leave returns to films, invitation-only modal joins same room.');
    } finally {c.close();}
};
