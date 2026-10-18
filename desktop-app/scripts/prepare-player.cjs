'use strict';
// Generated packaging asset; use the same audited vendor file as the web app.
const fs = require('node:fs');
const path = require('node:path');
const source = path.resolve(__dirname, '../../static/vendor/hls-1.5.18.min.js');
const target = path.resolve(__dirname, '../ui/hls.min.js');
fs.copyFileSync(source, target);
console.log('Prepared bundled HLS.js 1.5.18');
