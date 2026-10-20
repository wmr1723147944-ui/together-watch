/* Local WebView player adapter. Same-origin frames only; never access cookies. */
(() => {
    if(window.__twAndroidPage) return;
    let selected=null, selectedSerial=null, session=0;
    const frames=()=>{
        const result=[];
        const visit=(w,depth)=>{
            if(depth>4 || result.length>=24)return;
            try { void w.document; result.push(w); for(const f of Array.from(w.frames))visit(f,depth+1); } catch {}
        };
        visit(window,0);return result;
    };
    window.__twAndroidPage={
        sample(agent){
            let best=null;
            for(const w of frames())try {
                if(!w.__twDesktopPlayer)w.eval(agent);
                const raw=w.__twDesktopPlayer?.sample();
                if(raw && (!best || raw.area>best.raw.area))best={w,raw};
            } catch {}
            if(!best)return {active:false};
            if(selected!==best.w || selectedSerial!==best.raw.serial){selected=best.w;selectedSerial=best.raw.serial;session++;}
            return {...best.raw,active:true,session};
        },
        apply(command){if(selected && command.session===session)selected.__twDesktopPlayer?.apply(command);},
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
        pause(){for(const w of frames())try{w.document.querySelectorAll('video,audio').forEach(v=>v.pause());}catch{}},
    };
})();
