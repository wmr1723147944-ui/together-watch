'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {MediaTransport,rewritePlaylist,anonymousHeaders,publicIPv4,publicMediaUrl}=require('../src/media-transport.cjs');
const fixture=(text,headers={})=>({status:200,headers:{'content-type':'application/vnd.apple.mpegurl',...headers},body:new Response(text).body,url:'https://cdn.example/movie/index.m3u8'});
test('playlist maps master, keys, init segments and media without exposing remote signed URLs',()=>{
    const registered=[];
    const out=rewritePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin?sign=secret"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n720/index.m3u8\npart.ts','https://cdn.example/movie/index.m3u8',url=>{registered.push(url);return 'tw-app://desktop/media/id/'+registered.length;});
    assert.doesNotMatch(out,/secret|https:/);assert.equal(registered.length,4);
    assert.equal(registered[3],'https://cdn.example/movie/part.ts');
    for(const line of ['http://cdn.example/a.ts','https://127.0.0.1/a.ts','file:///etc/passwd','https://user:pass@cdn.example/a.ts'])
        assert.throws(()=>rewritePlaylist('#EXTM3U\n'+line,'https://cdn.example/a.m3u8',()=>''));
    assert.throws(()=>rewritePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"','https://cdn.example/a.m3u8',()=>''));
});
test('only minted current-session resources are fetchable, anonymous and range-aware',async()=>{
    const calls=[],transport=new MediaTransport(async(url,headers)=>{calls.push({url,headers});return fixture('#EXTM3U\nseg.ts');});
    const url=transport.start({url:'https://cdn.example/movie/index.m3u8',kind:'hls'},{Cookie:'secret',Authorization:'secret','User-Agent':'UA'});
    const response=await transport.handle(new Request(url));assert.equal(response.status,200);
    const segment=(await response.text()).split('\n')[1];assert.match(segment,/^tw-app:\/\/desktop\/media\//);
    assert.deepEqual(calls[0].headers,{'User-Agent':'UA'});
    await transport.handle(new Request(segment,{headers:{Range:'bytes=0-99'}}));assert.equal(calls[1].headers.Range,'bytes=0-99');
    const count=calls.length;transport.reset();assert.equal((await transport.handle(new Request(url))).status,404);assert.equal(calls.length,count);
    assert.equal((await transport.handle(new Request(url,{method:'POST'}))).status,404);
});
test('context stays on observed media origin and no-referrer is not replaced with a guess',()=>{
    assert.deepEqual(anonymousHeaders({Cookie:'x',Authorization:'x',Origin:'null',Referer:'http://foo.bar/'}),{});
    assert.deepEqual(anonymousHeaders({Referer:'https://www.kanju.ai/player/a?token=x#p'}),{Referer:'https://www.kanju.ai/player/a'});
    assert.deepEqual(anonymousHeaders({'User-Agent':'UA\nCookie: x'}),{});
});

test('playlist-only TLS ports work without broadening page navigation or accepting private/cleartext URLs',()=>{
    const {publicHttps}=require('../src/policy.cjs'),url='https://cdn.example:65/segment.ts';
    assert.equal(publicMediaUrl(url),url);assert.equal(publicHttps(url),'');
    for(const bad of ['http://cdn.example:65/a','https://127.0.0.1:65/a','https://localhost:65/a','https://x.local:65/a','https://u:p@cdn.example:65/a','https://cdn.example:0/a'])assert.equal(publicMediaUrl(bad),'');
    const rows=[];
    rewritePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nhttps://cdn.example:65/playlist?id=1\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio?id=2"','https://cdn.example/master',(url,playlist)=>{rows.push({url,playlist});return 'local';});
    assert.equal(rows[0].playlist,true);assert.equal(rows[1].playlist,true);
});
test('DNS lookup denies private, loopback, metadata, CGNAT, multicast and reserved addresses',()=>{
    for(const address of ['127.0.0.1','169.254.169.254','10.1.1.1','172.16.0.1','192.168.0.1','100.64.0.1','0.0.0.0','224.0.0.1','198.18.0.1','::1','::ffff:127.0.0.1','999.1.1.1'])assert.equal(publicIPv4(address),false,address);
    assert.equal(publicIPv4('1.1.1.1'),true);assert.equal(publicIPv4('8.8.8.8'),true);
});
test('revision reset aborts pending requests and rejects late playlist capabilities',async()=>{
    let finish,signal;
    const transport=new MediaTransport(async(_url,_headers,s)=>{signal=s;return new Promise(r=>finish=r);});
    const url=transport.start({url:'https://cdn.example/movie/index.m3u8',kind:'hls'});
    const pending=transport.handle(new Request(url));transport.reset();assert.equal(signal.aborted,true);
    finish(fixture('#EXTM3U\nseg.ts'));assert.equal((await pending).status,410);
});
test('binary bodies stream with range headers; error pages and oversized playlists do not play',async()=>{
    const transport=new MediaTransport(async()=>({status:206,headers:{'content-type':'video/mp4','content-range':'bytes 0-2/3','content-length':'3'},body:new Response(new Uint8Array([1,2,3])).body,url:'https://cdn.example/a.mp4'}));
    const url=transport.start({url:'https://cdn.example/a.mp4',kind:'mp4'}),r=await transport.handle(new Request(url));
    assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 0-2/3');assert.equal(r.headers.get('content-length'),'3');assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[1,2,3]);
    const large=new MediaTransport(async()=>fixture('#EXTM3U\n'+'x'.repeat(2097152)));
    assert.equal((await large.handle(new Request(large.start({url:'https://cdn.example/a.m3u8',kind:'hls'})))).status,502);
});
