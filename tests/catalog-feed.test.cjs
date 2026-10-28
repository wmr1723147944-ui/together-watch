const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createFeed}=require('../static/js/catalog-feed.js');
const {groupResults}=require('../static/js/catalog-browser.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(ids=['ddys','cupfox','yhdmoe']) {
    function node(tag='div') {return {tagName:tag,children:[],handlers:{},attributes:{},dataset:{},hidden:false,textContent:'',
        addEventListener(k,f){this.handlers[k]=f;},append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}},
        replaceChildren(...nodes){this.children=[];this.append(...nodes);},remove(){this.parent.children=this.parent.children.filter(n=>n!==this);},
        setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this[k];},
        getBoundingClientRect(){return {top:5000,bottom:5100};}};}
    const elements=new Map();
    for(const id of ['catalogFeedGrid','catalogFeedSkeleton','catalogFeedEmpty','catalogFeedMore','catalogFeedStatus',
        'catalogFeedNotesBody','catalogFeedNotes','catalogHeroTitle','catalogHeroTagline','catalogHeroFacts','catalogHeroImage',
        'catalogHeroOpen','catalogFeedRefresh','catalogFeedSentinel','discoveryWelcome','discoveryDetail'])elements.set(id,node());
    const configs=ids.map(id=>({dataset:{feedSource:id,sourceName:id,categories:id==='yhdmoe'?'all,animation':'all,movie,series,animation,documentary'}}));
    const win={innerHeight:900,handlers:{},timers:[],addEventListener(k,f){this.handlers[k]=f;},setTimeout(f){this.timers.push(f);}};
    const doc={getElementById:id=>elements.get(id),querySelectorAll:()=>configs,createElement:node,defaultView:win,visibilityState:'visible',addEventListener(){}};
    const hooks={groupResults,addPoster(_doc,cover,poster){cover.append(node('img'));cover.children[0].src=poster;},openGroup(...args){hooks.opened=args;}};
    return {doc,win,elements,hooks,grid:elements.get('catalogFeedGrid')};
}
function row(source,id,title='影片'+id) {
    const page={ddys:'https://ddys.io/movie/film-'+id,cupfox:'https://www.cupfox.in/vod-detail/'+id+'.html',yhdmoe:'https://yhdmoe.com/watch/'+id};
    return {title,year:'2022',page_url:page[source],poster_url:'https://img.ddys.io/movies/test.webp'};
}
function reply(url,results,more=false,extra={}) {
    const q=new URL(url,'http://localhost').searchParams,page=Number(q.get('page'));
    return {ok:true,json:async()=>({source_id:q.get('source'),category:q.get('category'),page,status:'ok',results,has_more:more,next_page:more?page+1:null,...extra})};
}

test('feed mixes real pages with at most two requests and does not cut a page to 12 titles',async()=>{
    const f=fixture(),calls=[];let active=0,peak=0;
    const feed=createFeed(f.doc,async(url,opts)=>{
        calls.push(url);active++;peak=Math.max(peak,active);assert.equal(opts.credentials,'omit');assert.equal(opts.referrerPolicy,'no-referrer');
        await tick();active--;const q=new URL(url,'http://localhost').searchParams,source=q.get('source'),page=+q.get('page');
        return reply(url,Array.from({length:24},(_,i)=>row(source,page*100+i,source+'片'+(page*100+i))),page===1&&source!=='cupfox');
    },f.hooks);
    await feed.setVisible(true);assert.equal(peak,2);assert.equal(f.grid.children.length,72);
    await feed.load(true);assert.equal(f.grid.children.length,120);assert.equal(calls.length,5);
    assert.equal(f.elements.get('catalogFeedMore').hidden,true);
    assert.match(f.elements.get('catalogFeedStatus').textContent,/已浏览完/);
    f.grid.children[0].children[0].handlers.click();assert.equal(f.hooks.opened[2],true);
});

test('spotlight uses at most four real feed entries without extra requests, and resets with its category',async()=>{
    const f=fixture(['cupfox']);
    const preview=f.doc.createElement('div');f.elements.set('catalogSpotlightGrid',preview);
    let calls=0;
    const feed=createFeed(f.doc,async url=>{
        calls++;const category=new URL(url,'http://localhost').searchParams.get('category');
        return reply(url,category==='all'?Array.from({length:8},(_,i)=>row('cupfox',i+1)):[]);
    },f.hooks);
    await feed.setVisible(true);
    assert.equal(calls,1);assert.equal(preview.children.length,4);assert.equal(preview.hidden,false);
    assert.equal(f.elements.get('catalogHeroTitle').textContent,'影片1');
    assert.equal(preview.children[0].children[1].textContent,'影片2');
    preview.children[0].children[0].handlers.click();
    assert.equal(f.hooks.opened[0].title,'影片2');assert.equal(f.hooks.opened[2],true);
    await feed.reset('movie');
    assert.equal(calls,2);assert.equal(preview.children.length,0);assert.equal(preview.hidden,true);
    assert.equal(f.elements.get('catalogHeroOpen').hidden,true);
});

test('equal known title/year merges source choices and receives a later valid cover',async()=>{
    const f=fixture(['ddys','cupfox']);
    const feed=createFeed(f.doc,async url=>{
        const s=new URL(url,'http://localhost').searchParams.get('source');
        if(s==='cupfox')await tick();
        return reply(url,[{...row(s,1,'同一部'),poster_url:s==='ddys'?null:'https://img.ddys.io/movies/test.webp'}]);
    },f.hooks);
    await feed.setVisible(true);assert.equal(f.grid.children.length,1);
    f.grid.children[0].children[0].handlers.click();assert.equal(f.hooks.opened[0].choices.length,2);
    assert.equal(f.hooks.opened[0].poster,'https://img.ddys.io/movies/test.webp');
    assert.equal(f.elements.get('catalogHeroImage').hidden,false);
});

test('failed source stays on its page and manual retry does not refetch successful finished sources',async()=>{
    const f=fixture(['ddys','cupfox']),calls=[];let fail=true;
    const feed=createFeed(f.doc,async url=>{
        const s=new URL(url,'http://localhost').searchParams.get('source');calls.push(s);
        return reply(url,[row(s,1,s)],false,{status:s==='ddys'&&fail?'unavailable':'ok'});
    },f.hooks);
    await feed.setVisible(true);assert.equal(f.grid.children.length,1);
    assert.equal(f.elements.get('catalogFeedNotes').hidden,false);
    fail=false;await feed.load(true);assert.equal(f.grid.children.length,2);
    assert.deepEqual(calls,['ddys','cupfox','ddys']);assert.equal(f.elements.get('catalogFeedNotes').hidden,true);
});

test('repeated/invalid entries do not duplicate the grid or cause an endless automatic request loop',async()=>{
    const f=fixture(['ddys']);let count=0;
    const feed=createFeed(f.doc,async url=>{count++;return reply(url,[row('ddys',1),row('ddys',1),row('ddys',2,'')],true);},f.hooks);
    await feed.setVisible(true);await feed.load(true);assert.equal(f.grid.children.length,1);
    await feed.load();assert.equal(count,3);assert.equal(f.elements.get('catalogFeedNotes').hidden,false);
    await feed.load();assert.equal(count,3);
    await feed.load(true);assert.equal(count,4);
});

test('all category tabs can skip an overlapping batch and keep loading distinct films',async()=>{
    for(const category of ['movie','series','animation','documentary']) {
        const f=fixture(['cupfox']),calls=[];
        const feed=createFeed(f.doc,async url=>{
            const q=new URL(url,'http://localhost').searchParams,page=+q.get('page');
            calls.push([q.get('category'),page]);
            // The current-year list overlaps the latest list; the next year does not.
            return reply(url,[row('cupfox',page===3?2:1,category+(page===3?'乙':'甲'))],page<3);
        },f.hooks);
        await feed.setVisible(true);calls.length=0;
        await feed.reset(category);
        f.elements.get('catalogFeedSentinel').getBoundingClientRect=()=>({top:950,bottom:1000});
        feed.maybeLoad();await tick();
        assert.equal(f.grid.children.length,1);
        assert.equal(f.elements.get('catalogFeedMore').hidden,false);
        feed.maybeLoad();await tick();
        assert.equal(f.grid.children.length,2,category);
        assert.deepEqual(calls,[[category,1],[category,2],[category,3]]);
        assert.equal(f.elements.get('catalogFeedMore').hidden,true);
        feed.maybeLoad();await tick();assert.equal(calls.length,3);
    }
});

test('category changes abort old requests and late replies cannot replace the new category',async()=>{
    const f=fixture(['ddys']),pending=[];
    const feed=createFeed(f.doc,(url,options)=>new Promise(resolve=>pending.push({url,options,resolve})),f.hooks);
    const first=feed.setVisible(true);const second=feed.reset('movie');assert.equal(pending[0].options.signal.aborted,true);
    pending[1].resolve(reply(pending[1].url,[row('ddys',2,'新分类')]));await second;
    pending[0].resolve(reply(pending[0].url,[row('ddys',1,'旧分类')]));await first;
    assert.equal(f.grid.children.length,1);assert.equal(f.grid.children[0].children[1].textContent,'新分类');
});

test('search/return keeps already loaded cards; scrolling loads only near the bottom and outside a dialog',async()=>{
    const f=fixture(['ddys']);let calls=0;
    const feed=createFeed(f.doc,async url=>reply(url,[row('ddys',++calls)],true),f.hooks);
    await feed.setVisible(true);feed.setVisible(false);feed.maybeLoad();assert.equal(calls,1);
    feed.setVisible(true);feed.maybeLoad();assert.equal(calls,1);assert.equal(f.grid.children.length,1);
    f.elements.get('catalogFeedSentinel').getBoundingClientRect=()=>({top:950,bottom:1000});
    f.elements.get('discoveryDetail').open=true;feed.maybeLoad();assert.equal(calls,1);
    f.elements.get('discoveryDetail').open=false;feed.maybeLoad();feed.maybeLoad();await tick();
    assert.equal(calls,2);assert.equal(f.grid.children.length,2);
});

test('malformed pagination is a retryable failure, never an arbitrary next URL',async()=>{
    const f=fixture(['ddys']);let calls=0;
    const feed=createFeed(f.doc,async url=>{calls++;return reply(url,[row('ddys',1)],true,{next_page:'https://evil.test'});},f.hooks);
    await feed.setVisible(true);await feed.load();assert.equal(calls,1);assert.equal(f.grid.children.length,0);
    assert.equal(f.elements.get('catalogFeedNotes').hidden,false);
});

test('long browsing pauses at the memory limit and offers explicit bounded continuation',async()=>{
    const f=fixture(['ddys']);let calls=0;
    const feed=createFeed(f.doc,async url=>{const start=++calls*100;return reply(url,Array.from({length:60},(_,i)=>row('ddys',start+i)),true);},f.hooks);
    await feed.setVisible(true);for(let i=0;i<7;i++)await feed.load();
    assert.equal(f.grid.children.length,480);await feed.load();assert.equal(calls,8);
    assert.match(f.elements.get('catalogFeedMore').textContent,/保留最近/);
    await feed.load(true);assert.equal(calls,9);assert.equal(f.grid.children.length,300);
});

test('no enabled feed source renders an honest empty state without requesting network',async()=>{
    const f=fixture([]);const feed=createFeed(f.doc,()=>assert.fail('unexpected fetch'),f.hooks);
    await feed.setVisible(true);assert.equal(f.elements.get('catalogFeedMore').hidden,true);
    assert.match(f.elements.get('catalogFeedStatus').textContent,/没有启用/);
});
