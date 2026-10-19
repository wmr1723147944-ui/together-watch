'use strict';
const {contextBridge,ipcRenderer} = require('electron');
// Only installed on the first-party catalogue. Main validates sender + origin
// on every call; original-site windows never receive a preload.
contextBridge.exposeInMainWorld('twSourceMetadata', {
    supportedSources: ['233dm','pkavi','kanju'],
    request: (id,kind,payload,interactive=false) => ipcRenderer.invoke('desktop:metadata',{id,kind,payload,interactive}),
    cancel: id => ipcRenderer.invoke('desktop:metadata-cancel',id),
});
