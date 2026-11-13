'use strict';
// Capability-scoped, device-local media transport. No listening port, generic
// proxy, cookie jar, site credentials, certificate override or renderer URL API.
const https=require('node:https'),dns=require('node:dns'),crypto=require('node:crypto');
const {Readable}=require('node:stream');
const {publicHttps,APP_ORIGIN}=require('./policy.cjs');
// Media playlists may point to TLS CDNs on non-default ports. Keep the stricter
// page/navigation policy; this accepts only internally minted playlist resources
// and still validates/pins a public DNS address before each connection.
function publicMediaUrl(value){
    if(typeof value!=='string'||value.length>4096)return '';
    try{const u=new URL(value),check=new URL(u);check.port='';
        return publicHttps(check.href)&&u.port!=='0'?u.href:'';
    }catch{return '';}
}
function publicIPv4(address){
    if(!/^\d+\.\d+\.\d+\.\d+$/.test(address))return false;
    const [a,b,c,d]=address.split('.').map(Number);
    return [a,b,c,d].every(n=>n>=0&&n<=255) && a>0 && a<224 && ![10,127].includes(a)
        && !(a===100&&b>=64&&b<=127) && !(a===169&&b===254) && !(a===172&&b>=16&&b<=31)
        && !(a===192&&(b===168||b===0||b===2)) && !(a===198&&(b===18||b===19||b===51)) && !(a===203&&b===0&&c===113);
}
function safeLookup(host,options,callback){
    dns.lookup(host,{all:true,family:4},(error,rows)=>{
        const safe=(rows||[]).filter(r=>publicIPv4(r.address));
        if(error||!safe.length)return callback(error||Error('Non-public media host'));
        // The exact validated address is passed to the TLS socket (no DNS rebind).
        if(options.all)callback(null,safe);else callback(null,safe[0].address,4);
    });
}
function anonymousHeaders(input={}){
    const result={};
    for(const [key,raw] of Object.entries(input)){
        if(typeof raw!=='string'||raw.length>2048||/[\r\n]/.test(raw))continue;
        const name=key.toLowerCase();
        if(name==='user-agent')result['User-Agent']=raw;
        if((name==='referer'||name==='origin')&&publicHttps(raw)){
            const u=new URL(raw);u.search='';u.hash='';result[name==='origin'?'Origin':'Referer']=name==='origin'?u.origin:u.href;
        }
    }
    return result;
}
function fetchMedia(url,headers,signal,redirects=0){
    if(!publicMediaUrl(url)||redirects>4)return Promise.reject(Error('Invalid media redirect'));
    return new Promise((resolve,reject)=>{
        const req=https.get(url,{headers,lookup:safeLookup,signal,timeout:15000},res=>{
            const status=res.statusCode||502;
            if([301,302,303,307,308].includes(status)&&res.headers.location){
                res.resume();let next;try{next=new URL(res.headers.location,url).href;}catch{return reject(Error('Invalid redirect'));}
                const kept=new URL(next).origin===new URL(url).origin?headers:{'User-Agent':headers['User-Agent']||'',...(headers.Range?{Range:headers.Range}:{})};
                fetchMedia(next,kept,signal,redirects+1).then(resolve,reject);return;
            }
            resolve({status,headers:res.headers,body:Readable.toWeb(res),url});
        });
        req.on('timeout',()=>req.destroy(Error('Media request timeout')));
        req.on('error',reject);
    });
}
async function boundedText(stream){
    const reader=stream.getReader(),chunks=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
        if(size>2*1024*1024)throw Error('Playlist too large');chunks.push(Buffer.from(value));}
        return Buffer.concat(chunks).toString('utf8');
    }finally{await reader.cancel().catch(()=>{});}
}
function rewritePlaylist(text,base,register){
    if(!text.replace(/^\uFEFF/,'').startsWith('#EXTM3U'))throw Error('Not a playlist');
    let nextPlaylist=false;
    return text.split(/\r?\n/).map(line=>{
        const s=line.trim();
        if(/^#EXT-X-(?:SESSION-)?KEY:/i.test(s)&&!/(?:^|,)METHOD=(?:NONE|AES-128)(?:,|$)/i.test(s.slice(s.indexOf(':')+1)))throw Error('Protected playlist');
        const map=(raw,playlist=false)=>{const u=new URL(raw,base).href;if(!publicMediaUrl(u))throw Error('Non-public playlist resource');return register(u,playlist);};
        if(s&&!s.startsWith('#')){const out=map(s,nextPlaylist);nextPlaylist=false;return out;}
        if(s.startsWith('#EXT-X-STREAM-INF:'))nextPlaylist=true;
        return line.replace(/\bURI="([^"]+)"/g,(_whole,uri)=>'URI="'+map(uri,/^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF):/.test(s))+'"');
    }).join('\n');
}
class MediaTransport {
    constructor(fetcher=fetchMedia,diagnostic=()=>{}){this.fetcher=fetcher;this.diagnostic=diagnostic;this.reset();}
    reset(){this.controller?.abort();this.controller=new AbortController();this.token=crypto.randomBytes(24).toString('hex');this.resources=new Map();this.reverse=new Map();this.root='';this.context={};}
    start(item,headers={}){this.reset();this.root=item.url;this.kind=item.kind;this.context=anonymousHeaders(headers);return this.register(item.url,item.kind==='hls');}
    register(url,playlist=false){
        if(!publicMediaUrl(url))throw Error('Invalid media URL');
        let id=this.reverse.get(url);
        if(!id){if(this.resources.size>=10000)throw Error('Resource limit');id=crypto.randomBytes(16).toString('hex');this.reverse.set(url,id);this.resources.set(id,{url,playlist});}
        else if(playlist)this.resources.get(id).playlist=true;
        return APP_ORIGIN+'/media/'+this.token+'/'+id;
    }
    async handle(request){
        const u=new URL(request.url),match=/^\/media\/([a-f0-9]{48})\/([a-f0-9]{32})$/.exec(u.pathname);
        if(u.protocol!=='tw-app:'||u.host!=='desktop'||u.username||u.password||u.search||u.hash||!match||match[1]!==this.token||!['GET','HEAD'].includes(request.method))return new Response('Not found',{status:404});
        const resource=this.resources.get(match[2]);if(!resource)return new Response('Not found',{status:404});
        const token=this.token,controller=this.controller;
        const abort=new AbortController(),onAbort=()=>abort.abort();
        controller.signal.addEventListener('abort',onAbort,{once:true});
        request.signal?.addEventListener('abort',onAbort,{once:true});
        const cleanup=()=>{controller.signal.removeEventListener('abort',onAbort);request.signal?.removeEventListener('abort',onAbort);};
        let streaming=false;
        try{
            const headers=new URL(resource.url).origin===new URL(this.root).origin?{...this.context}:{'User-Agent':this.context['User-Agent']||''};
            const range=request.headers.get('range');if(range&&/^bytes=\d*-\d*$/.test(range))headers.Range=range;
            const response=await this.fetcher(resource.url,headers,abort.signal);
            if(token!==this.token){response.body?.cancel();return new Response('Expired',{status:410});}
            const out={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
            for(const name of ['content-type','content-range','accept-ranges'])if(typeof response.headers[name]==='string')out[name]=response.headers[name];
            if(response.status>=400){await response.body?.cancel();return new Response('Media request rejected',{status:response.status});}
            if(resource.playlist||/\.m3u8(?:\?|$)/i.test(response.url)||/mpegurl/i.test(out['content-type']||'')){
                const text=await boundedText(response.body);
                if(token!==this.token)return new Response('Expired',{status:410});
                const rewritten=rewritePlaylist(text,response.url,(url,playlist)=>this.register(url,playlist));
                return new Response(request.method==='HEAD'?null:rewritten,{headers:{...out,'Content-Type':'application/vnd.apple.mpegurl'}});
            }
            // Chromium needs the original byte length/range for progressive
            // media seeking. Never reuse it for a rewritten playlist above.
            if(/^\d+$/.test(String(response.headers['content-length']||'')))out['content-length']=String(response.headers['content-length']);
            if(request.method==='HEAD'){await response.body?.cancel();return new Response(null,{status:response.status,headers:out});}
            // Keep cancellation wired until the streaming response completes.
            const reader=response.body.getReader();
            const body=new ReadableStream({async pull(s){try{const v=await reader.read();if(v.done){cleanup();s.close();}else s.enqueue(v.value);}catch(e){cleanup();s.error(e);}},cancel(){cleanup();abort.abort();return reader.cancel();}});
            streaming=true;
            return new Response(body,{status:response.status,headers:out});
        }catch(error){
            const reasons={'Not a playlist':'NOT_PLAYLIST','Non-public playlist resource':'UNSAFE_MEDIA_URL','Protected playlist':'PROTECTED_PLAYLIST',
                'Non-public media host':'PRIVATE_HOST','Invalid media redirect':'UNSAFE_REDIRECT','Playlist too large':'PLAYLIST_TOO_LARGE','Media request timeout':'MEDIA_TIMEOUT'};
            const code=/^[A-Z0-9_]{1,60}$/.test(error.code||'')?error.code:reasons[error.message]||(error.name==='TypeError'?'TYPE_ERROR':'READ_FAILED');
            this.diagnostic({stage:resource.playlist?'playlist':'media',code});
            cleanup();return new Response('Media transport failed',{status:502});
        }
        finally{if(!streaming||abort.signal.aborted)cleanup();}
    }
}
module.exports={MediaTransport,rewritePlaylist,anonymousHeaders,publicIPv4,publicMediaUrl};
