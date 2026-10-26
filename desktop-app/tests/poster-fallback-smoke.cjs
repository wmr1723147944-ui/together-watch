'use strict';
// Synthetic HTTPS pages/images only: never bypass an original site's restrictions.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..');
app.setPath('userData',path.join(app.getPath('temp'),'tw-poster-fixture-'+process.pid));
app.whenReady().then(async()=>{
    const ses=session.fromPartition('poster-fixture-'+process.pid);
    const requests=[];
    const css=fs.readFileSync(path.join(root,'static/css/source-discovery.css'),'utf8');
    const icon=fs.readFileSync(path.join(root,'desktop-app/assets/app.png'));
    await ses.protocol.handle('https',req=>{
        const u=new URL(req.url);requests.push(u.href);
        if(u.hostname==='watchtogethernow.cloud')return new Response(`<!doctype html><meta charset="utf-8"><style>${css}
          body{margin:24px;background:#eef2f7;font-family:sans-serif}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:20px}
          button{border:0;position:relative;aspect-ratio:2/3;width:100%;padding:0;overflow:hidden;border-radius:12px}</style>
          <h1>封面回退本地回归</h1><p>模拟原图失效、后到来源补图和不同季隔离；不访问真实影片。</p><main></main>`,{headers:{'content-type':'text/html;charset=utf-8'}});
        if(u.hostname==='image.tmdb.org' && u.pathname.endsWith('/good.jpg'))return new Response(icon,{headers:{'content-type':'image/png'}});
        return new Response('broken fixture image',{status:404});
    });
    const win=new BrowserWindow({show:false,width:900,height:780,webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false,offscreen:true}});
    const run=code=>win.webContents.executeJavaScript(code);
    const until=async code=>{const end=Date.now()+12000;while(Date.now()<end){if(await run(code))return;await delay(80);}throw Error('Poster fixture timed out: '+code);};
    try{
        await win.loadURL('https://watchtogethernow.cloud/');
        for(const file of ['catalog-adapters.js','source-discovery.js'])await run(fs.readFileSync(path.join(root,'static/js',file),'utf8'));
        await run(`window.makeCover=(id,title,year,url,source='huarw')=>{
            const cover=document.createElement('button');cover.id=id;
            const page=source==='huarw'?'https://huarw.com/movie/'+(id==='donor'?2:1):'https://www.kanju.ai/player/'+id;
            TogetherWatchDiscovery.addPoster(document,cover,url,page,title,{source_id:source,source_name:source,title,year,page_url:page,poster_url:url});
            document.querySelector('main').append(cover);return cover;
        };makeCover('broken','测试番剧 第一季','2024','https://image.tmdb.org/bad.jpg');`);
        await until(`document.querySelector('#broken small')?.textContent==='封面暂不可用'`);
        await run(`makeCover('donor','测试番剧 第一季','2024','https://image.tmdb.org/good.jpg','kanju');
            makeCover('other','测试番剧 第二季','2025',null,'kanju');`);
        await until(`document.querySelector('#broken img')?.naturalWidth>1 && !document.querySelector('#broken .discovery-poster-fallback').hidden===false`);
        assert.equal(await run(`document.querySelector('#broken img').src`),'https://image.tmdb.org/good.jpg');
        assert.equal(await run(`document.querySelector('#broken .discovery-poster-credit').textContent`),'参考封面 · kanju');
        assert.equal(await run(`document.querySelector('#other img')`),null);
        assert.equal(requests.filter(url=>url.endsWith('/bad.jpg')).length,1,'failed image is not retried repeatedly');
        assert.ok(requests.every(url=>url.startsWith('https://watchtogethernow.cloud/') || url.startsWith('https://image.tmdb.org/')));
        const output=path.join(root,'.review-artifacts/poster-fallback');fs.mkdirSync(output,{recursive:true});
        fs.writeFileSync(path.join(output,'desktop.png'),(await win.webContents.capturePage()).toPNG());
        win.setSize(390,844);await delay(300);
        assert.ok(await run('document.documentElement.scrollWidth<=innerWidth+1'));
        fs.writeFileSync(path.join(output,'mobile.png'),(await win.webContents.capturePage()).toPNG());
        console.log('POSTER PASS: broken original, delayed cross-source fallback, provenance badge, season isolation, bounded requests, desktop/mobile layout.');
        win.destroy();app.exit(0);
    }catch(error){console.error(error);win.destroy();app.exit(1);}
});
