/* Device-local episode identities and timing. Never persist stream URLs or room capabilities. */
(function (root) {
    'use strict';
    const KEY = 'tw_watch_history_v1';
    const sources = new Set(['kanju', 'huarw', 'cupfox', 'blender', 'yhdmoe', '233dm', 'pkavi']);
    const adapters = typeof module === 'object' && module.exports ? require('./catalog-adapters.js') : null;
    function covers(values) {
        const policy = adapters || root.TogetherWatchCatalogAdapters;
        return [...new Set(values.slice(0, 48).map(v => policy?.safePosterUrl(v)).filter(Boolean))].slice(0, 6);
    }
    function posterMetadata(row) {
        const pages = { kanju:'https://www.kanju.ai/player/', huarw:'https://huarw.com/movie/',
            cupfox:'https://www.cupfox.in/vod-detail/', yhdmoe:'https://yhdmoe.com/watch/',
            '233dm':'https://www.233dm.com/anime/', pkavi:'https://www.pkavi.com/mv/', blender:'https://video.blender.org/videos/watch/' };
        if (!identity(row)) return {};
        return {source_id:row.source, page_url:pages[row.source]+encodeURIComponent(row.item)+(['cupfox','233dm','pkavi'].includes(row.source)?'.html':''),
            title:row.title, year:row.year, poster_url:row.poster, poster_candidates:row.poster_candidates};
    }
    function identity(p) {
        if (!p || !sources.has(p.source) || p.exact_episode === false || p.episode === 'page') return '';
        if (![p.item, p.episode].every(v => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,240}$/.test(v) && !v.includes('..'))) return '';
        return [p.source, p.item, p.episode].join(':');
    }
    function createStore(storage, now = Date.now, storageKey = KEY) {
        const empty = () => ({ enabled: true, rows: [], meta: {}, deleted: [] });
        function read() {
            try { const s = JSON.parse(storage.getItem(storageKey)); return s && Array.isArray(s.rows) && s.meta && typeof s.meta==='object' && !Array.isArray(s.meta) && Array.isArray(s.deleted) ? s : empty(); }
            catch { return empty(); }
        }
        function write(s) { try { storage.setItem(storageKey, JSON.stringify(s)); return true; } catch { return false; } }
        function cleanMeta(p, meta = {}) {
            const candidates = covers([meta.poster, ...(Array.isArray(meta.poster_candidates) ? meta.poster_candidates : [])]);
            return { source:p.source, item:p.item, episode:p.episode,
                title:String(meta.title || p.source + ' · 观看记录').slice(0, 160), label:String(meta.label || '上次观看的集数').slice(0, 80),
                poster:candidates[0] || '', poster_candidates:candidates, year:/^(19|20)\d{2}$/.test(String(meta.year)) ? String(meta.year) : '' };
        }
        return {
            enabled: () => read().enabled !== false,
            setEnabled(value) { const s = read(); s.enabled = !!value; return write(s); },
            list: () => read().rows.filter(r => identity(r) && Number.isFinite(r.time)).slice(0, 100),
            metadata(p) { const key = identity(p), s = read(); return s.meta[key] || s.rows.find(r => identity(r) === key) || null; },
            remember(p, meta) {
                const key = identity(p), s = read(); if (!key || s.enabled === false) return;
                const previous = s.meta[key] || s.rows.find(r => identity(r) === key) || {};
                const next = cleanMeta(p, meta), old = cleanMeta(p, previous);
                // Re-opening an episode without artwork must not erase a saved cover.
                next.poster_candidates = covers([...next.poster_candidates, ...old.poster_candidates]);
                next.poster = next.poster_candidates[0] || '';
                if (!meta?.title) next.title = old.title;
                if (!meta?.label) next.label = old.label;
                if (!next.year) next.year = old.year;
                delete s.meta[key]; s.meta[key] = next; s.deleted = s.deleted.filter(k => k !== key);
                for (const old of Object.keys(s.meta).slice(0, -150)) delete s.meta[old]; write(s);
            },
            record(p, sample) {
                const key = identity(p), s = read();
                if (!key || s.enabled === false || s.deleted.includes(key) || !sample?.ready || sample.active === false || sample.seeking
                    || !Number.isFinite(sample.time) || sample.time < 5 || sample.time > 604800) return false;
                const previous = s.rows.find(r => identity(r) === key);
                // A cached final sample is not a new viewing action. Otherwise
                // closing an old room can rewind a newer record from this device.
                const updated = Number.isFinite(sample.observedAt) ? Math.min(now(), sample.observedAt) : now();
                if (updated < 0 || (previous && previous.updated >= updated && Number.isFinite(sample.observedAt))) return false;
                const meta = s.meta[key] || previous || cleanMeta(p, { title:sample.title });
                const row = { ...cleanMeta(p, meta), time:sample.time,
                    duration:Number.isFinite(sample.duration) ? Math.max(0, Math.min(604800, sample.duration)) : 0, updated };
                s.rows = [row, ...s.rows.filter(r => identity(r) !== key)].sort((a,b)=>b.updated-a.updated).slice(0, 100); return write(s);
            },
            remove(p) { const key = identity(p), s = read(); s.rows = s.rows.filter(r => identity(r) !== key); delete s.meta[key]; s.deleted = [...s.deleted.filter(k => k !== key), key].slice(-100); if (s.resume?.key === key) delete s.resume; write(s); },
            clear() { const s = read(); s.deleted = s.rows.map(identity); s.rows = []; s.meta = {}; delete s.resume; write(s); },
            prepare(p) { const s = read(), row = s.rows.find(r => identity(r) === identity(p)); if (!row) return; s.resume = { key:identity(row), time:row.time, expires:now()+120000 }; write(s); },
            takeResume(p, owner, alone) {
                const s = read(), ticket = s.resume;
                if (!ticket || ticket.key !== identity(p)) return null;
                delete s.resume; write(s);
                return owner && alone && ticket.expires > now() && Number.isFinite(ticket.time) ? ticket.time : null;
            },
        };
    }
    const api = { identity, createStore, posterMetadata, KEY };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else {
        try { api.store = createStore(root.localStorage); } catch { api.store = createStore({ getItem() {}, setItem() { throw Error('storage unavailable'); } }); }
        api.localStore = api.store;
        root.TogetherWatchHistory = api;
        root.document.addEventListener('DOMContentLoaded', () => {
            const doc = root.document, dialog = doc.getElementById('watchHistoryDialog'); if (!dialog) return;
            // Preserve old records, but only current server-enabled sources may
            // create a new room. Never launch a retired source through history.
            const available = new Set((dialog.dataset.enabledSources || '').split(',').filter(Boolean));
            const list = doc.getElementById('watchHistoryList'), shelf = doc.getElementById('continueWatching');
            const enabled = doc.getElementById('watchHistoryEnabled');
            const format = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2,'0')}`;
            function render() {
                const account = root.TogetherWatchAccount;
                const hint=doc.getElementById('watchHistoryScope'), clearHint=doc.getElementById('watchHistoryClearScope');
                if(hint)hint.textContent=account?.ready===false ? '正在确认账号状态，暂不改写历史。'+account.status : account?.user ? `账号「${account.user.display_name}」的观看历史 · ${account.status}` : '未登录：记录只在这台设备。登录后可同步到账号；本机记录不会自动上传。';
                if(clearHint)clearHint.textContent=account?.user?'确定清空这个账号在所有设备上的观看历史？':'确定清空这台设备的观看历史？';
                enabled.checked = api.store.enabled(); list.replaceChildren();
                const recent = doc.getElementById('continueWatchingList'); recent?.replaceChildren();
                const rows = api.store.list(); let recentCount = 0;
                const launchPath = row => {
                    const path = `/discover/play/${row.source}/${row.item}/${row.episode}`;
                    return available.has(row.source) && root.TogetherWatchDiscovery?.safeLaunchPath(row.source,row.item,row.episode,path) ? path : '';
                };
                if (shelf) shelf.hidden = !rows.some(launchPath);
                if (!rows.length) list.textContent = '还没有观看记录。播放已确认集数的视频后，会在这里记住进度。';
                for (const row of rows) {
                    function card(removable) {
                        const path = launchPath(row);
                        const article = doc.createElement('article'), link = doc.createElement(path ? 'a' : 'div'); article.className = 'history-card';
                        if (path) { link.href = path; link.addEventListener('click', () => { api.store.remember(row,row); api.store.prepare(row); }); }
                        const art = doc.createElement('div'); art.className = 'history-cover';
                        const metadata = path ? posterMetadata(row) : {};
                        root.TogetherWatchDiscovery?.addPoster(doc,art,path ? row.poster : '',metadata.page_url,row.title,metadata);
                        const title = doc.createElement('strong'); title.textContent = row.title;
                        const info = doc.createElement('small'); info.textContent = `${path ? '' : '来源已移除或未启用 · '}${row.label} · 看到 ${format(row.time)}${row.duration ? ' / '+format(row.duration) : ''}`;
                        link.append(art,title,info); article.append(link);
                        if (removable) { const remove = doc.createElement('button'); remove.type = 'button'; remove.textContent = '删除'; remove.onclick = () => { api.store.remove(row); render(); }; article.append(remove); }
                        return article;
                    }
                    list.append(card(true)); if (launchPath(row) && recentCount++ < 8) recent?.append(card(false));
                }
            }
            for (const button of doc.querySelectorAll('[data-watch-history]')) button.addEventListener('click', () => { render(); dialog.showModal(); });
            doc.getElementById('watchHistoryClose').onclick = () => dialog.close();
            // Android WebView does not provide window.confirm unless the host implements it.
            const confirmation=doc.getElementById('watchHistoryConfirm');
            doc.getElementById('watchHistoryClear').onclick = () => { confirmation.hidden=false; };
            doc.getElementById('watchHistoryConfirmNo').onclick = () => { confirmation.hidden=true; };
            doc.getElementById('watchHistoryConfirmYes').onclick = () => { api.store.clear();confirmation.hidden=true;render(); };
            dialog.addEventListener('close',()=>{confirmation.hidden=true;});
            enabled.onchange = () => api.store.setEnabled(enabled.checked);
            root.addEventListener('storage', e => { if (e.key === KEY) render(); });
            root.addEventListener('tw-account-change',render);
            root.addEventListener('tw-history-change',render);
            root.addEventListener('focus', render); render();
        });
    }
})(globalThis);
