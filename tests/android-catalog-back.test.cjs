const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../android-app/app/src/main/assets/catalog-back.js'),'utf8');
function fixture(){
    const state={detail:false,history:false,search:false,room:true};
    const account={open:false,close(){this.open=false;}};
    const context={location:{origin:'https://watchtogethernow.cloud',pathname:'/discover'},document:{getElementById:()=>account},
        window:{TogetherWatchCatalogNavigation:{back(){
            for(const layer of ['history','detail','search'])if(state[layer]){state[layer]=false;return true;}
            return false;
        }}}};
    return {state,account,context,back:()=>vm.runInNewContext(script,context)('https://watchtogethernow.cloud')};
}
test('home is the terminal destination regardless of a retained playback room',()=>{
    const f=fixture();assert.equal(f.back(),'home');f.state.room=false;assert.equal(f.back(),'home');
});
test('back dismisses details, then search, then requests exit from home',()=>{
    const f=fixture();f.state.search=true;f.state.detail=true;
    assert.equal(f.back(),'handled');assert.equal(f.state.search,true);
    assert.equal(f.back(),'handled');assert.equal(f.back(),'home');
});
test('account and history overlays close without requesting app exit',()=>{
    const f=fixture();f.account.open=true;f.state.history=true;
    assert.equal(f.back(),'handled');assert.equal(f.state.history,true);
    assert.equal(f.back(),'handled');assert.equal(f.back(),'home');
});
test('missing, untrusted or failed catalogue is not treated as home',()=>{
    for(const change of [f=>delete f.context.window.TogetherWatchCatalogNavigation,
        f=>f.context.location.origin='https://other.example',f=>f.context.location.pathname='/room/demo',
        f=>f.context.window.TogetherWatchCatalogNavigation.back=()=>{throw Error('failed');},
        f=>f.context.window.TogetherWatchCatalogNavigation.back=()=>undefined]){
        const f=fixture();change(f);assert.equal(f.back(),'unavailable');
    }
});
