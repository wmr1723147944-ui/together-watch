const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function entry(value) {
    const els={};let boot;
    for(const id of ['loginForm','username','roomId','createRoomBtn','joinRoomBtn','formError','complianceConsent'])
        els[id]={value:'',checked:true,dataset:{},handlers:{},focus(){},addEventListener(n,f){this.handlers[n]=f;}};
    els.username.value='test';els.roomId.value=value;
    const location={origin:'https://watchtogethernow.cloud',search:'',href:''};
    vm.runInNewContext(fs.readFileSync('static/js/index.js','utf8'),{
        document:{getElementById:id=>els[id],addEventListener:(_e,f)=>boot=f},window:{location},URL,URLSearchParams,
        crypto:require('node:crypto').webcrypto,localStorage:{getItem:()=>null,setItem(){}}
    });boot();return {els,location};
}
test('create and join controls never replace an entered room number with a random one',()=>{
    for(const button of ['createRoomBtn','loginForm']){
        const h=entry('0123456789abcdef01234567');
        h.els[button].handlers[button==='loginForm'?'submit':'click']({preventDefault(){}});
        assert.equal(h.location.href,'/room/0123456789abcdef01234567');
    }
});
test('bad input remains on entry with an error, blank create still creates a room',()=>{
    const bad=entry('wrong room number');bad.els.createRoomBtn.handlers.click();
    assert.equal(bad.location.href,'');assert.match(bad.els.formError.textContent,/有效邀请/);
    const empty=entry('');empty.els.createRoomBtn.handlers.click();assert.match(empty.location.href,/^\/room\/[a-f0-9]{24}$/);
});
test('web invitation forms and shared text join the same identity',()=>{
    for(const value of ['房间号：abcd1234','来一起看：https://watchtogethernow.cloud/room/abcd1234。',
        'https://watchtogethernow.cloud/?room=abcd1234','https://watchtogethernow.cloud/mobile-room/abcd1234']){
        const h=entry(value);h.els.loginForm.handlers.submit({preventDefault(){}});assert.equal(h.location.href,'/room/abcd1234',value);
    }
});
