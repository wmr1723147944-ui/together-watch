// Runs only in the trusted TogetherWatch catalogue. Return a public episode
// handoff already present in the list; never manufacture a media/episode URL.
(function nextEpisode(doc, origin, program, expand) {
    if (doc.location.origin !== origin || !['/', '/discover'].includes(doc.location.pathname)) return 'missing';
    const list=doc.getElementById('discoveryEpisodes');
    if (!list || doc.getElementById('discoveryEpisodeFilter')?.value?.trim()) return 'missing';
    const more=doc.getElementById('discoveryEpisodeMore');
    const rows=[];
    for (const a of list.querySelectorAll('a.discovery-episode')) {
        let u; try {u=new URL(a.href);} catch {continue;}
        if (u.origin!==origin || u.username || u.password || u.search || u.hash) continue;
        let path; try {path=u.pathname.split('/').map(decodeURIComponent);} catch {continue;}
        if(path.length!==6 || path[1]!=='discover' || path[2]!=='play'
            || path[3]!==program.source || path[4]!==program.item || !path[5] || path[5].includes('/')) continue;
        const id=path[5];
        const label=a.textContent.replace(/ · 正在看$/, '').trim().split(' · ');
        const title=label.pop();
        const numbered=/^(?:第\s*)?(\d+(?:\.\d+)?)\s*(?:集|话|期|回)?$/i.exec(title)
            || /第\s*(\d+(?:\.\d+)?)\s*[集话期回]/.exec(title);
        let n=numbered ? Number(numbered[1]) : null;
        let line=label.join(' · ');
        if (['pkavi','233dm','huarw'].includes(program.source)) {
            const parts=id.split('-'), ordinal=parts[parts.length-1];line+=':'+parts.slice(0,-1).join('-');
            if(n===null && parts.length>1 && /^\d+$/.test(ordinal))n=Number(ordinal);
        } else if (n===null && ['cupfox','yhdmoe'].includes(program.source) && /^ep\d+(?:\.\d+)?$/i.test(id)) n=Number(id.slice(2));
        rows.push({id,line,n,href:u.href});
    }
    const current=rows.find(r=>r.id===program.episode);
    const partial=more && !more.hidden;
    if (current && current.n!==null) {
        const later=rows.filter(r=>r.line===current.line && r.n!==null && r.n>current.n).sort((a,b)=>a.n-b.n);
        const first=later[0];
        if (first && first.n<=Math.floor(current.n)+1 && (!later[1] || later[1].n!==first.n)
            && rows.filter(r=>r.line===current.line && r.n===current.n).length===1) return first.href;
        if(!partial) return !later.length && rows.every(r=>r.line!==current.line || r.n!==null) ? 'end' : 'ambiguous';
    }
    if(partial && expand){more.click();return 'more';}
    if(!rows.length && !list.querySelector('button'))return 'waiting';
    return 'missing';
})
