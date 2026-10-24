const {test}=require('node:test');
const assert=require('node:assert/strict');
const a=require('../static/js/catalog-adapters.js');
const {addPoster}=require('../static/js/source-discovery.js');
const observed=require('./poster-source-fixture.json');

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
