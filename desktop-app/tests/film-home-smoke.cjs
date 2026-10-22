'use strict';
const assert=require('node:assert/strict');
const {net}=require('electron');
exports.run=async({createDesktop,server,until})=>{
    const c=await createDesktop({server,visible:false});
    try {
        const shell=c.win.webContents;
        assert.ok(c.state().browsing);assert.equal(c.state().current,null);
        await until('film home without consent form',()=>shell.executeJavaScript('document.getElementById("setup").hidden && document.getElementById("finderTools").hidden'));
        assert.equal(c.state().discoveryView.getBounds().y,72);
        await until('catalogue ready',()=>c.state().discoveryView.webContents.executeJavaScript('!!document.getElementById("discoveryQuery")'));
        const finder=c.state().discoveryView;
        await finder.webContents.executeJavaScript('window.navigationSentinel="keep-search-document"');
        await c.state().discoveryView.webContents.executeJavaScript('document.querySelector(".nav-room-link").click()');
        await until('join navigation opens native form',()=>shell.executeJavaScript('!document.getElementById("setup").hidden'));
        assert.equal(c.state().current,null);
        await c.action('back');
        assert.equal(c.state().discoveryView,finder,'setup back must keep the original catalogue document');
        assert.equal(await finder.webContents.executeJavaScript('window.navigationSentinel'),'keep-search-document');
        await c.action('home');
        await c.action({type:'source',source:'https://media.w3.org/2010/05/sintel/trailer.mp4'});
        assert.equal(c.state().current,null,'selection alone must not create a room before consent');
        await until('selected film retained in native confirmation',()=>shell.executeJavaScript('document.getElementById("source").value==="https://media.w3.org/2010/05/sintel/trailer.mp4" && !document.getElementById("setup").hidden'));
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
        await until('room initialization finished',()=>shell.executeJavaScript('!document.getElementById("tools").hidden'));
        const data=await(await fetch(server+'/api/watch-rooms/'+c.state().current.room+'/program')).json();
        assert.equal(data.program.source,'sample');assert.equal(data.program.item,'sintel');
        const room=c.state().current.room, roomView=c.state().roomView;
        await c.action('discover');
        assert.equal(c.state().discoveryView,finder,'creating a room must not destroy search');
        await c.action('home');
        assert.equal(c.state().roomView,roomView,'recommendations must not recreate or disconnect room');
        assert.equal(c.state().current.room,room);
        await c.action('back');assert.equal(c.state().browsing,false);
        console.log('FILM HOME PASS: startup browsing, native join, preserved selection, explicit consent, managed room creation.');
    } finally {c.close();}
};
