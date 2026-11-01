'use strict';
// Local synthetic artwork only: real rendering, no source-site/CDN dependency.
const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict'),{setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'.review-artifacts/handset-ratio');
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
    await until('spotlight shapes',()=>js('document.querySelectorAll("#catalogSpotlightGrid [data-poster-shape]").length===5 && document.getElementById("catalogHeroImage").dataset.posterShape==="portrait"'));
    async function inspect(){
        const result=await js(`(()=>{
            const art=document.getElementById('catalogHeroImage'),image=art.querySelector('img:not([data-loading="true"])'),hero=document.getElementById('catalogHero'),copy=hero.querySelector('.catalog-hero-copy'),stage=hero.closest('.catalog-spotlight');
            const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
            const style=getComputedStyle(art);
            return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,shape:art.dataset.posterShape,art:rect(art),hero:rect(hero),copy:rect(copy),stage:rect(stage),imageFit:getComputedStyle(image).objectFit,
                mask:style.maskImage,composite:style.maskComposite,opacity:+style.opacity,shadow:style.boxShadow,blur:style.filter,heroBackground:getComputedStyle(hero).backgroundColor,
                primary:rect(document.getElementById('catalogHeroOpen')),browse:rect(hero.querySelector('.hero-browse')),dots:rect(document.getElementById('catalogSpotlightGrid')),
                cards:Array.from(document.querySelectorAll('#catalogFeedGrid .catalog-film-poster')).map(el=>({rect:rect(el),ratio:+el.style.getPropertyValue('--poster-ratio')||2/3}))};
        })()`);
        assert.equal(result.overflow,false,'no horizontal overflow');
        for(const edge of ['x','y','width','height'])assert.ok(Math.abs(result.art[edge]-result.stage[edge])<1,'cover spans the full stage, not only the right: '+edge);
        assert.equal(result.imageFit,'cover','banner crops proportionally instead of stretching or containing a portrait on the right');
        if(result.width>680){
            assert.match(result.mask,/linear-gradient/,'desktop keeps its full-stage gradient');
            assert.match(result.composite,/intersect/,'horizontal and vertical edge fades intersect');
            assert.ok(result.opacity>.65 && result.opacity<1,'desktop artwork stays translucent');
        }else{
            assert.equal(result.mask,'none','mobile rounded feature keeps its own clear artwork');
            assert.equal(result.opacity,1,'mobile cover is not dimmed by desktop transparency');
        }
        assert.equal(result.shadow,'none','hero artwork has no floating-card shadow');
        assert.equal(result.blur,'none','main artwork stays clear');
        assert.equal(result.heroBackground,'rgba(0, 0, 0, 0)','hero has no opaque panel');
        assert.ok(result.copy.x>=result.hero.x && result.copy.right<=result.hero.right,'copy stays inside hero');
        if(result.width>680)assert.ok(result.primary.bottom<=result.browse.y,'long titles never push the action behind preview controls');
        else assert.ok(result.primary.right<result.dots.x,'mobile dots do not cover the detail action: '+JSON.stringify({action:result.primary,dots:result.dots}));
        for(const card of result.cards)assert.ok(Math.abs(card.rect.width/card.rect.height-(result.width>680?card.ratio:1.6))<.015,'desktop poster ratio / mobile landscape shelf');
        console.log('PASS layout',result.width,result.shape);
    }
    for(const width of [1920,1440,1024,768,390,320]){
        win.setContentSize(width,width<=390?844:950);await delay(250);await inspect();
        if([1440,768,390,320].includes(width))fs.writeFileSync(path.join(output,`portrait-${width}.png`),(await wc.capturePage()).toPNG());
        await js('document.getElementById("catalogHeroTitle").textContent="这是一个用于检查换行的超长影片名称：特别篇与全新故事的延续（完整版）"');
        await inspect();
        assert.ok(await js('(()=>{const h=document.getElementById("catalogHero").getBoundingClientRect(),c=document.querySelector(".catalog-hero-copy").getBoundingClientRect();return c.top>=h.top && c.bottom<=h.bottom})()'),'long title stays within hero');
        await js('document.getElementById("catalogHeroTitle").textContent="比例测试影片 1"');
    }
    for(const [category,shape] of [['movie','landscape'],['series','square'],['all','portrait']]){
        await js(`document.querySelector('[data-catalog-category=${category}]').click()`);
        await until('hero '+shape,()=>js(`document.getElementById('catalogHeroImage').dataset.posterShape===${JSON.stringify(shape)}`));
        for(const width of [1440,390,320]){
            win.setContentSize(width,width<=390?844:950);await delay(200);await inspect();
            if(width!==320)fs.writeFileSync(path.join(output,`${shape}-${width}.png`),(await wc.capturePage()).toPNG());
        }
    }
    win.setContentSize(1440,950);await delay(200);
    await js('document.querySelector("#catalogSpotlightGrid .catalog-film-poster").click()');
    assert.equal(await js('document.getElementById("discoveryDetail").open'),false,'preview must not navigate or open details');
    await js('document.getElementById("catalogHeroOpen").click()');
    await until('detail remains functional',()=>js('document.querySelectorAll("#discoveryEpisodes a").length===1'));
    await js('document.getElementById("discoveryDetailClose").click(); document.querySelector("#catalogSpotlightGrid .discovery-poster-image").dispatchEvent(new Event("error"))');
    assert.equal(await js('document.querySelector("#catalogSpotlightGrid .catalog-film-poster").dataset.posterShape'),undefined);
    await inspect();
    assert.deepEqual(errors.filter(e=>!/net::|Failed to load resource/.test(e)),[]);
    console.log('PASS: portrait/square/landscape hero, mixed-ratio spotlight, 6 viewport widths, category reset, detail, failed image; evidence '+output);
}
function finish(code){backend?.kill();win?.destroy();app.exit(code);}
app.whenReady().then(run).then(()=>finish(0)).catch(e=>{console.error(e.stack,log);finish(1);});
