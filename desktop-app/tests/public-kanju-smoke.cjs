'use strict';
// Opt-in public-site probe. All rooms are local, new isolated sessions only.
// Never print addresses from the player, credentials or signed query strings.
const {BrowserWindow,session}=require('electron');
const {setTimeout:delay}=require('node:timers/promises');
exports.run=async({createDesktop,server,until})=>{
    const finder=new BrowserWindow({show:false,webPreferences:{session:session.fromPartition('public-lookup-'+process.pid),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const wc=finder.webContents;wc.setAudioMuted(true);wc.setWindowOpenHandler(()=>({action:'deny'}));
    const loadPublic=async url=>{try{await wc.loadURL(url);}catch{await delay(1000);await wc.loadURL(url);}};
    let client;
    try {
        await loadPublic('https://www.kanju.ai/collections/browse?path=%2Fv1%2Fbrowse%2Fcatalog&q='+encodeURIComponent(process.env.TW_SMOKE_PUBLIC_TITLE || '嫁金钗')+'&page=1&limit=12');
        let page,program;
        await until('public search',async()=>{page=await wc.executeJavaScript("document.querySelector('a[href^=\"/player/\"]')?.href");return page && new URL(page).origin==='https://www.kanju.ai';},30000);
        await loadPublic(page);
        await until('public episode',async()=>{program=await wc.executeJavaScript(`(()=>{const b=document.querySelector('button[data-directory-episode].movie-button-primary,button[data-directory-episode][aria-selected=true],button[data-directory-episode]');return b&&[decodeURIComponent(location.pathname.split('/').pop()),b.getAttribute('data-directory-episode')];})()`);return program?.every(s=>/^[a-zA-Z0-9_:-]+$/.test(s));},30000);
        finder.destroy();
        client=await createDesktop({server,visible:false});
        const result=await client.start({nickname:'公开页测试',consent:true,source:server+'/discover/play/kanju/'+program[0]+'/ep-'+program[1]});
        if(!result.ok)throw Error('local room creation failed');
        let target='',frame;
        for(let i=0;i<27;i++){
            await delay(2000);
            const s=client.state(),pw=s.builtin?.webContents;
            const shape=await s.video.webContents.executeJavaScript("(()=>{const v=document.querySelector('video');return v?{blob:v.currentSrc.startsWith('blob:'),ready:v.readyState,long:v.duration>=120}:{};})()").catch(()=>({}));
            const b=pw&&await pw.executeJavaScript('window.__twBuiltin?.state()').catch(()=>null);
            if(i%4===0)console.log('public sample',JSON.stringify({shape,builtin:b,inline:!!s.inline}));
            if(b?.ready&&!b.error){target='independent';frame=pw;break;}
            if(s.inline && shape.ready>=3 && s.selected){target='same-page video only';frame=s.video.webContents;break;}
        }
        if(!frame)throw Error('did not reach playable state automatically');
        // Genuine user gesture on the chosen renderer, not a synthetic play
        // promise: check decoded frames and clock progression.
        frame.debugger.attach('1.3');await frame.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
        await frame.executeJavaScript("document.addEventListener('keydown',()=>document.querySelector('video').play().catch(()=>{}),{once:true});true");
        await frame.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'q',code:'KeyQ',windowsVirtualKeyCode:81});
        const at=await frame.executeJavaScript("document.querySelector('video').currentTime");
        await until('decoded playback advances',()=>frame.executeJavaScript("document.querySelector('video').currentTime>"+(at+1.5)),12000);
        console.log('PUBLIC PLAYBACK PASS: '+target+'; no manual line selection.');
    }finally{if(!finder.isDestroyed())finder.destroy();client?.close();}
};
