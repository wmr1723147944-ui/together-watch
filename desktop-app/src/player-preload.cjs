'use strict';
const {contextBridge,ipcRenderer}=require('electron');
// Only the packaged player gets this single-purpose bridge. No URL, room
// capability, source-site cookie, or arbitrary shell action crosses it.
if(location.href==='tw-app://desktop/player.html') {
    contextBridge.exposeInMainWorld('twPlayer',Object.freeze({episodes:()=>ipcRenderer.invoke('desktop:player-episodes')}));
}
