'use strict';
const {api,script}=require('./catalog-adapters.cjs');

// Read only the current programme's public DOM. Do not navigate the playing
// view, click controls, inspect storage, or pass its credentials elsewhere.
async function readPlayingMetadata(wc,req,isCurrent=()=>true) {
    const unavailable=()=>api.normalizeResult(req,{status:'unavailable'});
    const matches=()=>isCurrent() && !!wc && !wc.isDestroyed() && api.expectedPage(req,wc.getURL());
    if(req.kind!=='detail' || !matches())return unavailable();
    const at=wc.getURL();
    if(!wc.debugger.isAttached())wc.debugger.attach('1.3');
    const {frameTree}=await wc.debugger.sendCommand('Page.getFrameTree');
    if(!matches() || wc.getURL()!==at || frameTree?.frame.url!==at)return unavailable();
    const {executionContextId}=await wc.debugger.sendCommand('Page.createIsolatedWorld',{
        frameId:frameTree.frame.id,worldName:'TogetherWatchPlayingMetadata',grantUniveralAccess:false,
    });
    if(!matches() || wc.getURL()!==at)return unavailable();
    const reply=await wc.debugger.sendCommand('Runtime.evaluate',{
        contextId:executionContextId,returnByValue:true,timeout:1000,
        expression:'(()=>{'+script+';return location.href !== '+JSON.stringify(at)
            +' ? {status:"unavailable"} : TogetherWatchCatalogAdapters.readDocument(document,'+JSON.stringify(req)+');})()',
    });
    if(!matches() || wc.getURL()!==at || reply.exceptionDetails)return unavailable();
    return api.normalizeResult(req,reply.result?.value);
}
module.exports={readPlayingMetadata};
