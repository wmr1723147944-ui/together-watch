'use strict';
// Real catalogue DOM + Android's packaged queue. Native WebView polling is
// simulated here; this is not a physical-phone or public-source playback test.
const {BrowserWindow,net,nativeImage}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
exports.run=async({server,output,until})=>{
    const waiting=[];
    const win=new BrowserWindow({show:false,width:390,height:844,useContentSize:true,webPreferences:{
        offscreen:true,backgroundThrottling:false,contextIsolation:true,sandbox:true,nodeIntegration:false,partition:'search-stream-'+Date.now()}});
    const wc=win.webContents,js=script=>wc.executeJavaScript(script);
    wc.on('console-message',(_event,details)=>{if(details.level==='error')console.error('SEARCH RENDERER:',details.message);});
    const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
    try{
        await wc.session.protocol.handle('http',async request=>{
            const url=new URL(request.url);
            if(url.origin!==server)return new Response('',{status:404});
            if(url.pathname==='/api/discover/feed')return json({source_id:url.searchParams.get('source'),category:'all',page:1,status:'ok',results:[],has_more:false});
            if(url.pathname==='/api/discover/search'){
                const data=await request.json();
                return new Promise(resolve=>waiting.push(()=>resolve(json({source_id:data.source,status:'ok',results:[]}))));
            }
            return net.fetch(request,{bypassCustomProtocolHandlers:true});
        });
        const bytes=Buffer.alloc(400*600*4,180),poster=nativeImage.createFromBitmap(bytes,{width:400,height:600}).toPNG();
        await wc.session.protocol.handle('https',request=>new URL(request.url).hostname==='image.tmdb.org'
            ?new Response(poster,{headers:{'Content-Type':'image/png'}}):new Response('',{status:404}));
        await win.loadURL(server+'/discover');
        await js(fs.readFileSync(path.resolve(__dirname,'../../android-app/app/src/main/assets/catalog-metadata-bridge.js'),'utf8'));
        await js(`for(const c of document.querySelectorAll('[data-live-source]'))c.checked=['cupfox','yhdmoe','kanju','pkavi'].includes(c.dataset.liveSource);
            document.getElementById('discoveryQuery').value='渐进测试';document.getElementById('discoveryForm').requestSubmit();
            window.batch=__twMetadataQueue.drain();window.nativeRequests=batch.requests;`);
        await until('server requests held',()=>waiting.length===2);
        assert.equal(await js('nativeRequests.length'),2,'native jobs must start while server jobs are held');
        await js(`window.firstJob=nativeRequests.find(r=>r.payload.source==='kanju');
            window.firstResult={status:'ok',results:[{title:'渐进测试 第一部',page_url:'https://www.kanju.ai/player/av_first'}]};
            __twMetadataQueue.update(batch.token,firstJob.id,firstResult);`);
        await until('partial result painted',()=>js(`document.querySelectorAll('#discoveryLiveResults .catalog-film').length===1 && document.getElementById('catalogSkeleton').hidden`));
        assert.equal(await js(`document.getElementById('discoveryLive').getAttribute('aria-busy')`),'true');
        await js(`window.firstCard=document.querySelector('#discoveryLiveResults .catalog-film');
            firstResult.results[0].poster_url='https://image.tmdb.org/t/p/w500/stream-fixture.png';
            __twMetadataQueue.update(batch.token,firstJob.id,firstResult);`);
        await until('cover enriches existing card',()=>js(`firstCard.querySelector('img')?.naturalWidth>0`));
        assert.ok(await js(`firstCard===document.querySelector('#discoveryLiveResults .catalog-film') && firstCard.getBoundingClientRect().height>0`));
        assert.ok(await js('document.documentElement.scrollWidth<=innerWidth+1'));
        fs.writeFileSync(path.join(output,'mobile-incremental-first-result.png'),(await wc.capturePage()).toPNG());
        await js(`firstCard.querySelector('button').click();`);
        await delay(80);
        await js(`window.detailBatch=__twMetadataQueue.drain();`);
        const detail=await js('detailBatch.requests[0]');
        assert.equal(detail.kind,'detail');assert.equal(detail.payload.source,'kanju');
        assert.equal(await js('detailBatch.cancelled.length'),1,'only the same-provider search yields to detail');
        await js(`window.peerJob=nativeRequests.find(r=>r.payload.source==='pkavi');
            window.peerResult={status:'ok',results:[{title:'渐进测试 第1部',page_url:'https://www.pkavi.com/mv/12.html'}]};
            __twMetadataQueue.update(batch.token,peerJob.id,peerResult);`);
        await until('late source joins the same card and open detail',()=>js(`document.querySelectorAll('#discoveryLiveResults .catalog-film').length===1 && document.querySelectorAll('#catalogSourceChoices button').length===2`));
        await js(`__twMetadataQueue.complete(detailBatch.token,${JSON.stringify(detail.id)},
            {status:'ok',title:'渐进测试 第一部',episodes:[{id:'ep-e1',title:'第1集'}]});`);
        await until('early result can open episodes',()=>js(`document.querySelectorAll('#discoveryEpisodes .discovery-episode').length===1`));
        await js(`__twMetadataQueue.complete(batch.token,peerJob.id,peerResult);`);
        let resumed=false;
        for(let n=0;n<6;n++) {
            await delay(60);
            const resumedBatch=await js(`__twMetadataQueue.drain()`);
            for(const request of resumedBatch.requests) {
                assert.equal(request.kind,'search');
                if(request.payload.source==='kanju')resumed=true;
                await js(`__twMetadataQueue.complete(${JSON.stringify(resumedBatch.token)},${JSON.stringify(request.id)},${request.payload.source==='kanju'?'firstResult':"{status:'ok',results:[]}"});`);
            }
        }
        assert.ok(resumed,'interrupted search restarts automatically');
        waiting.splice(0).forEach(resolve=>resolve());
        await until('search automatically finishes',()=>js(`document.getElementById('discoveryLive').getAttribute('aria-busy')==='false'`));
        await js(`document.getElementById('discoveryDetailClose').click();
            __twMetadataQueue.update(batch.token,firstJob.id,{status:'ok',results:[{title:'渐进测试 迟到条目',page_url:'https://www.kanju.ai/player/av_late'}]});`);
        await delay(120);
        assert.equal(await js(`document.getElementById('discoveryQuery').value`),'渐进测试');
        assert.ok(await js(`firstCard===document.querySelector('#discoveryLiveResults .catalog-film') && !document.getElementById('discoveryLiveResults').textContent.includes('迟到条目')`));
        console.log('INCREMENTAL SEARCH PASS: native partial paints first, one merged card and live source choices, detail preempts only its provider, interrupted search resumes without clicks, Back retains results, stale updates ignored.');
    }finally{waiting.forEach(resolve=>resolve());win.destroy();}
};
