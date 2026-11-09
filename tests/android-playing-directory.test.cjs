const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const adapters=require('../static/js/catalog-adapters.js');
const script=fs.readFileSync('android-app/app/src/main/assets/playing-directory.js','utf8');
function read(source,item,episode,options={}) {
    const selected=adapters.selection(source,item,episode),url=options.url||selected.page;
    const page=source==='kanju'?`https://www.kanju.ai/player/${item}`:source==='pkavi'?`https://www.pkavi.com/mv/${item}.html`:`https://www.233dm.com/anime/${item}.html`;
    const req=adapters.request('detail',{source,page_url:page});
    const link={getAttribute:()=>selected.page,textContent:'第2集'};
    const button={getAttribute:name=>name==='data-directory-episode'?episode.slice(3):'第2集',textContent:'2'};
    const doc={body:{textContent:''},title:'影片',querySelector:()=>null,
        querySelectorAll:s=>options.empty?[]:s==='a[href]'?[link]:s==='button[data-directory-episode]'?[button]:[]};
    const context={window:{TogetherWatchCatalogAdapters:adapters},document:doc,location:{href:url}};
    return vm.runInNewContext(script,context)(req,options.expected||url);
}
test('reuse public episode metadata from the playing film across dynamic providers',()=>{
    for(const [source,item,episode] of [['kanju','drama','ep-two'],['pkavi','12','1-2'],['233dm','0123456789abcdef01234567','1-2']]) {
        const data=read(source,item,episode);assert.equal(data.status,'ok');assert.equal(data.item_id,item);
        assert.equal(data.episodes[0].id,episode);assert.ok(!JSON.stringify(data).includes('cookie'));
    }
});
test('another film, another host, navigation races and empty lists fall back instead of guessing',()=>{
    assert.equal(read('kanju','drama','ep-two',{url:'https://www.kanju.ai/player/other?episode=two'}),null);
    assert.equal(read('kanju','drama','ep-two',{url:'https://evil.example/player/drama?episode=two'}),null);
    assert.equal(read('kanju','drama','ep-two',{expected:'https://www.kanju.ai/player/drama?episode=one'}),null);
    assert.equal(read('kanju','drama','ep-two',{empty:true}),null);
});
