'use strict';
// Generated packaging asset; use the same audited vendor file as the web app.
const fs = require('node:fs');
const path = require('node:path');
const source = path.resolve(__dirname, '../../static/vendor/hls-1.5.18.min.js');
const target = path.resolve(__dirname, '../ui/hls.min.js');
fs.copyFileSync(source, target);
console.log('Prepared bundled HLS.js 1.5.18');
fs.copyFileSync(path.resolve(__dirname, '../../static/data/site-directory.json'), path.resolve(__dirname, '../ui/site-directory.json'));
console.log('Prepared reviewed site directory');
fs.copyFileSync(path.resolve(__dirname,'../../static/js/catalog-adapters.js'),path.resolve(__dirname,'../ui/catalog-adapters.js'));
console.log('Prepared catalogue adapter rules');
const bindings=fs.readFileSync(path.resolve(__dirname,'../src/media-bindings.js'),'utf8');
fs.writeFileSync(path.resolve(__dirname,'../src/media-preload.cjs'),
    "'use strict';\n// Generated from media-bindings.js. No IPC or native API is exposed.\nrequire('electron').contextBridge.executeInMainWorld({func:()=>{\n"+bindings+"\n}});\n");
fs.copyFileSync(path.resolve(__dirname,'../../android-app/app/src/main/assets/episode-media-guard.js'),path.resolve(__dirname,'../ui/episode-media-guard.js'));
console.log('Prepared device-local media binding and episode guard');
