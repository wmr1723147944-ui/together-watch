/* Local WebView player adapter. Same-origin frames only; never access cookies. */
(() => {
    if(window.__twAndroidPage) return;
    let selected=null, selectedSerial=null, session=0;
    const frames=()=>{
        const result=[];let blocked=0;
        const visit=(w,depth)=>{
            if(depth>4 || result.length>=24)return;
            try { void w.document; result.push(w); for(const f of Array.from(w.frames))visit(f,depth+1); } catch {blocked++;}
        };
        visit(window,0);return {windows:result,blocked};
    };
    window.__twAndroidPage={
        sample(install){
            let best=null,failed=0;
            const available=frames();
            for(const w of available.windows)try {
                // The APP supplies a compiled function through evaluateJavascript.
                // Never eval a string inside the page: strict CSP forbids that.
                if(!w.__twDesktopPlayer)install(w);
                const raw=w.__twDesktopPlayer?.sample();
                if(raw && (!best || raw.area>best.raw.area))best={w,raw};
            } catch {failed++;}
            if(!best){
                if(selected){selected=null;selectedSerial=null;session++;}
                return {active:false,reason:failed?'adapter_error':available.blocked?'cross_origin_frame':'no_video'};
            }
            if(selected!==best.w || selectedSerial!==best.raw.serial){selected=best.w;selectedSerial=best.raw.serial;session++;}
            return {...best.raw,active:true,session};
        },
        apply(command){if(selected && command.session===session)selected.__twDesktopPlayer?.apply(command);},
        overlay(packet){if(selected)selected.__twDesktopPlayer?.overlay(packet);},
        currentEpisode(source){
            if(source!=='kanju')return '';
            const rules=window.TogetherWatchCatalogAdapters;
            const ids=Array.from(document.querySelectorAll('button[data-directory-episode]'))
                .map(el=>'ep-'+el.getAttribute('data-directory-episode'))
                .filter(id=>rules?.episodeReady(document,id));
            const unique=[...new Set(ids)];
            return unique.length===1?unique[0]:'';
        },
        confirm(source,episode){
            if(source==='kanju')return window.TogetherWatchCatalogAdapters?.episodeReady(document,episode)===true;
            const sakura=source==='yhdmoe';
            if(!sakura && source!=='cupfox')return false;
            const attr=sakura?'play_ep':'ep_slug', active=sakura?'disabled':'on';
            const el=Array.from(document.querySelectorAll(sakura?'a.my-episode[play_ep]':'span.play-btn[ep_slug]')).find(n=>n.getAttribute(attr)===episode);
            if(!el)return false;
            if(!el.classList.contains(active))el.click();
            return el.classList.contains(active);
        },
        pause(){for(const w of frames().windows)try{w.document.querySelectorAll('video,audio').forEach(v=>v.pause());}catch{}},
    };
})();
