'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {liveContents,requestBelongsToView}=require('../src/view-lifecycle.cjs');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('late requests ignore destroyed, detached and missing source views',()=>{
    for(const view of [null,undefined,{}, {webContents:undefined}, {get webContents(){throw Error('Object has been destroyed');}},
        {webContents:{isDestroyed:()=>true,get id(){throw Error('id is no longer valid');}}}]) {
        assert.equal(liveContents(view),null);
        for(const details of [null,{}, {webContentsId:undefined}, {webContentsId:17}])assert.equal(requestBelongsToView(details,view),false);
    }
});
test('requests must belong to the current live source, not a previous view or metadata reader',()=>{
    const wc={id:17,isDestroyed:()=>false},view={webContents:wc};
    assert.equal(liveContents(view),wc);
    assert.equal(requestBelongsToView({webContentsId:17},view),true);
    for(const id of [undefined,16,'17',NaN])assert.equal(requestBelongsToView({webContentsId:id},view),false);
    view.webContents=undefined;
    assert.equal(requestBelongsToView({webContentsId:17},view),false);
});

test('production network callbacks complete safely after source teardown and reject stale responses',()=>{
    const code=fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8');
    const callbacks={},requests=new Map(),added=[];
    const context={requestBelongsToView,requests,videoGeneration:4,sourcePage:'https://example.com/watch',video:{webContents:{id:17,isDestroyed:()=>false}},
        catalog:{add:(...args)=>{added.push(args);return true;}},reportMedia(){},videoPartition:{webRequest:Object.fromEntries(
            ['onBeforeRequest','onResponseStarted','onCompleted','onErrorOccurred'].map(name=>[name,fn=>callbacks[name]=fn]))}};
    vm.runInNewContext(code.slice(code.indexOf('videoPartition.webRequest.onBeforeRequest'),code.indexOf('    function scanMedia()')),context);
    let completed=0;
    callbacks.onBeforeRequest({id:1,webContentsId:17},()=>completed++);
    context.video.webContents=undefined; // Native view survives its destroyed contents.
    assert.doesNotThrow(()=>callbacks.onBeforeRequest({id:2,webContentsId:17},()=>completed++));
    assert.doesNotThrow(()=>callbacks.onResponseStarted({id:1,webContentsId:17,statusCode:200}));
    context.video=null;
    callbacks.onBeforeRequest({id:3},()=>completed++);
    context.video={webContents:{id:18,isDestroyed:()=>false}};context.videoGeneration=5;
    callbacks.onResponseStarted({id:1,webContentsId:17,statusCode:200});
    assert.equal(completed,3);assert.equal(requests.has(2),false);assert.equal(requests.has(3),false);assert.equal(added.length,0);
    callbacks.onBeforeRequest({id:4,webContentsId:18},()=>completed++);
    callbacks.onResponseStarted({id:4,webContentsId:18,statusCode:206,url:'https://example.com/movie.mp4',responseHeaders:{'content-type':['video/mp4']}});
    assert.equal(added.length,1);callbacks.onCompleted({id:4});callbacks.onErrorOccurred({id:1});assert.equal(requests.size,0);
});
