const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const next = vm.runInNewContext(fs.readFileSync(path.join(__dirname,
    '../android-app/app/src/main/assets/next-episode.js'), 'utf8'), {URL});
const origin = 'https://watchtogethernow.cloud';
const program = {source:'kanju', item:'drama:hd', episode:'ep-xyz'};
const link = (episode, label, p=program) => ({
    href:origin+'/discover/play/'+p.source+'/'+encodeURIComponent(p.item)+'/'+episode,
    textContent:label
});
function catalogue(rows, opts={}) {
    const more={hidden:!opts.more,click(){ rows.push(...opts.more); this.hidden=true; }};
    const list={querySelectorAll:()=>rows, querySelector:()=>opts.retry || null};
    const controls={discoveryEpisodes:list,discoveryEpisodeFilter:{value:opts.filter || ''},discoveryEpisodeMore:more};
    return {location:new URL(origin+'/discover'),getElementById:id=>controls[id]};
}
test('看剧 AI：按集数而非倒序列表位置或不透明 ID 选择',()=>{
    const correct=link('ep-abc','原站选集 · 第13集');
    const doc=catalogue([correct,link('ep-xyz','原站选集 · 第12集 · 正在看'),link('ep-zzz','原站选集 · 第11集')]);
    assert.equal(next(doc,origin,program,false),correct.href);
});
test('相同片名不同条目、外部地址或损坏的链接均不能冒充下一集',()=>{
    const current=link('ep-xyz','12'), good=link('ep-abc','13');
    const doc=catalogue([current,link('ep-wrong','13',{...program,item:'other'}),
        {...good,href:'https://example.org'+new URL(good.href).pathname}, {...good,href:good.href+'?token=private'},
        {...good,href:good.href+'/%'}, {...good,href:good.href.replace('ep-abc','%FF')},good]);
    assert.equal(next(doc,origin,program,false),good.href);
});
test('当前线路结束时，不能切到另一线路或回到第一集',()=>{
    const p={source:'pkavi',item:'99',episode:'1-2'};
    const doc=catalogue([link('1-1','正片',p),link('1-2','正片',p),link('2-3','正片',p)]);
    assert.equal(next(doc,origin,p,false),'end');
});
test('存在缺集、集数重复或筛选条件时，不猜测下一集',()=>{
    const a=link('ep-xyz','第2集'), b=link('ep-foo','第3集');
    assert.equal(next(catalogue([a,link('ep-gap','第5集')]),origin,program,false),'ambiguous');
    assert.equal(next(catalogue([a,b,link('ep-alt','第3集')]),origin,program,false),'ambiguous');
    assert.equal(next(catalogue([a,b],{filter:'3'}),origin,program,false),'missing');
    assert.equal(next(catalogue([b]),origin,program,false),'missing');
});
test('分页处可展开更多集；不会改动原搜索页的分页',()=>{
    const a=link('ep-xyz','100'), b=link('ep-abc','101');
    const doc=catalogue([a],{more:[b]});
    assert.equal(next(doc,origin,program,false),'missing');
    assert.equal(next(doc,origin,program,true),'more');
    assert.equal(next(doc,origin,program,true),b.href);
});
test('未取得目录时区分正在加载与需要手动重试',()=>{
    assert.equal(next(catalogue([]),origin,program,true),'waiting');
    assert.equal(next(catalogue([],{retry:true}),origin,program,true),'missing');
});
