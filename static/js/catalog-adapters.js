(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TogetherWatchCatalogAdapters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const posterDomains = ['img.ddys.io','video.blender.org','huarw.com','cupfox.in','yhdmoe.com','fcma.cc',
        '233dm.com','pkavi.com','kanju.ai','doubanio.com','image.tmdb.org',
        'www.lufys.com','img.ffzy888.com','www.mdzypic.com','img.lzipic.com',
        'snzypic.vip','p.bfvp26.com','img.picbf.com','pps.vodfeiss.com','img.liangzipic.com'];
    function safePosterUrl(value, base) {
        if (typeof value!=='string' || !value || value.length>2048 || /[\s\\\x00-\x1f\x7f]/.test(value)) return null;
        try {
            const u=new URL(value,base);
            if(u.protocol!=='https:' || u.username || u.password || u.port || u.hash
                || !posterDomains.some(d=>u.hostname===d || u.hostname.endsWith('.'+d))
                || !/\.(?:jpe?g|png|webp|avif|gif)$/i.test(u.pathname)
                || /placeholder|loading|favicon|spacer/i.test(u.pathname)
                || Array.from(u.searchParams.keys()).some(k=>!['w','h','width','height','q','quality','format','fit','auto','size','v'].includes(k))) return null;
            return u.href;
        } catch {return null;}
    }
    const sources = {
        huarw: {host:'huarw.com', name:'华人影院', detail:/^\/movie\/(\d{1,20})$/,
            play:/^\/play\/(\d{1,20})((?:-\d{1,5}){1,3})$/, search:'/search'},
        kanju: {host:'www.kanju.ai', name:'看剧 AI', nativeOnly:true, search:'/collections/browse'},
        '233dm': {host:'www.233dm.com', name:'233 动漫', detail:/^\/anime\/([a-f0-9]{24})\.html$/,
            play:/^\/anime\/([a-f0-9]{24})\/play\/([1-9]\d{0,4})\/([1-9]\d{0,4})\.html$/, search:'/search/-------------.html'},
        pkavi: {host:'www.pkavi.com', name:'七味网', detail:/^\/mv\/([1-9]\d{0,19})\.html$/,
            play:/^\/py\/([1-9]\d{0,19})-([1-9]\d{0,4})-([1-9]\d{0,4})\.html$/, search:'/vs/-------------.html'},
    };
    const publicId = value => typeof value==='string' && /^[A-Za-z0-9_-]{1,160}(?::[A-Za-z0-9_-]{1,80})?$/.test(value);
    const text = (value, max=160) => typeof value === 'string'
        ? value.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,max) : '';
    function urlFor(source, value) {
        if (typeof source !== 'string' || !Object.hasOwn(sources, source)) return null;
        const rule = sources[source];
        if (!rule || typeof value !== 'string' || value.length>1024 || value.includes('\\')) return null;
        try {
            const u = new URL(value, 'https://'+rule.host);
            const queryOk=source==='kanju' ? Array.from(u.searchParams.keys()).every(k=>['episode','line','from','resume','adult'].includes(k) && u.searchParams.getAll(k).length===1)
                && ['episode','line'].every(k=>!u.searchParams.has(k) || publicId(u.searchParams.get(k))) : !u.search;
            return u.protocol==='https:' && (u.host===rule.host || source==='kanju' && u.host==='kanju.ai') && !u.username && !u.password && queryOk && !u.hash ? u : null;
        } catch { return null; }
    }
    function detail(source, value) {
        if(source==='kanju') {
            const u=urlFor(source,value);
            try { const id=u?.pathname.startsWith('/player/') ? decodeURIComponent(u.pathname.slice(8)) : null;
                return publicId(id) ? {page:'https://www.kanju.ai/player/'+encodeURIComponent(id),item:id} : null;
            } catch {return null;}
        }
        const u=urlFor(source,value), match=u && sources[source].detail.exec(u.pathname);
        return match ? {page:u.href,item:match[1]} : null;
    }
    function selection(source, item, episode) {
        if(source==='huarw') {
            if(typeof item!=='string' || !/^\d{1,20}$/.test(item) || typeof episode!=='string'
                || !new RegExp('^'+item+'(?:-\\d{1,5}){1,3}$').test(episode)) return null;
            return {source,item,episode,page:'https://huarw.com/play/'+episode,path:`/discover/play/${source}/${item}/${episode}`};
        }
        if(source==='kanju') {
            if(!publicId(item) || typeof episode!=='string' || !episode.startsWith('ep-') || !publicId(episode.slice(3))) return null;
            return {source,item,episode,page:`https://www.kanju.ai/player/${encodeURIComponent(item)}?episode=${encodeURIComponent(episode.slice(3))}`,
                path:`/discover/play/${source}/${item}/${episode}`};
        }
        if (typeof item!=='string' || typeof episode!=='string' || !/^([1-9]\d{0,4})-([1-9]\d{0,4})$/.test(episode)) return null;
        const [line, number]=episode.split('-');
        const page=source==='233dm' && /^[a-f0-9]{24}$/.test(item) ? `https://www.233dm.com/anime/${item}/play/${line}/${number}.html`
            : source==='pkavi' && /^[1-9]\d{0,19}$/.test(item) ? `https://www.pkavi.com/py/${item}-${line}-${number}.html` : null;
        return page ? {source,item,episode,page,path:`/discover/play/${source}/${item}/${episode}`} : null;
    }
    function fromPage(value) {
        for (const [source, rule] of Object.entries(sources)) {
            if(source==='kanju') {
                const u=urlFor(source,value), d=detail(source,value);
                if(d && u.searchParams.has('episode')) return selection(source,d.item,'ep-'+u.searchParams.get('episode'));
                continue;
            }
            const u=urlFor(source,value), match=u && rule.play.exec(u.pathname);
            if (match) return selection(source,match[1],source==='huarw'?match[1]+match[2]:match[2]+'-'+match[3]);
        }
        return null;
    }
    function request(kind, payload) {
        if (!payload || typeof payload.source!=='string' || !Object.hasOwn(sources,payload.source) || !['search','detail'].includes(kind)) return null;
        const source=payload.source;
        if (kind==='detail') {
            if (Object.keys(payload).some(k=>!['source','page_url'].includes(k))) return null;
            const d=detail(source,payload.page_url);
            return d ? {kind,source,url:d.page,item:d.item} : null;
        }
        if (Object.keys(payload).some(k=>!['source','q'].includes(k)) || typeof payload.q!=='string' || payload.q.length>300) return null;
        const q=text(payload.q.normalize('NFKC'),80);
        const query=source==='kanju' ? 'path=%2Fv1%2Fbrowse%2Fcatalog&q='+encodeURIComponent(q)+'&page=1&limit=12' : 'wd='+encodeURIComponent(q);
        return q ? {kind,source,q,url:`https://${sources[source].host}${sources[source].search}?${query}`} : null;
    }
    function expectedPage(req, value) {
        try {
            if(req.kind==='detail') return detail(req.source,value)?.item===req.item;
            const u=new URL(value), wanted=new URL(req.url);
            return u.origin===wanted.origin && (req.source==='kanju' ? u.pathname===wanted.pathname && u.search===wanted.search
                : req.source==='huarw' ? u.pathname===wanted.pathname && u.search===wanted.search
                : u.pathname.startsWith(req.source==='233dm'?'/search/':'/vs/'));
        } catch {return false;}
    }
    function normalizeResult(req, raw) {
        const result={source_id:req.source,status:'unavailable',cached:false};
        if (req.kind==='search') Object.assign(result,{query:req.q,results:[]});
        else Object.assign(result,{page_url:req.url,item_id:req.item,title:'',description:'',episodes:[],playback_verified:false});
        if (!raw || !['ok','verification_required','access_blocked','no_episodes','unavailable','cancelled','busy'].includes(raw.status)) return result;
        result.status=raw.status;
        if (raw.status !== 'ok') return result;
        const seen=new Set();
        if (req.kind==='search') {
            for (const row of (Array.isArray(raw.results)?raw.results:[]).slice(0,120)) {
                const d=detail(req.source,row?.page_url), title=text(row?.title);
                if (!d || !title || seen.has(d.page) || !req.q.toLowerCase().split(/\s+/).every(t=>title.toLowerCase().includes(t))) continue;
                seen.add(d.page); result.results.push({title,page_url:d.page,source_id:req.source,source_name:sources[req.source].name,
                    kind:'third_party_index',playback_verified:false,synchronization_verified:false,quality:'未核实',access:'以原站为准',
                    poster_url:safePosterUrl(row.poster_url,'https://'+sources[req.source].host),
                    year:/^(19|20)\d{2}$/.test(String(row.year))?String(row.year):null});
                if (result.results.length>=12) break;
            }
        } else {
            result.title=text(raw.title); result.description=text(raw.description,500);
            if(req.source==='kanju') result.selection_scope='loaded_page';
            for (const e of (Array.isArray(raw.episodes)?raw.episodes:[]).slice(0,6000)) {
                const selected=selection(req.source,req.item,e?.id), title=text(e?.title,60);
                if (!selected || !title || seen.has(e.id)) continue;
                seen.add(e.id); result.episodes.push({id:e.id,title,line:req.source==='kanju'?'原站选集':req.source==='huarw'?'原站默认线路':'线路 '+e.id.split('-')[0],launch_path:selected.path});
            }
        }
        return result;
    }
    // Reads visible metadata and public page identities only; no media URLs,
    // account fields, storage, cookies, scripts or captcha controls are read.
    function readDocument(doc, req) {
        if (/attention required|access denied|访问被拒绝/i.test(doc.title)
            && /sorry, you have been blocked|you are unable to access|access denied|访问被拒绝/i.test((doc.body?.textContent||'').slice(0,6000))) return {status:'access_blocked'};
        if (/系统安全验证|安全检查|just a moment|security check|attention required/i.test(doc.title)) return {status:'verification_required'};
        if(req.source==='kanju' && doc.querySelector('input[type="password"]')) return {status:'verification_required'};
        const links=Array.from(doc.querySelectorAll('a[href]')).slice(0,15000);
        if (req.kind==='search') {
            const rows=[];
            const covers=new Map();
            for(const a of links) {
                const d=detail(req.source,a.getAttribute('href'));
                if(!d) continue;
                for(const img of Array.from(a.querySelectorAll?.('img')||[]).slice(0,4)) {
                    const url=['data-original','data-src','data-lazy-src','src'].map(k=>safePosterUrl(img.getAttribute(k),req.url)).find(Boolean);
                    if(url && !covers.has(d.page)) covers.set(d.page,url);
                }
            }
            for (const a of links) {
                const d=detail(req.source,a.getAttribute('href'));
                // Huarw has separate cover/title/play links. Read its title link,
                // not the cover's update badge or the neighbouring film's text.
                const card=req.source==='huarw'?a.closest?.('.search-box'):null;
                if(req.source==='huarw' && !a.closest?.('h3')) continue;
                const year=card?.querySelector('.thumb-else a[href^="/search/year/"]')?.textContent?.trim();
                const title=text(req.source==='kanju' ? (a.getAttribute('aria-label')||'').replace(/^打开播放器[：:]\s*/,'') || a.getAttribute('title') || a.textContent
                    : a.getAttribute('title') || a.textContent);
                if (d && title) rows.push({title,page_url:d.page,poster_url:covers.get(d.page),year});
            }
            const empty=/没有找到|暂无数据|没有相关|暂无相关/.test((doc.body?.textContent||'').slice(0,30000));
            return normalizeResult(req,{status:rows.length||empty?'ok':'unavailable',results:rows});
        }
        if(req.source==='kanju') {
            const episodes=Array.from(doc.querySelectorAll('button[data-directory-episode]')).slice(0,6000)
                .map(el=>({id:'ep-'+el.getAttribute('data-directory-episode'),title:text(el.getAttribute('title')||el.textContent,60)}));
            return normalizeResult(req,{status:episodes.length?'ok':'unavailable',title:doc.querySelector('h1')?.textContent||doc.title,episodes});
        }
        const episodes=[];
        for (const a of links) {
            const u=urlFor(req.source,a.getAttribute('href'));
            const s=u && fromPage(u.href);
            if (!s || s.source!==req.source || s.item!==req.item) continue;
            const label=text(a.textContent,60);
            // Ignore hero "play now" links so real episode labels win.
            if (!label || /立即播放|马上播放/.test(label)) continue;
            episodes.push({id:s.episode,title:label});
        }
        return normalizeResult(req,{status:episodes.length?'ok':'no_episodes',title:doc.querySelector('h1')?.textContent || doc.title,
            description:doc.querySelector('meta[name="description"]')?.getAttribute('content'),episodes});
    }
    // Confirmation uses the original UI's selected episode marker, not just its
    // URL (a page can ignore a query or still be loading the previous episode).
    function episodeReady(doc, episode) {
        if(typeof episode!=='string' || !episode.startsWith('ep-') || !publicId(episode.slice(3))) return false;
        return Array.from(doc.querySelectorAll('button[data-directory-episode]')).some(el=>el.getAttribute('data-directory-episode')===episode.slice(3)
            && (el.classList.contains('movie-button-primary') || el.getAttribute('aria-current')==='true' || el.getAttribute('aria-selected')==='true'));
    }
    return {sources,text,publicId,urlFor,detail,selection,fromPage,request,expectedPage,normalizeResult,readDocument,episodeReady,posterDomains,safePosterUrl};
});
