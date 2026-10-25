'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
test('Windows icon has transparent PNG frames at every required taskbar/explorer size',()=>{
    const data=fs.readFileSync(path.join(root,'desktop-app/assets/app.ico'));
    assert.equal(data.readUInt16LE(0),0);assert.equal(data.readUInt16LE(2),1);
    const count=data.readUInt16LE(4),sizes=[];assert.equal(count,7);
    let end=6+16*count;
    for(let i=0;i<count;i++) {
        const p=6+16*i,size=data[p]||256,len=data.readUInt32LE(p+8),offset=data.readUInt32LE(p+12);
        sizes.push(size);assert.equal(data[p+1]||256,size);assert.equal(offset,end);
        const png=data.subarray(offset,offset+len);assert.equal(png.subarray(1,4).toString(),'PNG');
        assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);assert.equal(png[25],6,'RGBA transparency');
        end+=len;
    }
    assert.deepEqual(sizes,[16,24,32,48,64,128,256]);assert.equal(end,data.length);
});
test('branded shell, window icon and executable icon are all wired to shipped assets',()=>{
    const pkg=JSON.parse(fs.readFileSync(path.join(root,'desktop-app/package.json'),'utf8'));
    assert.match(pkg.scripts['package:win'],/--icon=assets\/app\.ico/);
    assert.equal(fs.readFileSync(path.join(root,'desktop-app/ui/app-icon.svg'),'utf8'),fs.readFileSync(path.join(root,'static/favicon.svg'),'utf8'));
    const main=fs.readFileSync(path.join(root,'desktop-app/src/main.cjs'),'utf8');
    assert.ok(main.includes("icon: path.join(__dirname, '../assets/app.ico')"));
    assert.ok(main.includes("'app-icon.svg'"));
    assert.match(fs.readFileSync(path.join(root,'desktop-app/ui/index.html'),'utf8'),/src="app-icon.svg"/);
});

test('approved companion identity keeps four eyes and fits the Android safe circle',()=>{
    const svg=fs.readFileSync(path.join(root,'static/favicon.svg'),'utf8');
    assert.match(svg,/<title>一起看 · 陪伴<\/title>/);
    assert.match(svg,/id="background"[^>]+fill="#f4664b"/);
    const shapes=[...svg.matchAll(/<path id="(body|eye[1-4])" fill="([^"]+)" d="([^"]+)"\/>/g)];
    assert.deepEqual(shapes.map(p=>p[1]),['body','eye1','eye2','eye3','eye4']);
    assert.deepEqual(shapes.map(p=>p[2]),['#fff5e6','#262323','#262323','#262323','#262323']);
    // Every cubic Bezier lies in its control-point convex hull. Keeping all
    // control points inside the 66dp safe circle also keeps the entire curve.
    for(const shape of shapes) {
        assert.equal(shape[3].replace(/[MCZ0-9.\s-]/g,''),'');
        const coordinates=shape[3].match(/-?\d+(?:\.\d+)?/g).map(Number);
        assert.equal(coordinates.length%2,0);
        for(let i=0;i<coordinates.length;i+=2) {
            const x=(coordinates[i]-54)*.65,y=(coordinates[i+1]-54)*.65;
            assert.ok(Math.hypot(x,y)<=33,`${shape[1]} leaves the Android safe circle`);
        }
    }
    const pkg=JSON.parse(fs.readFileSync(path.join(root,'desktop-app/package.json'),'utf8'));
    const shell=fs.readFileSync(path.join(root,'desktop-app/ui/index.html'),'utf8');
    assert.ok(shell.includes(`WINDOWS · ${pkg.version} 测试版`));
});
