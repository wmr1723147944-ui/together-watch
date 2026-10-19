'use strict';
const fs=require('node:fs'), path=require('node:path');
const source=path.resolve(__dirname,'../../static/js/catalog-adapters.js');
const filename=fs.existsSync(source)?source:path.join(__dirname,'../ui/catalog-adapters.js');
module.exports={api:require(filename),script:fs.readFileSync(filename,'utf8')};
