const {test}=require('node:test');
const assert=require('node:assert/strict');
const a=require('../static/js/catalog-adapters.js');
const {addPoster,createPosterPool,registerPosters}=require('../static/js/source-discovery.js');
const observed=require('./poster-source-fixture.json');
test('observed Huarw lazy cover hosts are accepted without broadening image URL types',()=>{
    for(const url of require('./poster-huarw-fixture.json')){
        assert.equal(a.safePosterUrl(url),url);
        for(const bad of [url.replace(new URL(url).hostname,new URL(url).hostname+'.evil.test'),url+'?token=secret',url.replace(/\.(jpg|webp)$/,'.mp4')])assert.equal(a.safePosterUrl(bad),null);
    }
});

test('PKAVI and Kanju public covers survive validation and rendering; wrapper is not an open proxy',()=>{
    for(const url of Object.values(observed))assert.equal(a.safePosterUrl(url),url);
    const wrapper=observed.kanju;
    for(const url of [wrapper+'?token=secret',wrapper+'#x',wrapper.replace('https:','http:'),
        wrapper.replace('gimg0.baidu.com','gimg0.baidu.com.evil.test'),wrapper.replace('gimg0.baidu.com','sub.gimg0.baidu.com'),
        wrapper.replace('img.baipiaozhe.com','127.0.0.1'),wrapper.replace('img.baipiaozhe.com','evil.test'),
        wrapper.replace('img.baipiaozhe.com','img.baipiaozhe.com.evil.test'),wrapper.replace('.webp','.mp4'),
        wrapper.replace('/assets/images/','/private/'),wrapper.replace('src=img.','src=https://img.'),
        wrapper.replace('src=img.','src=user@img.'),wrapper.replace('&n=0','&n=0&url=http://localhost'),
        wrapper.replace('gimg0.baidu.com','user@gimg0.baidu.com')])assert.equal(a.safePosterUrl(url),null,url);
    for(const source of ['pkavi','kanju']) {
        const req=a.request('search',{source,q:'测试'}), page=source==='pkavi'?'https://www.pkavi.com/mv/123.html':'https://www.kanju.ai/player/abc';
        const result=a.normalizeResult(req,{status:'ok',results:[{title:'测试',page_url:page,poster_url:observed[source]}]});
        assert.equal(result.results[0].poster_url,observed[source]);
    }
});

test('poster URLs accept known image CDNs only, not video, credentials, proxy queries or local networks',()=>{
    assert.equal(a.safePosterUrl('/movies/reset.webp','https://img.ddys.io'),'https://img.ddys.io/movies/reset.webp');
    for(const url of ['https://127.0.0.1/a.jpg','https://img.ddys.io.evil.test/a.jpg','http://img.ddys.io/a.jpg',
        'https://user@img.ddys.io/a.jpg','https://img.ddys.io/a.mp4','https://img.ddys.io/a.svg',
        'https://img.ddys.io/a.jpg?token=secret','https://img.ddys.io:444/a.jpg','https://img.ddys.io/a.jpg#secret',
        'data:image/png;base64,AAA','https://img.ddys.io/loading.gif','https://img.ddys.io/a.jpg?url=foo']) {
        assert.equal(a.safePosterUrl(url),null,url);
    }
});

test('observed Huarw and FCMA image CDNs do not grant arbitrary image or media access',()=>{
    for(const host of ['www.lufys.com','img.ffzy888.com','www.mdzypic.com','img.lzipic.com','snzypic.vip','p.bfvp26.com','img.picbf.com','pps.vodfeiss.com','img.liangzipic.com']) {
        assert.equal(a.safePosterUrl('https://'+host+'/upload/vod/a.webp'),'https://'+host+'/upload/vod/a.webp');
        for(const url of ['https://'+host+'.evil.test/a.jpg','https://'+host+'/a.mp4','https://'+host+'/a.jpg?token=secret'])assert.equal(a.safePosterUrl(url),null);
    }
});

test('native metadata keeps validated cover but drops private fields',()=>{
    const req=a.request('search',{source:'kanju',q:'测试'});
    const result=a.normalizeResult(req,{status:'ok',results:[{title:'测试',page_url:'https://www.kanju.ai/player/abc',
        poster_url:'https://image.tmdb.org/t/p/w500/a.jpg',cookie:'secret'}]});
    assert.equal(result.results[0].poster_url,'https://image.tmdb.org/t/p/w500/a.jpg');
    assert.ok(!JSON.stringify(result).includes('secret'));
    result.results[0].poster_url='https://localhost/a.jpg';
    result.results[0].poster_candidates=['https://localhost/a.jpg'];
    assert.equal(a.normalizeResult(req,result).results[0].poster_url,null);
});

test('cover does not block the card and falls back on broken images without retry loops',()=>{
    const make=tag=>({tag,dataset:{},children:[],handlers:{},append(...nodes){this.children.push(...nodes);},addEventListener(e,fn){this.handlers[e]=fn;}});
    const doc={createElement:make},cover=make('button');
    addPoster(doc,cover,'https://img.ddys.io/movies/reset.webp','https://ddys.io/movie/reset','开端');
    const [fallback,img]=cover.children;
    assert.equal(img.loading,'lazy'); assert.equal(img.referrerPolicy,'no-referrer'); assert.equal(img.alt,'');
    assert.equal(img.hidden,false); assert.equal(img.dataset.loading,'true');
    img.handlers.load(); assert.equal(img.hidden,false); assert.equal(fallback.hidden,true);
    img.handlers.error(); assert.equal(img.hidden,true); assert.equal(fallback.hidden,false);
    assert.equal(fallback.children[1].textContent,'封面暂不可用');
    const noCover=make('button');addPoster(doc,noCover,'javascript:alert(1)','https://ddys.io','<img>');
    assert.equal(noCover.children.length,1);assert.equal(noCover.children[0].children[0].textContent,'<img>');
});

test('DOM metadata matches separate image/title anchors by canonical film, never neighbouring titles',()=>{
    const req=a.request('search',{source:'kanju',q:'测试'});
    const anchor=(href,title,src)=>({getAttribute(k){return {href,'aria-label':title}[k]||null;},textContent:'',
        querySelectorAll(){return src?[{getAttribute(k){return k==='data-src'?src:null;}}]:[];}});
    const links=[anchor('/player/abc?from=collection','', 'https://image.tmdb.org/a.jpg'),
        anchor('/player/abc','打开播放器：测试甲'),anchor('/player/def','打开播放器：测试乙')];
    const doc={title:'目录',querySelector(){return null;},querySelectorAll(){return links;},body:{textContent:''}};
    const result=a.readDocument(doc,req);
    assert.equal(result.results.length,2);assert.equal(result.results[0].poster_url,'https://image.tmdb.org/a.jpg');
    assert.equal(result.results[1].poster_url,null);
});

test('233 lazy background anchors and responsive images supply covers without neighbouring cards',()=>{
    const req=a.request('search',{source:'233dm',q:'测试'});
    const url='https://as.cfhls.top//upload/vod/20260917-1/c0ca80c2e2db160264803b27e2415597.webp';
    const anchor=attrs=>({getAttribute:k=>attrs[k]||null,textContent:'测试',querySelectorAll:()=>[]});
    const links=[anchor({href:'/anime/48e80904f5e839e28d3d5f90.html',title:'测试甲','data-original':url}),
        anchor({href:'/anime/8d59804096f615dd940b83a0.html',title:'测试乙',style:'background-image:url("https://image.tmdb.org/t/p/w500/b.jpg")'}),
        anchor({href:'/anime/124ed0501e933cec14e3b7a8.html',title:'测试丙',srcset:'https://image.tmdb.org/a.jpg 1x, https://image.tmdb.org/b.jpg 2x'})];
    const r=a.readDocument({title:'目录',body:{textContent:''},querySelectorAll:()=>links},req);
    assert.deepEqual(r.results.map(v=>v.poster_url),[url,'https://image.tmdb.org/t/p/w500/b.jpg','https://image.tmdb.org/b.jpg']);
    for(const bad of [url.replace('as.cfhls.top','as.cfhls.top.evil.test'),url+'?url=http://localhost',url.replace('.webp','.mp4')])assert.equal(a.safePosterUrl(bad),null);
});

test('responsive/lazy cover selection prefers useful resolution and retains safe smaller backups',()=>{
    const attrs={src:'https://image.tmdb.org/tiny.jpg',
        'data-srcset':'https://image.tmdb.org/small.jpg 160w, https://image.tmdb.org/huge.jpg 3000w, https://image.tmdb.org/sharp.jpg 640w, https://evil.test/track.jpg 720w'};
    const urls=a.elementPosters({getAttribute:k=>attrs[k]},'https://huarw.com');
    assert.deepEqual(urls,['https://image.tmdb.org/sharp.jpg','https://image.tmdb.org/huge.jpg','https://image.tmdb.org/small.jpg','https://image.tmdb.org/tiny.jpg']);
    const req=a.request('search',{source:'kanju',q:'测试'});
    const normalized=a.normalizeResult(req,{status:'ok',results:[{title:'测试',page_url:'https://www.kanju.ai/player/a',poster_candidates:[...urls,'https://localhost/secret.jpg']}]});
    assert.deepEqual(normalized.results[0].poster_candidates,urls);
    assert.equal(normalized.results[0].poster_url,urls[0]);
});

const posterRow=(title,year,source='huarw',id=1)=>({title,year,source_id:source,source_name:source,
    page_url:source==='huarw'?`https://huarw.com/movie/${id}`:`https://www.kanju.ai/player/test${id}`,
    poster_url:`https://image.tmdb.org/t/p/w500/${source}${id}.jpg`});
test('fallback matches exact title/season and compatible year, never merges playback sources',()=>{
    const pool=createPosterPool();
    for(const row of [posterRow('番剧 第一季','2024'),posterRow('番剧 第二季','2025','huarw',2)])pool.register(row);
    assert.equal(pool.candidates(null,'https://www.kanju.ai/player/a','番剧 第一季','2024').length,1);
    assert.equal(pool.candidates(null,'https://www.kanju.ai/player/a','番剧 第一季','2023').length,0);
    assert.equal(pool.candidates(null,'https://www.kanju.ai/player/a','番剧','2024').length,0);
    assert.equal(pool.candidates(null,'https://www.kanju.ai/player/a','番剧 第一季','').length,1);
    pool.register(posterRow('番剧 第一季','2020','huarw',3));
    assert.equal(pool.candidates(null,'https://www.kanju.ai/player/a','番剧 第一季','').length,0,'unknown-year remakes are ambiguous');
    assert.equal(pool.candidates(null,'https://www.kanju.ai/player/a','番剧 第一季','2024').length,1);
    pool.register({...posterRow('注入','2024'),page_url:'https://evil.test/a'});
    assert.equal(pool.candidates(null,'https://www.kanju.ai/player/a','注入','2024').length,0);
});

test('known-good alternatives rank first and failed URLs are not retried indefinitely',()=>{
    const pool=createPosterPool(),r1=posterRow('测试','2024'),r2=posterRow('测试','2024','huarw',2);
    pool.register(r1);pool.register(r2);pool.mark(r2.poster_url,true);
    assert.equal(pool.candidates(null,'https://www.kanju.ai/player/a','测试','2024')[0].url,r2.poster_url);
    pool.mark(r2.poster_url,false);
    assert.deepEqual(pool.candidates(null,'https://www.kanju.ai/player/a','测试','2024').map(c=>c.url),[r1.poster_url]);
});

function posterDom(){
    const node=tag=>({tag,dataset:{},children:[],handlers:{},append(...items){for(const n of items){n.parentNode=this;this.children.push(n);}},
        addEventListener(k,fn){this.handlers[k]=fn;},remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);}});
    return {doc:{createElement:node},node};
}

test('artwork frames follow loaded portrait, landscape and square proportions; broken upgrades retain shape',()=>{
    for(const [width,height,shape] of [[600,900,'portrait'],[1200,675,'landscape'],[600,600,'square']]) {
        const {doc,node}=posterDom(),cover=node('button'),row=posterRow('测试','2024');
        cover.classList={contains:k=>k==='catalog-film-poster'};
        const styles={};cover.style={setProperty:(k,v)=>styles[k]=v,removeProperty:k=>delete styles[k]};
        const binding=addPoster(doc,cover,row.poster_url,row.page_url,row.title,row);
        const img=cover.children.find(n=>n.tag==='img');Object.assign(img,{naturalWidth:width,naturalHeight:height});img.handlers.load();
        assert.equal(cover.dataset.posterShape,shape);assert.equal(+styles['--poster-ratio'],width/height);
        img.handlers.error();assert.equal(cover.dataset.posterShape,undefined);assert.equal(styles['--poster-ratio'],undefined);
        binding.dispose();
    }
    const {doc,node}=posterDom(),hero=node('div'),row=posterRow('测试','2024');
    const binding=addPoster(doc,hero,row.poster_url,row.page_url,row.title,row);
    const img=hero.children.find(n=>n.tag==='img');Object.assign(img,{naturalWidth:600,naturalHeight:900});img.handlers.load();
    assert.equal(hero.dataset.posterShape,undefined,'hero stays wide');binding.dispose();
});
test('broken card recovers when another source arrives late and labels borrowed artwork',()=>{
    const {doc,node}=posterDom(),cover=node('button'),row=posterRow('测试','2024','kanju');
    const binding=addPoster(doc,cover,row.poster_url,row.page_url,row.title,row);
    const first=cover.children[1];first.handlers.error();assert.equal(first.hidden,true);
    const donor=posterRow('测试','2024');registerPosters(doc,donor);
    const second=cover.children.find(n=>n.tag==='img');assert.equal(second.src,donor.poster_url);
    second.handlers.load();assert.equal(cover.children[0].hidden,true);
    assert.ok(cover.children.some(n=>n.textContent==='参考封面 · huarw'));
    first.handlers.load();assert.equal(first.hidden,true,'stale load cannot replace the fallback');
    assert.equal(row.page_url,'https://www.kanju.ai/player/test1');
    binding.dispose();
});
test('later remake conflict withdraws unknown-year borrowed artwork; detached cards stop',()=>{
    const {doc,node}=posterDom(),cover=node('button');
    const binding=addPoster(doc,cover,null,'https://www.kanju.ai/player/a','同名',{});
    registerPosters(doc,posterRow('同名','2024'));
    const image=cover.children.find(n=>n.tag==='img');image.handlers.load();assert.equal(image.hidden,false);
    registerPosters(doc,posterRow('同名','1998','huarw',2));assert.equal(image.hidden,true);
    cover.isConnected=false;registerPosters(doc,posterRow('同名','2024','huarw',3));
    binding.dispose();
});

test('blank default src and late source attributes recover from a second URL on the same film',()=>{
    const {doc,node}=posterDom(),cover=node('button'),row=posterRow('测试','2024');
    row.poster_candidates=[row.poster_url,'https://image.tmdb.org/backup.jpg'];
    const binding=addPoster(doc,cover,row.poster_url,row.page_url,row.title,row);
    cover.children.find(n=>n.tag==='img').handlers.error();
    const image=cover.children.find(n=>n.tag==='img');assert.equal(image.src,row.poster_candidates[1]);
    image.handlers.load();assert.equal(cover.children[0].hidden,true);
    assert.ok(!cover.children.some(n=>n.textContent?.startsWith('参考封面')),'same-source backup is not cross-source artwork');
    binding.dispose();
});

test('later sharper match replaces blurry art only after success; failed upgrades retain visible original',()=>{
    const {doc,node}=posterDom(),cover=node('button'),row=posterRow('测试','2024');
    const binding=addPoster(doc,cover,row.poster_url,row.page_url,row.title,row);
    const low=cover.children.find(n=>n.tag==='img');Object.assign(low,{naturalWidth:100,naturalHeight:150});low.handlers.load();
    assert.equal(low.dataset.portrait,'true');
    const bad=posterRow('测试','2024','kanju',2);registerPosters(doc,bad);
    const failed=cover.children.find(n=>n.tag==='img'&&n!==low);assert.equal(low.hidden,false);failed.handlers.error();
    assert.equal(low.hidden,false);assert.equal(cover.children[0].hidden,true);
    const good=posterRow('测试','2024','kanju',3);registerPosters(doc,good);
    const high=cover.children.find(n=>n.tag==='img'&&n!==low);Object.assign(high,{naturalWidth:600,naturalHeight:900});high.handlers.load();
    assert.ok(!cover.children.includes(low));assert.equal(high.hidden,false);
    assert.ok(cover.children.some(n=>n.textContent==='参考封面 · kanju'));
    registerPosters(doc,posterRow('测试 第二季','2024','kanju',4));assert.equal(high.hidden,false);
    binding.dispose();
});

test('registration during fragment assembly cannot dispose a not-yet-mounted cover',async()=>{
    const {doc,node}=posterDom(),cover=node('button');cover.isConnected=false;
    const binding=addPoster(doc,cover,null,'https://www.kanju.ai/player/a','测试',{});
    registerPosters(doc,posterRow('测试','2024'));cover.isConnected=true;
    await new Promise(queueMicrotask);
    assert.equal(cover.children.find(n=>n.tag==='img')?.src,posterRow('测试','2024').poster_url);
    binding.dispose();
});

test('invisible formatting marks match, but edition/season differences remain isolated',()=>{
    const pool=createPosterPool();pool.register(posterRow('Re:从零开始的异世界生活 新编辑版',''));
    assert.equal(pool.candidates(null,'https://www.kanju.ai/player/a','Re:从零开始的异世界生活\u200b 新编辑版','').length,1);
    assert.equal(pool.candidates(null,'https://www.kanju.ai/player/a','Re:从零开始的异世界生活 第二季','').length,0);
});

test('same-page alternatives remain valid when another unknown-year title becomes ambiguous',()=>{
    const pool=createPosterPool(),row=posterRow('同名','');
    row.poster_candidates=[row.poster_url,'https://image.tmdb.org/backup.jpg'];pool.register(row);
    pool.register(posterRow('同名','2024','kanju',2));pool.register(posterRow('同名','2001','kanju',3));
    assert.deepEqual(pool.candidates(null,row.page_url,row.title,'').map(c=>c.url),row.poster_candidates);
});

test('updated web fallback tolerates older clients injecting an adapter without new helpers',()=>{
    const vm=require('node:vm'),fs=require('node:fs');
    const legacy={...a};delete legacy.posterCandidates;delete legacy.elementPosters;
    const ctx={TogetherWatchCatalogAdapters:legacy,URL,setTimeout,clearTimeout,queueMicrotask};
    vm.runInNewContext(fs.readFileSync(require.resolve('../static/js/source-discovery.js'),'utf8'),ctx);
    const pool=ctx.TogetherWatchDiscovery.createPosterPool(),row=posterRow('测试','2024');pool.register(row);
    assert.equal(pool.candidates(null,row.page_url,row.title,row.year)[0].url,row.poster_url);
});
