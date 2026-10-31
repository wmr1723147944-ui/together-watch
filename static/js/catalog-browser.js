(function () {
    'use strict';
    const shared = typeof module === 'object' && module.exports ? require('./source-discovery.js') : globalThis.TogetherWatchDiscovery;
    const adapters = typeof module === 'object' && module.exports ? require('./catalog-adapters.js') : globalThis.TogetherWatchCatalogAdapters;
    const feedApi = typeof module === 'object' && module.exports ? require('./catalog-feed.js') : globalThis.TogetherWatchFeed;

    // Reconstruct only reviewed detail URLs from public programme identities.
    // Never use a media URL, title search, or a guessed neighbouring episode.
    function episodeRow(program) {
        const {source, item, episode} = program || {};
        if (![source,item,episode].every(v=>typeof v==='string')) return null;
        const path=`/discover/play/${source}/${item}/${episode}`;
        if (!shared.safeLaunchPath(source,item,episode,path)) return null;
        const page = source==='huarw' ? `https://huarw.com/movie/${item}`
            : source==='kanju' ? `https://www.kanju.ai/player/${encodeURIComponent(item)}`
            : source==='233dm' ? `https://www.233dm.com/anime/${item}.html`
            : source==='pkavi' ? `https://www.pkavi.com/mv/${item}.html`
            : source==='cupfox' ? `https://www.cupfox.in/vod-detail/${item}.html`
            : source==='yhdmoe' ? `https://yhdmoe.com/watch/${item}` : null;
        return page && shared.safeResultUrl(source,page)
            ? {title:'当前影片 · 选集',page_url:page,current_episode:episode} : null;
    }

    // Without a year, two equal titles may be remakes. Keep those entries
    // separate rather than silently offering the wrong film to a room owner.
    function groupResults(records, limit = 12) {
        const groups = new Map(), seen = new Set();
        for (const record of records) for (const row of (record.rows || []).slice(0, limit)) {
            if (!row || typeof row.title !== 'string') continue;
            const page = shared.safeResultUrl(record.source, row.page_url);
            const title = row.title.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 160);
            if (!page || !title || seen.has(record.source + ':' + page)) continue;
            seen.add(record.source + ':' + page);
            const year = /^(19|20)\d{2}$/.test(String(row.year)) ? String(row.year) : '';
            const key = year ? title.toLowerCase() + '|' + year : record.source + ':' + page;
            const poster = adapters?.safePosterUrl(row.poster_url, page) || '';
            if (!groups.has(key)) groups.set(key, { key, title, year, poster, choices: [] });
            const group = groups.get(key);
            if (!group.poster && poster) group.poster = poster;
            group.choices.push({ source: record.source, name: record.name, row: { ...row, title, page_url: page } });
        }
        return [...groups.values()];
    }

    function createBrowser(doc, fetcher = globalThis.fetch) {
        const $ = id => doc.getElementById(id), root = $('sourceDiscovery');
        if (!root || root.dataset.catalogMode !== 'films') return null;
        const query = $('discoveryQuery'), welcome = $('discoveryWelcome'), live = $('discoveryLive');
        const results = $('discoveryLiveResults'), status = $('discoveryLiveStatus'), details = shared.createDetails(doc, fetcher);
        const sources = [...root.querySelectorAll('[data-live-source]')];
        const picker=doc.body?.classList?.contains('episode-picker')===true;
        let pickerClosed=false;
        let generation = 0, records = [], activeQuery = '', completed = 0, pending = 0, groupCount = 0, sourceCount = 0;
        const controllers = new Set(), cards = new Map(), retries = new Set();
        const feed = picker ? null : feedApi?.createFeed(doc, fetcher, { groupResults, addPoster: shared.addPoster, registerPosters:shared.registerPosters, openGroup });
        if(picker) {
            $('episodePickerCancel').onclick=()=>{pickerClosed=true;};
            // dialog.close events can be delayed by a background WebView.
            // Record the user's close action synchronously for native hosts.
            $('discoveryDetailClose').addEventListener('click',()=>{pickerClosed=true;});
            $('discoveryDetail').addEventListener('close',()=>{pickerClosed=true;});
            $('discoveryDetail').addEventListener('cancel',()=>{pickerClosed=true;});
            $('discoveryDetailClose').textContent='关闭选集 ×';
        }
        function el(tag, text, className) {
            const node = doc.createElement(tag);
            if (text != null) node.textContent = text;
            if (className) node.className = className;
            return node;
        }
        function stop() {
            generation++;
            for (const controller of controllers) controller.abort();
            controllers.clear(); retries.clear(); details.close();
        }
        function home(focusQuery = true) {
            stop(); query.value = ''; activeQuery = ''; records = []; cards.clear(); results.replaceChildren();
            welcome.hidden = false; live.hidden = true; $('discoveryClear').hidden = true;
            live.setAttribute('aria-busy', 'false'); if (focusQuery) query.focus();
            feed?.setVisible(true);
        }
        // Native clients keep this document alive while a film is playing.
        // Back dismisses one layer; it must never start another search.
        function back() {
            if ($('watchHistoryDialog')?.open) { $('watchHistoryDialog').close(); return true; }
            if ($('discoveryDetail')?.open) { if(picker)pickerClosed=true;details.close(); return true; }
            if (activeQuery) { home(); return true; }
            return false;
        }
        function episodes(program) {
            const row=episodeRow(program);
            const source=sources.find(s=>s.dataset.liveSource===program?.source && s.checked!==false);
            if (!row || !source) return false;
            if(picker){pickerClosed=false;$('episodePickerLoading').hidden=true;}
            // A retained search result may provide artwork/title. Keep the search
            // and its scroll position; opening/closing this dialog is one layer.
            const known=records.find(r=>r.source===program.source)?.rows?.find(r=>r.page_url===row.page_url);
            const choice={source:program.source,name:source.dataset.sourceName||program.source,row:{...known,...row,title:known?.title||row.title}};
            openGroup({title:choice.row.title,year:known?.year||'',poster:known?.poster_url||'',choices:[choice]},null);
            return true;
        }
        function openGroup(group, trigger, fromFeed = false) {
            $('discoveryDetail')?.setAttribute('data-playing',String(!!group.choices[0].row.current_episode));
            const otherSources = $('catalogFindOtherSources');
            if (otherSources) {
                otherSources.hidden = !fromFeed;
                otherSources.onclick = () => { details.close(); query.value = group.title; run(); root.scrollIntoView?.({ block: 'start' }); };
            }
            const choices = $('catalogSourceChoices'); choices.replaceChildren();
            $('catalogDetailFacts').textContent = group.choices[0].row.current_episode ? '正在观看 · 房间保持连接' : (group.year || '年份待核对') + ' · ' + group.choices.length + ' 个条目';
            const poster = $('catalogDetailPoster'); poster.replaceChildren();
            shared.addPoster(doc, poster, group.poster, group.choices[0].row.page_url, group.title,group);
            const buttons = [];
            function select(choice, button) {
                for (const item of buttons) item.setAttribute('aria-pressed', String(item === button));
                details.open(choice.source, choice.row, trigger);
            }
            for (const choice of group.choices) {
                const button = el('button', choice.name || choice.source);
                button.dataset.source = choice.source;
                button.type = 'button'; button.setAttribute('aria-pressed', 'false');
                button.addEventListener('click', () => select(choice, button));
                buttons.push(button); choices.append(button);
            }
            select(group.choices[0], buttons[0]);
        }
        function render() {
            const groups = groupResults(records); groupCount = groups.length;
            for (const group of groups) {
                shared.registerPosters(doc,group);
                let entry = cards.get(group.key);
                if (!entry) {
                    const card = el('article', null, 'catalog-film discovery-title-card');
                    const cover = el('button', null, 'catalog-film-poster discovery-title-art'); cover.type = 'button';
                    cover.setAttribute('aria-label', '查看 ' + group.title + ' 的来源和集数');
                    shared.addPoster(doc, cover, group.poster, group.choices[0].row.page_url, group.title,group);
                    cover.append(el('span', '查看来源 / 选集 →', 'catalog-hover-action'));
                    const title = el('button', group.title, 'catalog-title'); title.type = 'button';
                    const facts = el('p'); card.append(cover, title, facts); results.append(card);
                    entry = { card, cover, title, facts, group, poster: group.poster }; cards.set(group.key, entry);
                    cover.addEventListener('click', () => openGroup(entry.group, cover));
                    title.addEventListener('click', () => openGroup(entry.group, title));
                }
                entry.group = group;
                if (!entry.poster && group.poster) {
                    entry.cover.replaceChildren();
                    shared.addPoster(doc, entry.cover, group.poster, group.choices[0].row.page_url, group.title,group);
                    entry.cover.append(el('span', '查看来源 / 选集 →', 'catalog-hover-action')); entry.poster = group.poster;
                }
                entry.facts.textContent = (group.year || '年份待核对') + ' · ' + group.choices.length + ' 个来源条目';
            }
            progress();
        }
        function progress() {
            $('catalogResultCount').textContent = groupCount + ' 部影片';
            status.textContent = pending ? `正在搜索“${activeQuery}”… 已完成 ${completed} / ${sourceCount} 项查询，找到的影片会先显示。`
                : groupCount ? `找到 ${groupCount} 部影片。点封面选择来源和集数；搜索结果不等于已验证可播放。`
                : sourceCount ? '本次没有获得匹配影片，可换个关键词再试。' : '自动搜索暂未开放，请稍后再试。';
            live.setAttribute('aria-busy', String(pending > 0));
            $('catalogSkeleton').hidden = !pending || groupCount > 0;
            $('catalogEmpty').hidden = pending > 0 || groupCount > 0;
            for (const button of retries) button.disabled = pending > 0;
        }
        async function searchSource(source, current, interactive = false, notice = null) {
            const id = source.dataset.liveSource, name = source.dataset.sourceName || id;
            const controller = new AbortController(); controllers.add(controller);
            const timer = setTimeout(() => controller.abort(), shared.metadataTimeout(id,interactive));
            function note(message, retryMode = null, allowOriginal = false, inspect = false) {
                const row = notice || el('div', null, 'catalog-query-note'); row.replaceChildren();
                row.append(el('span', name + '：' + message));
                if (retryMode) {
                    const button = el('button', retryMode==='verify'?'打开原站，手动验证':retryMode==='inspect'?'打开原站并重试':'重试此来源'); button.type = 'button'; retries.add(button);
                    button.disabled = pending > 0;
                    button.addEventListener('click', async () => {
                        if (current !== generation || pending) return;
                        retries.delete(button);
                        pending++; completed--; progress();
                        row.replaceChildren(el('span', name + (retryMode==='verify'?'：请在原站手动完成验证；若验证码不显示或无法通过，可关闭窗口并换来源。':retryMode==='inspect'?'：正在打开原站查询，完成后结果会回到这里…':'：正在重试…')));
                        await searchSource(source, current, retryMode!=='retry', row);
                    }); row.append(button);
                }
                if(inspect) {
                    const button=el('button','打开原站检查');button.type='button';retries.add(button);button.disabled=pending>0;
                    button.addEventListener('click',async()=>{
                        if(current!==generation || pending)return;
                        retries.delete(button);pending++;completed--;progress();
                        row.replaceChildren(el('span',name+'：正在打开原站…'));
                        await searchSource(source,current,true,row);
                    });row.append(button);
                }
                if (allowOriginal && !shared.nativeMetadata(id)) {
                    const url = shared.originalSearch(id, activeQuery);
                    if (url) {
                        const link = el('a', '在原站继续搜索');
                        link.href = url; link.target = '_self'; link.rel = 'noreferrer';
                        row.append(link);
                    }
                }
                if (!notice) $('catalogSearchNotesBody').append(row);
                $('catalogSearchNotes').hidden = false;
            }
            try {
                const response = await shared.metadataRequest('search', { source: id, q: activeQuery }, fetcher, controller.signal, interactive);
                if (current !== generation) return;
                if (!response.ok) throw new Error(response.status === 429 ? 'rate' : 'unavailable');
                const data = await response.json();
                if (current !== generation) return;
                if (data.source_id !== id) throw new Error('invalid');
                if (data.status === 'verification_required') { note('原站要求手动验证；若验证码无法显示或通过，请换一个来源。', shared.nativeMetadata(id)?'verify':null, true); return; }
                if (data.status === 'access_blocked') { note('原站拒绝了本次访问，不是普通验证码；请换一个来源。'); return; }
                if (data.status === 'cancelled') { note('已取消原站查询，其他结果不受影响。', 'retry', true); return; }
                if (data.status === 'client_required') { note('当前环境尚不支持此项查询，其他结果不受影响。', false, true); return; }
                if (data.status !== 'ok' || !Array.isArray(data.results)) throw new Error('unavailable');
                records = records.filter(item => item.source !== id);
                records.push({ source: id, name, rows: data.results });
                if (notice) notice.replaceChildren(el('span', name + '：已完成，结果已合入上方影片。'));
                render();
            } catch (error) {
                if (current === generation) note(error.message === 'rate' ? '查询较频繁，请稍后重试。' : '连接超时或页面未能读取，不代表没有这部影片；可以重试或换个来源。',
                    'retry', true, error.message!=='rate' && shared.nativeMetadata(id));
            } finally {
                clearTimeout(timer); controllers.delete(controller);
                if (current === generation) { pending--; completed++; progress(); }
            }
        }
        async function run() {
            const value = shared.normalizeQuery(query.value);
            if (!value) { home(); return; }
            stop(); activeQuery = value; query.value = value; const current = generation;
            feed?.setVisible(false);
            const queue = sources.filter(source => source.checked !== false);
            records = []; cards.clear(); results.replaceChildren(); groupCount = 0; completed = 0; pending = sourceCount = queue.length;
            welcome.hidden = true; live.hidden = false; $('discoveryClear').hidden = false;
            $('catalogSearchNotes').hidden = true; $('catalogSearchNotes').open = false; $('catalogSearchNotesBody').replaceChildren();
            $('catalogResultTitle').textContent = '“' + value + '”的搜索结果'; progress();
            async function worker() { while (current === generation && queue.length) await searchSource(queue.shift(), current); }
            await Promise.all([worker(), worker()]);
        }
        $('discoveryForm').addEventListener('submit', event => { event.preventDefault(); run(); });
        $('discoveryClear').addEventListener('click', home); $('catalogBack').addEventListener('click', home);
        query.addEventListener('input', () => { $('discoveryClear').hidden = !query.value; });
        for (const button of root.querySelectorAll('[data-discovery-query]')) button.addEventListener('click', () => {
            query.value = button.dataset.discoveryQuery; run(); root.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        });
        for (const button of root.querySelectorAll('[data-catalog-category]')) button.addEventListener('click', () => {
            const category = button.dataset.catalogCategory;
            if (activeQuery) home(false);
            for (const tab of root.querySelectorAll('[data-catalog-category]')) tab.setAttribute('aria-pressed', String(tab.dataset.catalogCategory === category));
            $('recommendationTitle').textContent = category === 'all' ? '发现更多好片' : (button.dataset.categoryLabel || button.textContent.trim()) + '片单';
            feed?.reset(category);
            doc.defaultView?.scrollTo?.({top:0,behavior:'instant'});
        });
        for (const img of root.querySelectorAll('.catalog-film-poster img, .catalog-hero-image')) {
            const failed = () => { img.hidden = true; };
            img.addEventListener('error', failed); if (img.complete && !img.naturalWidth) failed();
        }
        if (!picker) {if (shared.normalizeQuery(query.value)) run(); else feed?.setVisible(true);}
        const navigation = { back, home, episodes, pickerClosed:()=>pickerClosed };
        if (doc.defaultView) doc.defaultView.TogetherWatchCatalogNavigation = navigation;
        return { run, home, back, episodes, cancel: stop };
    }
    if (typeof module === 'object' && module.exports) module.exports = { groupResults, createBrowser, episodeRow };
    else document.addEventListener('DOMContentLoaded', () => createBrowser(document));
})();
