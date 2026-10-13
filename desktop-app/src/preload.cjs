'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Only the packaged control page gets this fixed, narrow API.
contextBridge.exposeInMainWorld('desktop', {
    start: data => ipcRenderer.invoke('desktop:start', data),
    action: action => ipcRenderer.invoke('desktop:action', action),
    onStatus: callback => ipcRenderer.on('desktop:status', (_event, value) => callback(value)),
});
