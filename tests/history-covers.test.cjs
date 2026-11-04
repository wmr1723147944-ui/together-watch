const {test}=require('node:test'), assert=require('node:assert/strict');
const H=require('../static/js/watch-history.js');
const A=require('../static/js/catalog-adapters.js');
const D=require('../static/js/source-discovery.js');
const poster='https://image.tmdb.org/t/p/w500/history.jpg', backup='https://image.tmdb.org/t/p/w780/backup.jpg';
const p={source:'kanju',item:'av-test',episode:'ep-one'};
test('group by source and work ID, not display name; keep the newest episode and borrow only artwork/title',()=>{
    const first={...p,title:'同名',poster,label:'第1集',time:100,duration:200,updated:1};
    const latest={...first,episode:'ep-two',title:'kanju · 观看记录',label:'第2集',time:20,duration:190,updated:9,poster:''};
    const rows=[first,{...first,item:'other-id',updated:4},{...first,source:'cupfox',updated:6},latest];
    const before=JSON.stringify(rows),titles=H.listTitles(rows);
    assert.deepEqual(titles.map(H.identity),[H.identity(latest),H.identity(rows[2]),H.identity(rows[1])]);
    assert.deepEqual([titles[0].title,titles[0].poster,titles[0].label,titles[0].time,titles[0].duration],['同名',poster,'第2集',20,190]);
    assert.equal(JSON.stringify(rows),before);
});
function store(){const data=new Map();return H.createStore({getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)});}

test('absolute history cover accepts absent or empty base without weakening URL policy',()=>{
    for(const base of ['',undefined])assert.equal(A.safePosterUrl(poster,base),poster);
    for(const url of ['/relative.jpg','//image.tmdb.org/x.jpg','javascript:alert(1)','https://evil.test/x.jpg',poster+'?token=private',poster+'#secret'])assert.equal(A.safePosterUrl(url,''),null);
});
test('history retains fallback covers and reopening without metadata cannot erase them',()=>{
    const s=store();s.remember(p,{title:'测试影片',label:'第1集',poster,poster_candidates:[poster,backup],year:2025});
    s.record(p,{ready:true,time:50});s.remember(p,{});s.record(p,{ready:true,time:55});
    const row=s.list()[0];assert.equal(row.poster,poster);assert.equal(row.title,'测试影片');assert.equal(row.year,'2025');
    assert.deepEqual(row.poster_candidates,[poster,backup]);
    s.remember(p,{poster:backup});s.record(p,{ready:true,time:60});assert.equal(s.list()[0].poster,backup);
});
test('history artwork metadata is bounded and never stores media credentials or arbitrary hosts',()=>{
    const s=store();s.remember(p,{poster:'https://evil.test/x.jpg',poster_candidates:[poster+'?token=secret','https://image.tmdb.org/v.mp4',...Array.from({length:80},(_,i)=>poster.replace('.jpg',i+'.jpg'))],year:'secret'});
    s.record(p,{ready:true,time:50});const row=s.list()[0];assert.equal(row.poster_candidates.length,6);assert.equal(row.year,'');
    assert.ok(!JSON.stringify(row).includes('secret'));assert.ok(!JSON.stringify(row).includes('evil.test'));
});
test('history fallback candidates enter the same verified-page poster pool as search results',()=>{
    const row={...p,title:'同名影片 第二季',poster,poster_candidates:[poster,backup],year:'2025'};
    const meta=H.posterMetadata(row),pool=D.createPosterPool();
    assert.equal(D.safeResultUrl(meta.source_id,meta.page_url),'https://www.kanju.ai/player/av-test');
    pool.register(meta);pool.mark(poster,false);
    assert.equal(pool.candidates(poster,meta.page_url,row.title,row.year)[0].url,backup);
    assert.deepEqual(pool.candidates('',meta.page_url,'同名影片 第一季',row.year),[]);
    assert.deepEqual(H.posterMetadata({...row,item:'../private'}),{});
});
