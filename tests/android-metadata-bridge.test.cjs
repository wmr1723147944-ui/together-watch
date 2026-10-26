const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const adapters=require('../static/js/catalog-adapters.js');
const source=fs.readFileSync('android-app/app/src/main/assets/catalog-metadata-bridge.js','utf8');
function setup(sources=['pkavi','233dm','kanju']) {
    const ctx={TogetherWatchCatalogAdapters:adapters,crypto:{randomUUID:()=>require('node:crypto').randomUUID()},setTimeout,clearTimeout,
        document:{querySelectorAll:()=>sources.map(source=>({dataset:{liveSource:source}}))}};
    ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);return ctx;
}
test('Android metadata capability is bounded and returns only normalized public fields',async()=>{
    const c=setup(),api=c.twSourceMetadata,q=c.__twMetadataQueue;
    const promise=api.request('one','search',{source:'pkavi',q:'测试'});
    const batch=q.drain();assert.equal(batch.requests.length,1);assert.equal(q.drain().requests.length,0);
    q.complete('old-document','one',{status:'ok',results:[]});
    q.complete(q.token,'one',{status:'ok',cookie:'secret',results:[{title:'测试',page_url:'https://www.pkavi.com/mv/12.html',cookie:'secret'}]});
    const result=await promise;assert.equal(result.results.length,1);assert.ok(!JSON.stringify(result).includes('secret'));
    assert.equal((await api.request('bad','search',{source:'pkavi',q:'x',cookie:'secret'})).status,'unavailable');
    assert.equal((await api.request('foreign','detail',{source:'pkavi',page_url:'https://127.0.0.1'})).status,'unavailable');
    assert.equal((await setup([]).twSourceMetadata.request('disabled','search',{source:'pkavi',q:'x'})).status,'unavailable');
});
test('Android cancellation, busy limit and document tokens do not mix results',async()=>{
    const c=setup(),api=c.twSourceMetadata,q=c.__twMetadataQueue;
    const one=api.request('one','search',{source:'pkavi',q:'测试'}),two=api.request('two','search',{source:'kanju',q:'测试'},true);
    assert.equal((await api.request('three','search',{source:'233dm',q:'测试'})).status,'busy');
    q.drain();api.cancel('one');assert.equal((await one).status,'cancelled');assert.deepEqual(Array.from(q.drain().cancelled),['one']);
    const other=setup();assert.notEqual(q.token,other.__twMetadataQueue.token);
    q.complete(other.__twMetadataQueue.token,'two',{status:'ok',results:[]});
    api.cancel('two');assert.equal((await two).status,'cancelled');
    assert.equal(Object.isFrozen(api),true);assert.equal(Object.isFrozen(q),true);
});
