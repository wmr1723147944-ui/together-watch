'use strict';
// Local synthetic pages only. The mock button is not a real captcha.
const {app,BrowserWindow,session}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const {createMetadataBrowser}=require('../src/metadata-browser.cjs');
const {api}=require('../src/catalog-adapters.cjs');
app.setPath('userData',path.join(app.getPath('temp'),'tw-metadata-fixture-'+process.pid));
const until=async(fn)=>{const end=Date.now()+10000;while(Date.now()<end){if(await fn())return;await delay(80);}throw Error('fixture timed out');};
app.whenReady().then(async()=>{
    const parent=new BrowserWindow({show:false,webPreferences:{sandbox:true}});
    const ses=session.fromPartition('metadata-fixture-'+process.pid);
    let counter=0;
    await ses.protocol.handle('https',async request=>{
        const u=new URL(request.url),source=Object.keys(api.sources).find(s=>api.sources[s].host===u.hostname);
        if(!source)return new Response('blocked',{status:403});
        if(u.pathname==='/slow-cover.jpg'){await delay(14000);return new Response('',{headers:{'content-type':'image/jpeg'}});}
        if(u.pathname==='/poster.jpg')return new Response('',{headers:{'content-type':'image/jpeg'}});
        counter++;
        const item=source==='233dm'?'251f681f349a5832bcb61768':source==='kanju'?'test':'12';
        const detail=source==='233dm'?'/anime/'+item+'.html':source==='kanju'?'/player/'+item:source==='huarw'?'/movie/'+item:'/mv/'+item+'.html';
        const isDetail=u.pathname===detail;
        const content=isDetail?(source==='kanju'?'<button data-directory-episode="one">第1集</button>':`<a href="${api.selection(source,item,source==='huarw'?item+'-1':'1-1').page}">第1集</a>`)
            :`<h3><a id="film" href="${detail}" title="测试">测试</a></h3><form hidden><input type="password"></form>${source==='pkavi'?'<img src="/slow-cover.jpg">':''}`;
        const html=`<!doctype html><body><script>
            function show(){document.title='影片目录';document.body.innerHTML=${JSON.stringify(content)};
                ${!isDetail && ['huarw','kanju'].includes(source)?'setTimeout(()=>document.getElementById("film")?.setAttribute("data-original","/poster.jpg"),900);':''}}
            if(sessionStorage.getItem('mock-approved'))show();
            else{document.title='系统安全验证';document.body.innerHTML='<button id="mock-human">Mock verification</button>';document.getElementById('mock-human').onclick=()=>{sessionStorage.setItem('mock-approved','yes');show()}}
        </script></body>`;
        return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});
    });
    const browser=createMetadataBrowser(parent,ses,{hidden:true});
    try {
        for(const source of ['pkavi','233dm','kanju','huarw']) {
            const search={source,q:'测试'};
            const first=await browser.run(source+'-initial','search',search);
            assert.equal(first.status,'verification_required');
            const window=BrowserWindow.getAllWindows().find(w=>w!==parent && w.webContents.getURL().startsWith('https://'+api.sources[source].host));
            const id=window.id,requests=counter;
            const pending=browser.run(source+'-verify','search',search,true);
            await until(()=>browser.active.size===1);
            assert.equal((await browser.run(source+'-busy','search',search)).status,'busy');
            await window.webContents.executeJavaScript("document.getElementById('mock-human').click()",true);
            const success=await pending;
            assert.equal(success.status,'ok');assert.equal(success.results.length,1);
            if(['huarw','kanju'].includes(source))assert.equal(success.results[0].poster_url,'https://'+api.sources[source].host+'/poster.jpg','wait briefly for dynamic poster metadata, not image downloads');
            assert.equal(counter,requests,'interactive retry must not reload the challenge');
            assert.equal(window.isDestroyed(),false);assert.equal(window.isVisible(),false);
            const detail=await browser.run(source+'-detail','detail',{source,page_url:success.results[0].page_url});
            assert.equal(detail.status,'ok');assert.equal(detail.episodes.length,1);
            assert.equal(window.id,id);assert.equal(window.isDestroyed(),false);
            const again=await browser.run(source+'-again','search',search);
            assert.equal(again.status,'ok','search → detail → search preserves tab sessionStorage');
            const secondDetail=await browser.run(source+'-detail-again','detail',{source,page_url:success.results[0].page_url});
            assert.equal(secondDetail.status,'ok','cancelled cover loads must not fail a newer request');
            assert.equal(await window.webContents.executeJavaScript('typeof window.twSourceMetadata'),'undefined');
            assert.equal(await window.webContents.executeJavaScript('typeof require'),'undefined');
            console.log('PASS '+source+': manual challenge, no reload, retained sessionStorage, details, return search, no privileged bridge');
        }
        const pending=browser.run('cancel-case','search',{source:'pkavi',q:'没有匹配'});
        browser.cancel('cancel-case');assert.equal((await pending).status,'cancelled');
        assert.equal(browser.active.size,0);
        browser.destroy();assert.equal(BrowserWindow.getAllWindows().length,1);
        console.log('PASS cancellation and complete window cleanup');
        parent.destroy();app.exit(0);
    }catch(error){console.error(error);browser.destroy();parent.destroy();app.exit(1);}
}).catch(error=>{console.error(error);app.exit(1);});
