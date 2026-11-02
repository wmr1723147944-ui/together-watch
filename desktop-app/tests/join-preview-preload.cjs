// Test-only shell bridge. No server mutations; packaged builds exclude tests/.
const {contextBridge}=require('electron');
contextBridge.exposeInMainWorld('desktop',{
    action:async()=>({ok:true}),
    start:async data=>({ok:true,room:data.room}),
    onStatus:callback=>setTimeout(()=>callback({setup:true}),50),
});
