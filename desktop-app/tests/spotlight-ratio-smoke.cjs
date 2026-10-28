'use strict';
// Local synthetic artwork only: real rendering, no source-site/CDN dependency.
const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict'),{setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'.review-artifacts/spotlight-ratio');
let backend,win,log='';
async function until(name,fn){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await delay(100);}throw Error('Timeout: '+name);}
async function run(){
    fs.mkdirSync(output,{recursive:true});
    const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
    const port=reserve.address().port;await new Promise(r=>reserve.close(r));const server='http://127.0.0.1:'+port;
    backend=spawn(process.env.TW_SMOKE_PYTHON||'python',['-u','-c',`
import app as m
import source_search, catalog_recommendations
m.enabled_search_sources=lambda: [dict(source_search.PROVIDERS['cupfox'])]
def feed(source,category,page):
    shapes=['portrait','portrait','landscape','square','portrait']
    if category=='movie': shapes[0]='landscape'
    elif category=='series': shapes[0]='square'
    rows=[dict(title='比例测试影片 '+str(i+1),year='2024',page_url=f'https://www.cupfox.in/vod-detail/{100+i}.html',poster_url=f'https://image.tmdb.org/t/p/w500/{shape}{i}.jpg') for i,shape in enumerate(shapes)] if source=='cupfox' else []
    return dict(source_id=source,category=category,page=page,status='ok',results=rows,has_more=False,next_page=None)
catalog_recommendations.load_page=feed
def detail(source,page):
    item=page.rsplit('/',1)[-1].split('.')[0]
    return dict(source_id=source,page_url=page,item_id=item,title='比例测试',status='ok',episodes=[dict(id='ep1',title='第1集',launch_path=f'/discover/play/cupfox/{item}/ep1')])
m.load_detail=detail
m.app.run(host='127.0.0.1',port=${port},use_reloader=False)
`],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,APP_ENV:'development',SECRET_KEY:'local-ratio-test-only'}});
    backend.stdout.on('data',d=>log=(log+d).slice(-4000));backend.stderr.on('data',d=>log=(log+d).slice(-4000));
    await until('backend',async()=>{try{return(await fetch(server+'/health')).ok;}catch{return false;}});
    win=new BrowserWindow({show:false,width:1440,height:950,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'ratio-'+process.pid}});
    const wc=win.webContents,js=s=>wc.executeJavaScript(s),errors=[];
    wc.on('console-message',(_event,details)=>{if(details.level==='error')errors.push(details.message);});
    await wc.session.protocol.handle('https',req=>{
        if(new URL(req.url).hostname!=='image.tmdb.org')return new Response('',{status:404});
        const shape=req.url.includes('portrait')?'portrait':req.url.includes('landscape')?'landscape':'square';
        const [w,h]=shape==='portrait'?[600,900]:shape==='landscape'?[1200,675]:[600,600];
        return new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#395c7a"/><rect x="12" y="12" width="${w-24}" height="${h-24}" fill="none" stroke="#f0cf8b" stroke-width="12"/><circle cx="${w/2}" cy="${h/2}" r="100" fill="#c86b76"/><text x="50%" y="28%" text-anchor="middle" font-size="44" fill="white">${w} × ${h}</text></svg>`,{headers:{'content-type':'image/svg+xml'}});
    });
    await win.loadURL(server+'/discover');
    await until('spotlight shapes',()=>js('document.querySelectorAll("#catalogSpotlightGrid [data-poster-shape]").length===4 && document.getElementById("catalogHeroImage").dataset.posterShape==="portrait"'));
    async function inspect(){
        const result=await js(`(()=>{
            const art=document.getElementById('catalogHeroImage'),image=art.querySelector('img:not([data-loading="true"])'),hero=document.getElementById('catalogHero'),copy=hero.querySelector('.catalog-hero-copy');
            const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
            return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,shape:art.dataset.posterShape,art:rect(art),hero:rect(hero),copy:rect(copy),ratio:image.naturalWidth/image.naturalHeight,
                cards:Array.from(document.querySelectorAll('#catalogSpotlightGrid .catalog-film-poster')).map(el=>({rect:rect(el),ratio:+el.style.getPropertyValue('--poster-ratio')||2/3}))};
        })()`);
        assert.equal(result.overflow,false,'no horizontal overflow');
        if(result.shape!=='landscape'){
            assert.ok(Math.abs(result.art.width/result.art.height-result.ratio)<.015,'hero poster frame matches artwork');
            assert.ok(result.copy.right<=result.art.x+1,'copy must not cover portrait artwork');
            assert.ok(result.art.bottom<=result.hero.bottom+1,'poster stays inside hero');
        }
        if(result.width>680)for(const card of result.cards)assert.ok(Math.abs(card.rect.width/card.rect.height-card.ratio)<.015,'spotlight frame matches artwork');
        console.log('PASS layout',result.width,result.shape);
    }
    for(const width of [1920,1440,1024,768,390,320]){
        win.setContentSize(width,width<=390?844:950);await delay(250);await inspect();
        if([1440,768,390,320].includes(width))fs.writeFileSync(path.join(output,`portrait-${width}.png`),(await wc.capturePage()).toPNG());
    }
    for(const [category,shape] of [['movie','landscape'],['series','square'],['all','portrait']]){
        await js(`document.querySelector('[data-catalog-category=${category}]').click()`);
        await until('hero '+shape,()=>js(`document.getElementById('catalogHeroImage').dataset.posterShape===${JSON.stringify(shape)}`));
        await inspect();
    }
    win.setContentSize(1440,950);await delay(200);
    await js('document.querySelector("#catalogSpotlightGrid .catalog-film-poster").click()');
    await until('detail remains functional',()=>js('document.querySelectorAll("#discoveryEpisodes a").length===1'));
    await js('document.getElementById("discoveryDetailClose").click(); document.querySelector("#catalogSpotlightGrid .discovery-poster-image").dispatchEvent(new Event("error"))');
    assert.equal(await js('document.querySelector("#catalogSpotlightGrid .catalog-film-poster").dataset.posterShape'),undefined);
    await inspect();
    assert.deepEqual(errors.filter(e=>!/net::|Failed to load resource/.test(e)),[]);
    console.log('PASS: portrait/square/landscape hero, mixed-ratio spotlight, 6 viewport widths, category reset, detail, failed image; evidence '+output);
}
function finish(code){backend?.kill();win?.destroy();app.exit(code);}
app.whenReady().then(run).then(()=>finish(0)).catch(e=>{console.error(e.stack,log);finish(1);});
