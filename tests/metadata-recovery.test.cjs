const {test}=require('node:test');
const assert=require('node:assert/strict');
const {metadataRequest,metadataTimeout}=require('../static/js/source-discovery.js');

test('local connection failure uses one server fallback, without cookies or unrelated paths',async()=>{
    const saved=global.twSourceMetadata,calls=[];
    global.twSourceMetadata={supportedSources:['huarw','pkavi','233dm','kanju'],request:async()=>({source_id:'huarw',status:'unavailable'}),cancel(){}};
    try {
        const abort=new AbortController();
        const reply=await metadataRequest('search',{source:'huarw',q:'元气少女'},async(url,opts)=>{
            calls.push(url);assert.equal(opts.credentials,'omit');assert.equal(opts.signal,abort.signal);
            assert.deepEqual(JSON.parse(opts.body),{source:'huarw',q:'元气少女'});
            return {ok:true,json:async()=>({source_id:'huarw',status:'ok',results:[]})};
        },abort.signal);
        assert.equal((await reply.json()).status,'ok');assert.equal(calls.length,1);
        assert.equal(metadataTimeout('huarw'),42000);assert.equal(metadataTimeout('cupfox'),12000);
        assert.equal(metadataTimeout('huarw',true),185000);
    } finally {global.twSourceMetadata=saved;}
});

test('no fallback or automatic verification for protected, busy, cancelled or interactive queries',async()=>{
    const saved=global.twSourceMetadata;
    try {
        for(const status of ['verification_required','access_blocked','cancelled','busy','ok']) {
            global.twSourceMetadata={supportedSources:['pkavi'],request:async()=>({source_id:'pkavi',status}),cancel(){}};
            const r=await metadataRequest('search',{source:'pkavi',q:'x'},()=>{throw Error('must not request server');},new AbortController().signal);
            assert.equal((await r.json()).status,status);
        }
        for(const [source,interactive] of [['kanju',false],['pkavi',true]]) {
            let calls=0;
            global.twSourceMetadata={supportedSources:[source],request:async()=>({source_id:source,status:'unavailable'}),cancel(){}};
            await metadataRequest('search',{source,q:'x'},()=>{calls++;},new AbortController().signal,interactive);
            assert.equal(calls,0);
        }
    } finally {global.twSourceMetadata=saved;}
});

test('fallback failure preserves native status and cancel never starts an alternate request',async()=>{
    const saved=global.twSourceMetadata;
    try {
        global.twSourceMetadata={supportedSources:['huarw'],request:async()=>({source_id:'huarw',status:'unavailable'}),cancel(){}};
        for(const fetcher of [async()=>{throw Error('network');},async()=>({ok:false,status:429}),
            async()=>({ok:true,json:async()=>({source_id:'pkavi',status:'ok',results:[]})})]) {
            const r=await metadataRequest('search',{source:'huarw',q:'x'},fetcher,new AbortController().signal);
            assert.equal((await r.json()).status,'unavailable');
        }
        const c=new AbortController();let calls=0;
        global.twSourceMetadata.request=async()=>{c.abort();return {status:'unavailable'};};
        await assert.rejects(metadataRequest('search',{source:'huarw',q:'x'},async()=>{calls++;},c.signal));
        assert.equal(calls,0);
    } finally {global.twSourceMetadata=saved;}
});
