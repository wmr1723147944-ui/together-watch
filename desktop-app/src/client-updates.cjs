'use strict';
const VERSION=/^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
function compare(a,b) {
    if(typeof a!=='string'||typeof b!=='string'||!VERSION.test(a)||!VERSION.test(b))throw Error('Invalid version');
    const left=a.split('.').map(Number),right=b.split('.').map(Number);
    for(let i=0;i<3;i++)if(left[i]!==right[i])return Math.sign(left[i]-right[i]);return 0;
}
function parse(data,installed) {
    if(!data || data.schema!==1 || typeof data.available!=='boolean')throw Error('Invalid update response');
    if(!data.available)return {state:'unpublished'};
    const r=data.release;
    if(!r || r.platform!=='windows' || typeof r.version!=='string' || !VERSION.test(r.version)
        || r.filename!==`TogetherWatch-Windows-${r.version}-x64.zip`
        || r.download_path!==`/downloads/files/${r.filename}` || !/^[0-9a-f]{64}$/.test(r.sha256)
        || !Number.isSafeInteger(r.size) || r.size<=0 || r.size>1073741824
        || !Array.isArray(r.notes) || r.notes.length>8 || r.notes.some(n=>typeof n!=='string'||n.length>240))throw Error('Invalid release');
    return {state:compare(r.version,installed)>0?'available':'current',version:r.version,notes:r.notes};
}
async function check(fetcher,origin,installed) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try {
        const response=await fetcher(origin+'/api/client-updates/windows',{signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store'});
        if(!response.ok)throw Error('Update service unavailable');
        const reader=response.body.getReader(),chunks=[];let length=0;
        try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>32768)throw Error('Update response too large');chunks.push(value);}}
        finally {await reader.cancel().catch(()=>{});}
        return parse(JSON.parse(Buffer.concat(chunks).toString('utf8')),installed);
    } finally {clearTimeout(timer);}
}
function mayNotify(result,{manual=false,watching=false,notifiedVersions=new Set()}={}) {
    return !!result && (manual || (result.state==='available' && !watching && !notifiedVersions.has(result.version)));
}
module.exports={compare,parse,check,mayNotify};
