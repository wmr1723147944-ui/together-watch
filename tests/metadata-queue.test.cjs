const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createMetadataQueue}=require('../static/js/source-discovery.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('foreground detail yields only its conflicting search and resumes it without exceeding two readers',async()=>{
    const schedule=createMetadataQueue(),jobs=[];let active=0,peak=0;
    const read=label=>signal=>new Promise(resolve=>{
        active++;peak=Math.max(peak,active);
        const job={label,signal,resolve:value=>{if(job.done)return;job.done=true;active--;resolve(value);}};
        jobs.push(job);signal.addEventListener('abort',()=>job.resolve('aborted'),{once:true});
    });
    const controller=new AbortController();
    const a=schedule('a',1,controller.signal,read('search-a'));
    const b=schedule('b',1,controller.signal,read('search-b'));
    const c=schedule('c',1,controller.signal,read('search-c'));
    const d=schedule('a',2,controller.signal,read('detail-a'));
    await flush();assert.deepEqual(jobs.map(j=>j.label),['search-a','search-b','detail-a']);
    assert.equal(jobs[0].signal.aborted,true);assert.equal(jobs[1].signal.aborted,false);
    jobs[2].resolve('episodes');assert.equal(await d,'episodes');
    await flush();assert.equal(jobs[3].label,'search-c');jobs[3].resolve('c');
    await flush();assert.equal(jobs[4].label,'search-a');jobs[4].resolve('a');jobs[1].resolve('b');
    assert.deepEqual(await Promise.all([a,b,c]),['a','b','c']);assert.equal(peak,2);assert.equal(active,0);
});

test('cancelling a queued same-provider read never starts it and aborting an active read frees its slot',async()=>{
    const schedule=createMetadataQueue(),first=new AbortController(),second=new AbortController();let calls=0;
    const a=schedule('a',1,first.signal,signal=>new Promise(resolve=>{
        calls++;signal.addEventListener('abort',()=>resolve('aborted'),{once:true});
    }));
    const b=schedule('a',1,second.signal,()=>{calls++;return 'should-not-run';});
    const settled=Promise.allSettled([a,b]);second.abort();first.abort();
    assert.ok((await settled).every(r=>r.status==='rejected'));await flush();assert.equal(calls,1);
    assert.equal(await schedule('a',2,new AbortController().signal,()=>++calls),2);
});
