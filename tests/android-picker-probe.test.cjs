const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../android-app/app/src/main/assets/episode-picker-probe.js'),'utf8');
function fixture(){
    const calls=[],style={visibility:'visible',display:'block',opacity:'1'};
    const panel={open:false,getBoundingClientRect:()=>({width:390,height:600,left:0,top:0,right:390,bottom:600})};
    const list={querySelector:()=>({})},status={textContent:'选择集数'};
    const window={__twMetadataQueue:{},TogetherWatchCatalogNavigation:{pickerClosed:()=>false,episodes:p=>{calls.push(p);panel.open=true;return true;}}};
    const context=vm.createContext({window,location:{origin:'https://watchtogethernow.cloud',pathname:'/discover'},
        innerWidth:390,innerHeight:800,document:{getElementById:id=>({discoveryDetail:panel,discoveryEpisodes:list,discoveryDetailStatus:status})[id]},getComputedStyle:()=>style});
    return {calls,style,panel,list,status,window,context,probe:source=>vm.runInContext(script,context)({source,item:'123',episode:'ep1'},'https://watchtogethernow.cloud')};
}
test('all supported providers share the same visible-panel handshake and open once',()=>{
    for(const source of ['kanju','pkavi','233dm','cupfox','yhdmoe']){
        const f=fixture();assert.equal(f.probe(source),'ready');assert.equal(f.probe(source),'ready');
        assert.equal(f.calls.length,1);assert.equal(f.calls[0].source,source);
    }
});
test('visible but empty content is loading, not success; failed reads and verification are distinct',()=>{
    const f=fixture();f.list.querySelector=()=>null;f.status.textContent='正在读取集数…';
    assert.equal(f.probe('kanju'),'loading');f.status.textContent='';assert.equal(f.probe('kanju'),'loading');
    f.status.textContent='集数读取失败，可重试';assert.equal(f.probe('kanju'),'notice');
    f.window.__twMetadataQueue.interactivePending=()=>true;assert.equal(f.probe('kanju'),'verifying');
});
test('off-screen panel after a rotation is not ready',()=>{
    const f=fixture();f.panel.getBoundingClientRect=()=>({width:390,height:600,left:500,top:0,right:890,bottom:600});
    assert.equal(f.probe('kanju'),'waiting');
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

test('initial blank document and partially parsed catalogue wait without opening or failing',()=>{
    const f=fixture();f.context.location={href:'about:blank',origin:'null',pathname:'blank'};
    assert.equal(f.probe('kanju'),'waiting');assert.equal(f.calls.length,0);
    f.context.location={href:'https://watchtogethernow.cloud/discover?picker=1',origin:'https://watchtogethernow.cloud',pathname:'/discover'};
    f.context.document.readyState='loading';assert.equal(f.probe('kanju'),'waiting');assert.equal(f.calls.length,0);
    f.context.document.readyState='interactive';assert.equal(f.probe('kanju'),'ready');assert.equal(f.calls.length,1);
});

test('script diagnostic uses only a known exception type, not message or stack',()=>{
    const f=fixture();f.window.TogetherWatchCatalogNavigation.episodes=()=>{throw TypeError('secret-media-url');};
    assert.equal(f.probe('kanju'),'error-TypeError');
});
