'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
let build;
module.exports=program=>{
    if(!build){
        build=fs.mkdtempSync(path.join(os.tmpdir(),'tw-script-fixture-'));
        for(const file of ['static/js/catalog-adapters.js','android-app/app/src/main/assets/episode-media-guard.js','android-app/app/src/main/assets/media-discovery.js']){
            const destination=path.join(build,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(root,file),destination);
        }
        for(const file of ['main/java/cloud/watchtogethernow/mobile/WebPlayerScripts.java','test/java/cloud/watchtogethernow/mobile/ScriptFixture.java'])
            fs.copyFileSync(path.join(root,'android-app/app/src',file),path.join(build,path.basename(file)));
        const jdk=process.env.JAVA_HOME;if(!jdk)throw Error('JAVA_HOME is required for production Java script regression');
        const result=spawnSync(path.join(jdk,'bin',process.platform==='win32'?'javac.exe':'javac'),['-encoding','UTF-8','-d',build,path.join(build,'WebPlayerScripts.java'),path.join(build,'ScriptFixture.java')],{encoding:'utf8',windowsHide:true});
        if(result.status!==0)throw Error(result.stderr||String(result.error));
    }
    const result=spawnSync(path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'),['-cp',build,'cloud.watchtogethernow.mobile.ScriptFixture',build,JSON.stringify(program)],{encoding:'utf8',windowsHide:true});
    if(result.status!==0)throw Error(result.stderr||String(result.error));
    return Buffer.from(result.stdout,'base64').toString('utf8');
};
