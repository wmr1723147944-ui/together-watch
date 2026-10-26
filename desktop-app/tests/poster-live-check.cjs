'use strict';
// Optional read-only public metadata check. No login/captcha automation or playback.
const {app,BrowserWindow,session}=require('electron');
const {createMetadataBrowser}=require('../src/metadata-browser.cjs');
const path=require('node:path');
const fs=require('node:fs');
const {setTimeout:delay}=require('node:timers/promises');
app.setPath('userData',path.join(app.getPath('temp'),'tw-cover-live-'+process.pid));
app.whenReady().then(async()=>{
    const parent=new BrowserWindow({show:false,width:1100,height:2300,webPreferences:{sandbox:true,partition:'cover-render-'+process.pid}});
    const browser=createMetadataBrowser(parent,session.fromPartition('cover-live-'+process.pid),{hidden:true});
    const all=[];
    try {
        for(const source of ['kanju','huarw']){
            const result=await browser.run('cover-'+source,'search',{source,q:'从零开始'});
            all.push(...(result.results||[]));
            console.log(JSON.stringify({source,status:result.status,rows:result.results?.map(r=>({
                title:r.title,poster:!!r.poster_url,candidates:r.poster_candidates?.length||0,
                imageHost:r.poster_url?new URL(r.poster_url).hostname:null
            }))}));
            const missing=(result.results||[]).filter(r=>!r.poster_url).map(r=>r.page_url);
            const win=BrowserWindow.getAllWindows().find(w=>w!==parent && w.webContents.getURL().includes(source==='kanju'?'kanju.ai':'huarw.com'));
            if(missing.length && win){
                const debug=win.webContents.debugger;
                const {frameTree}=await debug.sendCommand('Page.getFrameTree');
                const {executionContextId}=await debug.sendCommand('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'TogetherWatchPosterDiagnostic',grantUniveralAccess:false});
                const expression=`(()=>{const pages=${JSON.stringify(missing)};return [...document.querySelectorAll('a[href]')].filter(a=>pages.includes(a.href.split('?')[0]) && a.querySelector('img')).slice(0,12).map(a=>({
                    title:a.getAttribute('aria-label')||a.title,
                    images:[a,...a.querySelectorAll('img,source,[style]')].slice(0,8).map(el=>({tag:el.tagName,attrs:[...el.attributes].filter(v=>['src','srcset','data-src','data-original','style'].includes(v.name)).map(v=>({name:v.name,value:v.value.slice(0,500)}))}))
                }));})()`;
                const data=await debug.sendCommand('Runtime.evaluate',{contextId:executionContextId,expression,returnByValue:true,timeout:1500});
                console.log(JSON.stringify({source,missingImageMetadata:data.result?.value}));
            }
        }
        if(process.env.TW_POSTER_LIVE_RENDER==='1' && all.length){
            const root=path.resolve(__dirname,'../..');
            const css=fs.readFileSync(path.join(root,'static/css/source-discovery.css'),'utf8');
            const html=`<!doctype html><meta charset="utf-8"><style>${css}body{font:16px sans-serif;margin:20px;background:#eef3f8}main{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.poster{position:relative;width:100%;height:175px;overflow:hidden;border-radius:10px}.poster img[data-portrait=true]{object-fit:contain}</style><h1>真实搜索封面 · 本地新版</h1><main></main>`;
            await parent.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
            for(const name of ['catalog-adapters.js','source-discovery.js'])await parent.webContents.executeJavaScript(fs.readFileSync(path.join(root,'static/js',name),'utf8'));
            await parent.webContents.executeJavaScript(`(()=>{for(const row of ${JSON.stringify(all)}){
                const card=document.createElement('article'),poster=document.createElement('div');poster.className='poster';
                const title=document.createElement('p');title.textContent=row.title;card.dataset.source=row.source_id;
                TogetherWatchDiscovery.addPoster(document,poster,row.poster_url,row.page_url,row.title,row);
                card.append(poster,title);document.querySelector('main').append(card);
            }})()`);
            await parent.webContents.executeJavaScript(`document.querySelectorAll('img').forEach(i=>i.loading='eager')`);
            await delay(12000);
            const report=await parent.webContents.executeJavaScript(`Array.from(document.querySelectorAll('article')).map(card=>{const img=card.querySelector('img[data-loading="false"]');return {source:card.dataset.source,title:card.querySelector('p').textContent,loaded:!!img,width:img?.naturalWidth,height:img?.naturalHeight,borrowed:!!card.querySelector('.discovery-poster-credit:not([hidden])')}})`);
            console.log(JSON.stringify({rendered:report,loaded:report.filter(r=>r.loaded).length,total:report.length}));
            const out=path.join(root,'.review-artifacts/poster-quality');fs.mkdirSync(out,{recursive:true});
            fs.writeFileSync(path.join(out,'live-desktop.png'),(await parent.webContents.capturePage()).toPNG());
        }
    } finally {browser.destroy();parent.destroy();app.exit(0);}
}).catch(error=>{console.error(error.message);app.exit(1);});
