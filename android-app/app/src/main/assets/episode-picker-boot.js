/* This APK-owned document is already hosted inside a native drawer. */
(function(){
    'use strict';
    if(typeof Object.hasOwn!=='function')Object.hasOwn=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
    document.addEventListener('DOMContentLoaded',()=>{
        const panel=document.getElementById('discoveryDetail');
        // Avoid a second modal/top-layer/compositor inside Android's Dialog.
        // Preserve the shared controller's open/close contract and events.
        panel.showModal=()=>panel.setAttribute('open','');
        panel.close=()=>{if(!panel.open)return;panel.removeAttribute('open');panel.dispatchEvent(new Event('close'));};
    });
})();
