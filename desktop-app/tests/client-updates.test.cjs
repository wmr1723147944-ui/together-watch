const {test}=require('node:test'),assert=require('node:assert/strict');
const {compare,parse,check,mayNotify}=require('../src/client-updates.cjs');
const release={platform:'windows',version:'0.6.25',filename:'TogetherWatch-Windows-0.6.25-x64.zip',download_path:'/downloads/files/TogetherWatch-Windows-0.6.25-x64.zip',size:123,sha256:'a'.repeat(64),notes:['新功能']};
const data=r=>({schema:1,available:true,release:r});
test('numeric versions prevent downgrade and invalid or remote paths are rejected',()=>{
    assert.equal(compare('0.6.10','0.6.9'),1);assert.equal(compare('0.6.24','0.6.24'),0);
    assert.equal(parse(data(release),'0.6.24').state,'available');assert.equal(parse(data(release),'0.6.26').state,'current');
    for(const patch of [{version:'0.6.25-evil'},{download_path:'https://evil.invalid/file.zip'},{filename:'../../app.js'},
        {size:NaN},{notes:['a'.repeat(241)]},{sha256:'bad'},{platform:'android'}])assert.throws(()=>parse(data({...release,...patch}),'0.6.24'));
    assert.equal(parse({schema:1,available:false},'0.6.24').state,'unpublished');
});
test('watching and snoozing suppress automatic prompts, manual checks stay available',()=>{
    const result={state:'available',version:'0.6.25'};
    assert.equal(mayNotify(result,{watching:true}),false);
    assert.equal(mayNotify(result,{snoozeVersion:'0.6.25',snoozeUntil:200,now:100}),false);
    assert.equal(mayNotify(result,{snoozeVersion:'0.6.24',snoozeUntil:200,now:100}),true);
    assert.equal(mayNotify(result,{manual:true,watching:true}),true);
    assert.equal(mayNotify({state:'offline'}),false);
});
test('update fetch omits cookies, disallows redirects and bounds malformed/oversized responses',async()=>{
    const result=await check(async(url,opts)=>{
        assert.equal(url,'https://watchtogethernow.cloud/api/client-updates/windows');
        assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'error');assert.ok(opts.signal);
        return new Response(JSON.stringify(data(release)));
    },'https://watchtogethernow.cloud','0.6.24');
    assert.equal(result.state,'available');
    for(const reply of [new Response('not JSON'),new Response('x'.repeat(33000)),new Response('',{status:404})])await assert.rejects(check(async()=>reply,'https://watchtogethernow.cloud','0.6.24'));
});
