(function (root) {
    'use strict';
    const DURATION = 8, LANES = 6;
    function clean(item) {
        if (!item || !Number.isFinite(item.time) || item.time < 0 || item.time > 604800 || typeof item.text !== 'string') return null;
        const text = item.text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
        return text ? {id:String(item.id || '').slice(0,80),text,time:item.time,kind:item.kind === 'room' ? 'room' : 'public'} : null;
    }
    class Timeline {
        constructor() { this.items = []; }
        set(publicItems, roomItems, options = {}) {
            const offset = Math.max(-600, Math.min(600, Number(options.offset) || 0));
            const rows = [...(options.public === false ? [] : publicItems.slice(0,10000).map(r => ({...r,time:r.time+offset}))),
                ...(options.room === false ? [] : roomItems.slice(-300))].map(clean).filter(Boolean);
            const seen = new Set(), free = Array(LANES).fill(-Infinity);
            this.items = [];
            rows.sort((a,b) => a.time-b.time || (a.kind==='room'?-1:1));
            for (const item of rows) {
                const key = item.kind+':'+item.id+':'+item.time+':'+item.text;
                if (seen.has(key)) continue; seen.add(key);
                // Keep space for friends even when a public episode is crowded.
                const start = item.kind === 'room' ? (options.public === false ? 0 : 4) : 0;
                const end = item.kind === 'room' || options.room === false ? LANES : 4;
                const lane = free.findIndex((until, index) => index >= start && index < end && until <= item.time);
                if (lane < 0) continue; // Bound density instead of overlapping unreadable text.
                free[lane] = item.time + DURATION;
                this.items.push({...item,lane});
            }
        }
        at(time) {
            let low=0,high=this.items.length;
            while(low<high){const mid=(low+high)>>1;if(this.items[mid].time<=time-DURATION)low=mid+1;else high=mid;}
            const found=[];
            for(let i=low;i<this.items.length && this.items[i].time<=time;i++)found.push(this.items[i]);
            return found.slice(0,LANES);
        }
    }
    const api={Timeline,clean,DURATION,LANES};
    if (typeof module==='object' && module.exports) module.exports=api;
    else root.TogetherWatchDanmaku=api;
})(globalThis);
