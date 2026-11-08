const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../android-app/app/src/main/assets/episode-picker-probe.js'),'utf8');
function fixture(){
    const calls=[],style={visibility:'visible',display:'block',opacity:'1'};
    const panel={open:false,getBoundingClientRect:()=>({width:390,height:600})};
    const window={__twMetadataQueue:{},TogetherWatchCatalogNavigation:{pickerClosed:()=>false,episodes:p=>{calls.push(p);panel.open=true;return true;}}};
    const context=vm.createContext({window,location:{origin:'https://watchtogethernow.cloud',pathname:'/discover'},
        document:{getElementById:()=>panel},getComputedStyle:()=>style});
    return {calls,style,panel,window,context,probe:source=>vm.runInContext(script,context)({source,item:'123',episode:'ep1'},'https://watchtogethernow.cloud')};
}
test('all supported providers share the same visible-panel handshake and open once',()=>{
    for(const source of ['kanju','pkavi','233dm','cupfox','yhdmoe']){
        const f=fixture();assert.equal(f.probe(source),'ready');assert.equal(f.probe(source),'ready');
        assert.equal(f.calls.length,1);assert.equal(f.calls[0].source,source);
    }
});
test('API success with hidden, missing or zero-size drawer is not ready',()=>{
    const f=fixture();f.style.visibility='hidden';assert.equal(f.probe('kanju'),'waiting');
    f.style.visibility='visible';f.style.opacity='0';assert.equal(f.probe('kanju'),'waiting');
    f.style.opacity='1';f.panel.getBoundingClientRect=()=>({width:0,height:0});assert.equal(f.probe('kanju'),'waiting');
    f.panel.open=false;assert.equal(f.probe('kanju'),'waiting');assert.equal(f.calls.length,1);
});
test('waits for the metadata bridge and distinguishes closed and unsupported sources',()=>{
    const f=fixture();delete f.window.__twMetadataQueue;assert.equal(f.probe('kanju'),'waiting');assert.equal(f.calls.length,0);
    f.window.__twMetadataQueue={};f.window.TogetherWatchCatalogNavigation.episodes=()=>false;assert.equal(f.probe('kanju'),'unsupported');
    f.window.TogetherWatchCatalogNavigation.pickerClosed=()=>true;assert.equal(f.probe('kanju'),'closed');
});
test('renderer exceptions and untrusted navigation fail without exposing details',()=>{
    const f=fixture();f.window.TogetherWatchCatalogNavigation.episodes=()=>{throw Error('secret');};
    assert.equal(f.probe('kanju'),'error');
    f.context.location.origin='https://untrusted.example';assert.equal(f.probe('kanju'),'untrusted');
});
