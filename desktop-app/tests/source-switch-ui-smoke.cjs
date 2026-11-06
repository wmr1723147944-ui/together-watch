'use strict';
// Actual shared DOM and packaged Android bridge; native polling is simulated.
const {BrowserWindow}=require('electron');
const {setTimeout:delay}=require('node:timers/promises');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
exports.run=async({server,output,until})=>{
    const win=new BrowserWindow({show:false,width:390,height:844,useContentSize:true,webPreferences:{offscreen:true,
        backgroundThrottling:false,contextIsolation:true,sandbox:true,nodeIntegration:false,partition:'switch-ui-'+Date.now()}});
    const wc=win.webContents,js=script=>wc.executeJavaScript(script);
    try {
        wc.session.webRequest.onBeforeRequest((request,done)=>done({cancel:!request.url.startsWith(server+'/')}));
        await win.loadURL(server+'/discover?picker=1');
        await js(fs.readFileSync(path.resolve(__dirname,'../../android-app/app/src/main/assets/catalog-metadata-bridge.js'),'utf8'));
        await js(`for(const c of document.querySelectorAll('[data-live-source]'))c.checked=['kanju','pkavi'].includes(c.dataset.liveSource);
            TogetherWatchCatalogNavigation.episodes({source:'kanju',item:'av_demo',episode:'ep-e2'});
            window.first=__twMetadataQueue.drain();
            __twMetadataQueue.complete(first.token,first.requests[0].id,{status:'ok',title:'测试影片 第二季',episodes:[{id:'ep-e1',title:'第1集'},{id:'ep-e2',title:'第2集'}]});`);
        await until('Android picker current episode',()=>js(`!!document.querySelector('#discoveryEpisodes [aria-current]')`));
        await js(`document.querySelector('.catalog-source-search').open=true;
            window.search=__twMetadataQueue.drain();window.peer=search.requests.find(r=>r.payload.source==='pkavi');
            __twMetadataQueue.update(search.token,peer.id,{status:'ok',results:[{title:'测试影片 第二季',page_url:'https://www.pkavi.com/mv/12.html'},
                {title:'测试影片 第一季',page_url:'https://www.pkavi.com/mv/13.html'}]});`);
        await until('partial alternative available before all finish',()=>js(`document.querySelectorAll('#catalogSourceChoices button').length===2`));
        assert.equal(await js('TogetherWatchCatalogNavigation.pickerClosed()'),false);
        assert.ok(await js(`document.getElementById('catalogFindOtherSources').disabled`));
        await js(`document.querySelector('#catalogSourceChoices [data-source=pkavi]').click();`);
        await delay(80);
        await js(`window.detail=__twMetadataQueue.drain();`);
        assert.equal(await js('detail.cancelled.length'),1);
        assert.equal(await js('detail.requests[0].kind'),'detail');
        await js(`__twMetadataQueue.complete(detail.token,detail.requests[0].id,{status:'ok',title:'测试影片 第二季',episodes:[{id:'1-1',title:'第1集'},{id:'1-2',title:'第2集'}]});`);
        await until('Android corresponding episode suggestion',()=>js(`!!document.querySelector('#discoveryEpisodes [data-suggested]')`));
        assert.equal(await js(`document.querySelector('#discoveryEpisodes [data-suggested]').getAttribute('href')`),'/discover/play/pkavi/12/1-2');
        assert.equal(await js(`document.querySelectorAll('#discoveryEpisodes [aria-current]').length`),0);
        for(const width of [390,320,480]) {
            win.setSize(width,844);
            await until('picker fits width '+width,()=>js(`innerWidth===${width} && document.documentElement.scrollWidth<=innerWidth+1`));
            assert.ok(await js(`document.getElementById('catalogFindOtherSources').getBoundingClientRect().right<=innerWidth`));
            await delay(400);
            fs.writeFileSync(path.join(output,`source-switch-${width}.png`),(await wc.capturePage()).toPNG());
        }
        await js(`document.getElementById('discoveryDetailClose').click();
            __twMetadataQueue.update(search.token,peer.id,{status:'ok',results:[{title:'测试影片 第二季',page_url:'https://www.pkavi.com/mv/99.html'}]});`);
        assert.equal(await js('TogetherWatchCatalogNavigation.pickerClosed()'),true);
        assert.equal(await js(`document.querySelectorAll('#catalogSourceChoices button').length`),2);
        console.log('SOURCE SWITCH UI PASS: Android packaged bridge, automatic alternatives without clicking Search, one provider yields for detail, correct episode suggestion, no season mixing, close rejects late results, 320/390/480px layout.');
    } finally {win.destroy();}
};
