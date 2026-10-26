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
        if(u.hostname==='image.tmdb.org' && ['/small.jpg','/large.jpg'].includes(u.pathname)) {
            const w=u.pathname==='/small.jpg'?80:640,h=w*1.5;
            return new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#26768c"/><text x="10%" y="50%" font-size="${w/8}" fill="white">COVER</text></svg>`,{headers:{'content-type':'image/svg+xml'}});
        }
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
        // Exercise the actual incremental search grid, not just isolated images.
        await run(`document.body.innerHTML='<section id="sourceDiscovery" class="catalog-browser" data-catalog-mode="films"><input data-live-source="huarw" data-source-name="华人影院" checked><input data-live-source="kanju" data-source-name="看剧 AI" checked><input id="discoveryQuery"><div id="discoveryLiveResults"></div></section>';
            for(const id of ['discoveryWelcome','discoveryLive','discoveryLiveStatus','discoveryForm','discoveryClear','catalogBack','catalogResultCount','catalogResultTitle','catalogSkeleton','catalogEmpty','catalogSearchNotes','catalogSearchNotesBody','catalogSourceChoices','catalogDetailFacts','catalogDetailPoster','recommendationTitle']) {
                const el=document.createElement('div');el.id=id;el.hidden=true;document.body.append(el);
            }
            const style=document.createElement('style');style.textContent='#discoveryLiveResults{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.catalog-film-poster{aspect-ratio:16/10}.catalog-title{aspect-ratio:auto;background:none;margin-top:8px}input{display:none}@media(max-width:500px){#discoveryLiveResults{grid-template-columns:repeat(2,minmax(0,1fr))}}';document.head.append(style);
            window.fetch=async(_url,opts)=>{const source=JSON.parse(opts.body).source;
                const title='Re:从零开始的异世界生活 新编辑版';
                const results=source==='huarw'?[
                    {title,page_url:'https://huarw.com/movie/101',poster_url:'https://image.tmdb.org/small.jpg'},
                    {title:'测试第二季',page_url:'https://huarw.com/movie/102',poster_url:null},
                    {title:'同来源备用',page_url:'https://huarw.com/movie/103',poster_url:'https://image.tmdb.org/bad.jpg',poster_candidates:['https://image.tmdb.org/bad.jpg','https://image.tmdb.org/large.jpg']}
                ]:[{title,page_url:'https://www.kanju.ai/player/sharp',poster_url:'https://image.tmdb.org/large.jpg'},
                    {title: title+'\\u200b',page_url:'https://www.kanju.ai/player/missing',poster_url:null}];
                if(source==='kanju')await new Promise(r=>setTimeout(r,300));
                return {ok:true,json:async()=>({source_id:source,status:'ok',results})};};void 0;`);
        await run(fs.readFileSync(path.join(root,'static/js/catalog-browser.js'),'utf8'));
        await run(`document.dispatchEvent(new Event('DOMContentLoaded'));document.getElementById('discoveryQuery').value='从零开始';document.getElementById('discoveryForm').dispatchEvent(new Event('submit',{cancelable:true}));`);
        await until(`document.querySelectorAll('#discoveryLiveResults article').length===5 && [...document.querySelectorAll('#discoveryLiveResults article')].filter(c=>c.querySelector('img[data-loading="false"]')).length===4`);
        await until(`document.querySelector('#discoveryLiveResults article img[data-loading="false"]')?.naturalWidth===640`);
        assert.equal(await run(`getComputedStyle(document.querySelector('#discoveryLiveResults article img[data-loading="false"]')).objectFit`),'contain');
        assert.equal(await run(`getComputedStyle(document.querySelector('#discoveryLiveResults article .discovery-poster-fallback')).display`),'none','portrait margins must not reveal hidden placeholder text');
        assert.equal(await run(`document.querySelectorAll('#discoveryLiveResults article')[1].querySelector('img')`),null,'different season must not borrow another cover');
        assert.equal(await run(`document.querySelectorAll('#discoveryLiveResults article')[4].querySelector('img[data-loading="false"]').naturalWidth`),640);
        const output=path.join(root,'.review-artifacts/poster-fallback');fs.mkdirSync(output,{recursive:true});
        fs.writeFileSync(path.join(output,'desktop.png'),(await win.webContents.capturePage()).toPNG());
        win.setSize(390,844);await delay(300);
        assert.ok(await run('document.documentElement.scrollWidth<=innerWidth+1'));
        fs.writeFileSync(path.join(output,'mobile.png'),(await win.webContents.capturePage()).toPNG());
        console.log('POSTER PASS: broken original, delayed cross-source fallback, same-source alternatives, incremental search grid, sharp upgrade, portrait containment, provenance, season isolation, desktop/mobile layout.');
        win.destroy();app.exit(0);
    }catch(error){console.error(error);win.destroy();app.exit(1);}
});
