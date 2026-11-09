/* Bind a native handoff to a live public episode, not an earlier confirmation.
 * All stream observations stay on this device. No private site API or cookies. */
(() => {
    if(window.__twEpisodeMediaGuard)return;
    let target='',blocked=new Set(),fingerprint='',since=0,samples=0;
    const key=p=>p?[p.source,p.item,p.episode].join('|'):'';
    window.__twEpisodeMediaGuard={
        read(program,scan){
            const wanted=key(program);
            if(target!==wanted){target=wanted;blocked=new Set();fingerprint='';samples=0;}
            const data=scan();
            const context=window.TogetherWatchCatalogAdapters?.historyContext(document,location.href);
            const actual=context?.program;
            const matched=wanted!=='' && key(actual)===wanted;
            const busy=program.source==='kanju' && Array.from(document.querySelectorAll('[data-player-busy="true"]')).some(el=>{
                const r=el.getBoundingClientRect();return r.width>0 && r.height>0;
            });
            const visible=(data.candidates||[]).filter(c=>c.visible);
            if(!matched){
                // The old/default episode can remain decoded after the directory
                // has already highlighted the requested episode. Quarantine it.
                (data.candidates||[]).filter(c=>c.visible || c.attached).forEach(c=>blocked.add(c.url));
                (data.playerSources||[]).forEach(url=>blocked.add(url));
                fingerprint='';samples=0;
            }
            const candidates=matched && !busy?visible.filter(c=>!blocked.has(c.url)):[];
            const sources=matched && !busy?(data.playerSources||[]).filter(url=>!blocked.has(url)):[];
            const signature=[...new Set([...candidates.map(c=>c.url),...sources])].sort().join('\n');
            const now=Date.now();
            if(matched && signature && signature===fingerprint)samples++;
            else {fingerprint=signature;since=now;samples=signature?1:0;}
            const settled=matched && samples>=2 && now-since>=1500;
            return {...data,episodeMatched:matched,episodeSettled:settled,episodeContext:matched?context:null,
                candidates:settled?candidates:[],readyBlobPlayers:settled && sources.length===1?data.readyBlobPlayers:0};
        }
    };
})();
