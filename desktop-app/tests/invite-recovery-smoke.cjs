'use strict';
const assert=require('node:assert/strict');
const {net}=require('electron');
const {setTimeout:delay}=require('node:timers/promises');
// Creates the same canonical programme record as Android. No live user rooms or
// third-party media: all source responses come from an isolated test partition.
exports.run=async({createDesktop,server,until})=>{
    const clients=[];
    async function room(item){
        const r=await net.fetch(server+'/api/watch-rooms',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({selection:{source:'kanju',item,episode:'ep-five'}})});
        assert.equal(r.status,201);return r.json();
    }
    async function guest(record,failures){
        let requests=0;
        const c=await createDesktop({server,visible:false,testMediaFetch:async(url,headers,signal)=>{
            assert.equal(new URL(url).hostname,'www.kanju.ai');
            const r=await net.fetch(server+'/test-media.mp4',{signal,headers:headers.Range?{Range:headers.Range}:{}});
            return {url,status:r.status,headers:Object.fromEntries(r.headers),body:r.body};
        }});clients.push(c);
        await c.start({nickname:'Windows 受邀者',consent:true});
        await c.action('kanju'); // Source-site partition, not the first-party catalogue session.
        await c.state().discoveryView.webContents.session.protocol.handle('https',async req=>{
            const u=new URL(req.url);assert.equal(u.hostname,'www.kanju.ai');
            if(u.pathname.endsWith('.mp4')){const r=await net.fetch(server+'/test-media.mp4');return new Response(r.body,{headers:r.headers});}
            if(!u.pathname.startsWith('/player/'))return new Response('',{status:404});
            requests++;
            if(requests<=failures)return Response.error();
            return new Response('<style>video{width:100%;height:80vh}</style><video controls muted preload="auto" src="/five.mp4"></video><button data-directory-episode="five" class="movie-button-primary">第5集</button>',{headers:{'Content-Type':'text/html'}});
        });
        const joined=await c.start({nickname:'Windows 受邀者',consent:true,room:server+'/room/'+record.room});
        assert.equal(joined.ok,true);return {c,count:()=>requests,allow:()=>{failures=0;}};
    }
    try{
        const first=await guest(await room('invite_retry'),1),c=first.c;
        const roomView=c.state().roomView.webContents;
        try{await until('one failed source load retries and decodes without a manual URL',async()=>{
            const wc=c.state().builtin?.webContents;return wc&&await wc.executeJavaScript('window.__twBuiltin.state().ready');
        },18000);}catch(error){console.log('INVITE DIAGNOSTIC',first.count(),await c.win.webContents.executeJavaScript('({gate:gateText.textContent,header:document.getElementById("status").textContent})'));throw error;}
        assert.equal(first.count(),2);assert.equal(c.state().roomView.webContents,roomView);
        assert.equal(c.state().video.getVisible(),false,'source webpage is not auto-exposed');
        const second=await guest(await room('invite_failed'),100),b=second.c;
        const secondRoom=b.state().current.room,secondView=b.state().roomView.webContents;
        await until('failed source exposes retry instead of black page',()=>b.win.webContents.executeJavaScript('!placeholder.hidden && gateText.textContent.includes("加载失败")'),15000);
        await delay(2500);assert.equal(second.count(),2,'automatic retries must be bounded');
        await b.action('original');await until('manual original really retries same failed URL',()=>second.count()>2);
        assert.equal(b.state().video.getVisible(),false,'failed original must not cover its error panel');
        assert.ok(await b.win.webContents.executeJavaScript('!placeholder.hidden'));
        second.allow();await b.action('retry-source');
        await until('invited guest retries the same episode without host rights',async()=>{
            const wc=b.state().builtin?.webContents;return wc&&await wc.executeJavaScript('window.__twBuiltin.state().ready');
        },18000);
        assert.equal(b.state().current.room,secondRoom);assert.equal(b.state().roomView.webContents,secondView);
        const unchanged=await (await net.fetch(server+'/api/watch-rooms/'+secondRoom+'/program')).json();
        assert.equal(unchanged.revision,1);assert.equal(unchanged.program.episode,'ep-five');
        console.log('INVITE RECOVERY PASS: Android-style programme -> invite-only Windows; first-load failure retries; decoded current episode; room retained; bounded failures show recovery panel; original explicitly reloads failed URL.');
    }finally{for(const c of clients)if(!c.win.isDestroyed())c.close();}
};
