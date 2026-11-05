'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../src/media-scan.js'),'utf8');
function scan(options={}){
    const video={currentSrc:'blob:https://www.kanju.ai/video',src:'',duration:3000,currentTime:31,readyState:4,paused:true,
        getBoundingClientRect:()=>({width:800,height:450}),addEventListener(){},querySelectorAll:()=>[],...options.video};
    const hls={media:options.other?{}:video,url:'https://cdn.example.com/movie.m3u8'};
    const context={window:options.hls?{hls}:{},document:{querySelectorAll:q=>q==='video'?[video]:[]},performance:{getEntriesByType:()=>[]}};
    return vm.runInNewContext(code,context);
}
test('only an HLS instance attached to this video can identify its manifest',()=>{
    const data=scan({hls:true});assert.equal(data.candidates[0].hls,true);assert.equal(data.candidates[0].url,'https://cdn.example.com/movie.m3u8');
    const other=scan({hls:true,other:true});assert.equal(other.candidates[0].hls,false);assert.equal(other.candidates[0].blobReady,true);
});
test('decoded opaque current media, undecoded placeholders and DRM remain distinct',()=>{
    const data=scan({video:{currentSrc:'https://cdn.example.com/movie.image'}});assert.equal(data.candidates[0].current,true);assert.equal(data.candidates[0].main,true);
    assert.equal(scan({video:{readyState:0}}).candidates[0].blobReady,false);
    assert.equal(scan({video:{mediaKeys:{}}}).protected,true);
});
