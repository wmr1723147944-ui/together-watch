'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync(require('node:path').join(__dirname,'../src/media-bindings.js'),'utf8');
function setup(){
    class Hls {
        static Events={MEDIA_ATTACHED:'hlsMediaAttached'};
        attachMedia(video){this.media=video;return 7;} loadSource(url){this.url=url;}
        trigger(){return this;} detachMedia(){this.media=null;}
    }
    const window={Hls},video={ownerDocument:{baseURI:'https://www.kanju.ai/player/show'}};
    vm.runInNewContext(script,{window,URL,location:{href:'https://www.kanju.ai/player/show',origin:'https://www.kanju.ai'},performance:{getEntriesByType:()=>[]}});
    return {window,Hls,video,read:()=>window.__twMediaBindings.read(video)};
}
test('private Hls instance is recovered only when attached to the exact current video',()=>{
    const {Hls,video,read}=setup(),hls=new Hls();
    hls.loadSource('https://cdn.example/five.m3u8'); assert.equal(read().length,0);
    assert.equal(hls.attachMedia(video),7);assert.equal(hls.trigger(),hls);
    assert.equal(read()[0].url,'https://cdn.example/five.m3u8');
    hls.detachMedia();assert.equal(read().length,0);
});
test('prewarmed next/final episodes, other video and destroyed MSE are not current media',()=>{
    const {Hls,video,read}=setup(),current=new Hls(),prewarm=new Hls(),ad=new Hls();
    current.loadSource('https://cdn.example/five.m3u8');current.attachMedia(video);
    prewarm.loadSource('https://cdn.example/last.m3u8');ad.loadSource('https://cdn.example/ad.m3u8');ad.attachMedia({});
    assert.equal(read().length,1);assert.match(read()[0].url,/five/);
    current.mediaSource={readyState:'closed'};assert.equal(read().length,0);
});
test('switches follow new instance and DRM never produces transferable media',()=>{
    const {Hls,video,read}=setup();
    const a=new Hls();a.loadSource('https://cdn.example/five.m3u8');a.attachMedia(video);a.detachMedia();
    const b=new Hls();b.loadSource('https://cdn.example/six.m3u8');b.attachMedia(video);
    assert.equal(read().length,1);assert.match(read()[0].url,/six/);
    video.mediaKeys={};assert.equal(read().length,0);
});
test('rejects credentials and non-HTTPS manifests even from an attached instance',()=>{
    const {Hls,video,read}=setup(),h=new Hls();h.attachMedia(video);
    for(const url of ['http://cdn.example/a.m3u8','https://user:pass@cdn.example/a.m3u8','blob:foo','file:///x']){
        h.loadSource(url);assert.equal(read().length,0);
    }
});
test('Artplayer integration must own the exact video, not only a similarly named URL',()=>{
    const {window,video,read}=setup();
    window.Artplayer={instances:[{template:{$video:video},hls:{media:video,url:'https://cdn.example/a.m3u8'}}]};
    assert.equal(read().length,1);window.Artplayer.instances[0].isDestroy=true;assert.equal(read().length,0);
});
