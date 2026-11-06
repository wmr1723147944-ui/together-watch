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

    // Ignore typography, never season/part/edition words. Unknown years can
    // join an unambiguous title; conflicting known remake years stay separate.
    function filmKey(title) {
        const digits={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
        return String(title || '').normalize('NFKC').toLowerCase().replace(/[\s\u200b-\u200d\ufeff·•:._\-—]+/g, '')
            .replace(/第([一二两三四五六七八九十\d]+)(季|部)/g,(all,n,unit)=>{
                if(!/^(?:\d+|[一二两三四五六七八九]|[一二两三四五六七八九]?十[一二两三四五六七八九]?)$/.test(n))return all;
                const parts=n.split('十'),number=/^\d+$/.test(n)?Number(n):parts.length===2?(digits[parts[0]]||1)*10+(digits[parts[1]]||0):digits[n];
                return number?'第'+number+unit:all;
            });
    }
    function groupResults(records, limit = 12) {
        const groups = new Map(), seen = new Set(), titles = new Map(), entries = [];
        for (const record of records) for (const row of (record.rows || []).slice(0, limit)) {
            if (!row || typeof row.title !== 'string') continue;
            const page = shared.safeResultUrl(record.source, row.page_url);
            const title = row.title.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 160);
            if (!page || !title || seen.has(record.source + ':' + page)) continue;
            seen.add(record.source + ':' + page);
            const year = /^(19|20)\d{2}$/.test(String(row.year)) ? String(row.year) : '';
            const identity = filmKey(title); if (!identity) continue;
            if (!titles.has(identity)) titles.set(identity, new Set());
            if (year) titles.get(identity).add(year);
            entries.push({ record, row, page, title, year, identity });
        }
        for (const {record,row,page,title,year,identity} of entries) {
            const years = titles.get(identity);
            const groupYear = year || (years.size === 1 ? [...years][0] : '');
            const key = identity + '|' + groupYear;
            const poster = adapters?.safePosterUrl(row.poster_url, page) || '';
            if (!groups.has(key)) groups.set(key, { key, title, year:groupYear, poster, choices: [] });
            const group = groups.get(key);
            if (!group.poster && poster) group.poster = poster;
            group.choices.push({ source: record.source, name: record.name, row: { ...row, title, page_url: page } });
        }
        return [...groups.values()];
    }

    function createBrowser(doc, fetcher = globalThis.fetch, {retryDelays=[1500,4000]} = {}) {
        const $ = id => doc.getElementById(id), root = $('sourceDiscovery');
        if (!root || root.dataset.catalogMode !== 'films') return null;
        const query = $('discoveryQuery'), welcome = $('discoveryWelcome'), live = $('discoveryLive');
        const results = $('discoveryLiveResults'), status = $('discoveryLiveStatus'), details = shared.createDetails(doc, fetcher, {onLoaded: detailLoaded});
        const sources = [...root.querySelectorAll('[data-live-source]')];
        const picker=doc.body?.classList?.contains('episode-picker')===true;
        let pickerClosed=false;
        let generation = 0, records = [], activeQuery = '', completed = 0, pending = 0, groupCount = 0, sourceCount = 0;
        const controllers = new Set(), cards = new Map(), retries = new Set();
        let sourceContext = null, sourceEpoch = 0;
        const sourceControllers = new Set();
        function cancelSourceSearch() {
            sourceEpoch++;
            for (const controller of sourceControllers) controller.abort();
            sourceControllers.clear();
            if ($('catalogFindOtherSources')) $('catalogFindOtherSources').disabled=false;
        }
        $('discoveryDetail')?.addEventListener('close',cancelSourceSearch);
        $('discoveryDetailClose')?.addEventListener('click',cancelSourceSearch);
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
            cancelSourceSearch();
            generation++;
            pending=0;sourceContext=null;
            for (const controller of controllers) controller.abort();
            for (const button of retries) button.disabled=true;
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
            const saved=globalThis.TogetherWatchHistory?.store?.metadata(program);
            const choice={source:program.source,name:source.dataset.sourceName||program.source,row:{...known,...row,title:known?.title||saved?.title||row.title,year:known?.year||saved?.year||''}};
            const matching=known && groupResults(records,24).find(g=>g.choices.some(c=>c.source===program.source && c.row.page_url===row.page_url));
            openGroup({title:choice.row.title,year:choice.row.year,poster:known?.poster_url||saved?.poster||'',choices:[choice,...(matching?.choices||[]).filter(c=>c.source!==program.source || c.row.page_url!==row.page_url)]},null);
            return true;
        }
        function detailLoaded(info) {
            const context=sourceContext;
            if (!context || info.source!==context.selected.source || info.page!==context.selected.row.page_url) return;
            if (context.selected.row.current_episode) {
                context.episodeLabel=info.currentTitle||context.episodeLabel;
                if (info.title && context.group.title==='当前影片 · 选集') {
                    context.group.title=info.title;
                    if ($('catalogSourceQuery') && !$('catalogSourceQuery').value) $('catalogSourceQuery').value=info.title;
                }
                if ($('catalogDetailFacts')) $('catalogDetailFacts').textContent='正在观看'+(context.episodeLabel?' · '+context.episodeLabel:'')+' · 换源后请确认对应集数';
            }
            maybeFindSources();
        }
        function maybeFindSources() {
            const context=sourceContext;
            if(!context || context.autoStarted || !$('discoveryDetail')?.open || pending>0 || !$('catalogSourceQuery')?.value)return;
            if(!picker && !context.fromFeed && filmKey(activeQuery)===filmKey(context.group.title))return;
            if(picker && globalThis.twSourceMetadata && globalThis.twSourceMetadata.supportsSourceSwitch!==true)return;
            context.autoStarted=true;findOtherSources();
        }
        function sourceButtons() {
            const context=sourceContext; if(!context)return;
            const choices=$('catalogSourceChoices');choices.replaceChildren();
            const counts=new Map();
            for(const choice of context.group.choices) {
                const ordinal=(counts.get(choice.source)||0)+1;counts.set(choice.source,ordinal);
                const button=el('button',(choice.name||choice.source)+(ordinal>1?' · 条目 '+ordinal:''));
                button.dataset.source=choice.source;button.type='button';
                button.setAttribute('aria-pressed',String(choice===context.selected));
                button.addEventListener('click',()=>{
                    if(sourceContext!==context)return;
                    context.selected=choice;sourceButtons();
                    if($('catalogSourceStatus')) $('catalogSourceStatus').textContent=context.playing?'选择下方集数才会切换来源；房间保持连接。':'';
                    details.open(choice.source,{...choice.row,in_room:context.playing,suggested_episode:context.episodeLabel},context.trigger);
                });
                choices.append(button);
            }
            detailFacts();
        }
        function detailFacts() {
            const context=sourceContext;
            if(!context || context.playing || !$('catalogDetailFacts'))return;
            $('catalogDetailFacts').textContent=(context.group.year||'年份待核对')+' · '+context.group.choices.length+' 个来源条目'+(pending?' · 正在自动补齐来源':'');
        }
        async function findOtherSources(interactiveSource=null) {
            const context=sourceContext, input=$('catalogSourceQuery'), note=$('catalogSourceStatus');
            if(!context || !input || !note)return;
            if(picker && globalThis.twSourceMetadata && globalThis.twSourceMetadata.supportsSourceSwitch!==true) {
                note.textContent='播放中换源需要 Windows 0.6.23 / 安卓 0.3.27。旧版仍可选集，或返回找片页更换来源。';return;
            }
            const needle=shared.normalizeQuery(input.value);
            if(!needle){note.textContent='请输入完整片名，再查找其他来源。';input.focus();return;}
            cancelSourceSearch();context.autoStarted=true;const epoch=sourceEpoch;
            const queue=sources.filter(s=>s.checked!==false && (interactiveSource?s.dataset.liveSource===interactiveSource:true));
            const local=queue.filter(s=>shared.nativeMetadata(s.dataset.liveSource)), remote=queue.filter(s=>!local.includes(s));
            let finished=0;const issues=[];
            const alive=()=>sourceContext===context && epoch===sourceEpoch;
            $('catalogFindOtherSources').disabled=true;
            function report() {
                if(!alive())return;
                note.replaceChildren(el('span',finished<queue.length?`正在查找其他来源 ${finished} / ${queue.length}，找到后可直接选择。`:
                    `已列出 ${context.group.choices.length} 个来源条目。只合并同名影片，请核对版本与集数。`));
                for(const issue of issues) {
                    const label=el('span',issue.name+(issue.verify?'：需要本人验证。':'：暂未取得同名结果。'));note.append(label);
                    if(issue.verify && shared.nativeMetadata(issue.id)) {
                        const button=el('button','验证并重试');button.type='button';button.disabled=finished<queue.length;
                        button.addEventListener('click',()=>{if(alive())findOtherSources(issue.id);});note.append(button);
                    }
                }
            }
            report();
            async function read(source) {
                const id=source.dataset.liveSource,name=source.dataset.sourceName||id,controller=new AbortController();sourceControllers.add(controller);
                const timer=setTimeout(()=>controller.abort(),shared.metadataTimeout(id,!!interactiveSource)+(shared.nativeMetadata(id)?60000:0));let matched=false;
                function receive(data) {
                    if(!alive() || controller.signal.aborted || data?.source_id!==id || data.status!=='ok' || !Array.isArray(data.results))return;
                    const groups=groupResults([{source:id,name,rows:data.results}]);
                    for(const group of groups) {
                        if(filmKey(group.title)!==filmKey(needle) || (context.group.year && group.year && context.group.year!==group.year))continue;
                        matched=true;
                        for(const choice of group.choices)if(!context.group.choices.some(c=>c.source===choice.source && c.row.page_url===choice.row.page_url)) context.group.choices.push(choice);
                        // Exact-title follow-up results also enrich the original
                        // search card, not just this temporary detail panel.
                        if(activeQuery && !context.playing && !context.fromFeed) {
                            let record=records.find(r=>r.source===id);
                            if(!record){record={source:id,name,rows:[]};records.push(record);}
                            for(const choice of group.choices)if(record.rows.length<24 && !record.rows.some(r=>r.page_url===choice.row.page_url))record.rows.push(choice.row);
                        }
                    }
                    sourceButtons();
                    if(matched && activeQuery && !context.playing && !context.fromFeed)render();
                }
                try {
                    const response=await shared.metadataRequest('search',{source:id,q:needle},fetcher,controller.signal,!!interactiveSource,receive);
                    if(!alive())return;
                    if(!response.ok)throw Error('unavailable');
                    const data=await response.json();if(!alive())return;
                    receive(data);
                    if(!matched)issues.push({id,name,verify:data.source_id===id && data.status==='verification_required'});
                } catch {if(alive())issues.push({id,name});}
                finally {clearTimeout(timer);sourceControllers.delete(controller);if(alive()){finished++;report();}}
            }
            async function worker(lane){while(alive() && lane.length)await read(lane.shift());}
            await Promise.all([worker(local),worker(local),worker(remote),worker(remote)]);
            if(alive())$('catalogFindOtherSources').disabled=false;
        }
        function openGroup(group, trigger, fromFeed = false) {
            cancelSourceSearch();
            sourceContext={group:{...group,choices:[...group.choices]},selected:group.choices[0],trigger,fromFeed,autoStarted:false,playing:!!group.choices[0].row.current_episode,episodeLabel:''};
            $('discoveryDetail')?.setAttribute('data-playing',String(sourceContext.playing));
            const otherSources = $('catalogFindOtherSources');
            if (otherSources) {
                otherSources.hidden = false;otherSources.disabled=false;
                otherSources.onclick = () => findOtherSources();
            }
            if($('catalogSourceQuery')) $('catalogSourceQuery').value=group.title==='当前影片 · 选集'?'':group.title;
            if($('catalogSourceStatus')) $('catalogSourceStatus').replaceChildren();
            $('catalogDetailFacts').textContent = group.choices[0].row.current_episode ? '正在观看 · 房间保持连接' : (group.year || '年份待核对') + ' · ' + group.choices.length + ' 个条目';
            const poster = $('catalogDetailPoster'); poster.replaceChildren();
            shared.addPoster(doc, poster, group.poster, group.choices[0].row.page_url, group.title,group);
            sourceButtons();
            details.open(group.choices[0].source,group.choices[0].row,trigger);
            maybeFindSources();
        }
        function render() {
            const groups = groupResults(records,24); groupCount = groups.length;
            const nextCards=new Map(), used=new Set();
            for (const group of groups) {
                shared.registerPosters(doc,group);
                const identities=new Set(group.choices.map(c=>c.source+':'+c.row.page_url));
                let entry=[...cards.values()].find(e=>!used.has(e)
                    && e.group.choices.some(c=>identities.has(c.source+':'+c.row.page_url)));
                if (!entry) {
                    const card = el('article', null, 'catalog-film discovery-title-card');
                    const cover = el('button', null, 'catalog-film-poster discovery-title-art'); cover.type = 'button';
                    cover.setAttribute('aria-label', '查看 ' + group.title + ' 的来源和集数');
                    shared.addPoster(doc, cover, group.poster, group.choices[0].row.page_url, group.title,group);
                    cover.append(el('span', '查看来源 / 选集 →', 'catalog-hover-action'));
                    const title = el('button', group.title, 'catalog-title'); title.type = 'button';
                    const facts = el('p'); card.append(cover, title, facts); results.append(card);
                    entry = { card, cover, title, facts, group, poster: group.poster };
                    cover.addEventListener('click', () => openGroup(entry.group, cover));
                    title.addEventListener('click', () => openGroup(entry.group, title));
                }
                entry.group = group;
                used.add(entry);nextCards.set(group.key,entry);
                entry.title.textContent=group.title;
                entry.cover.setAttribute('aria-label','查看 '+group.title+' 的来源和集数');
                if (!entry.poster && group.poster) {
                    entry.cover.replaceChildren();
                    shared.addPoster(doc, entry.cover, group.poster, group.choices[0].row.page_url, group.title,group);
                    entry.cover.append(el('span', '查看来源 / 选集 →', 'catalog-hover-action')); entry.poster = group.poster;
                }
                entry.facts.textContent = (group.year || '年份待核对') + ' · ' + group.choices.length + ' 个来源条目';
            }
            for(const entry of cards.values())if(!used.has(entry))entry.card.remove();
            cards.clear();for(const [key,entry] of nextCards)cards.set(key,entry);
            const context=sourceContext;
            if(context && $('discoveryDetail')?.open && !context.playing && !context.fromFeed) {
                const match=groups.find(g=>g.choices.some(c=>c.source===context.selected.source && c.row.page_url===context.selected.row.page_url));
                if(match) {
                    const selected=match.choices.find(c=>c.source===context.selected.source && c.row.page_url===context.selected.row.page_url);
                    context.group=match;context.selected=selected;
                    sourceButtons();
                }
            }
            progress();
        }
        function progress() {
            detailFacts();
            $('catalogResultCount').textContent = groupCount + ' 部影片';
            status.textContent = pending ? (groupCount ? `已找到 ${groupCount} 部，可以直接选片 · 仍在搜索 ${pending} 个来源（已完成 ${completed} / ${sourceCount}）。`
                : `正在搜索“${activeQuery}”… 已完成 ${completed} / ${sourceCount} 个来源，找到后会立即显示。`)
                : groupCount ? `找到 ${groupCount} 部影片。点封面选择来源和集数；搜索结果不等于已验证可播放。`
                : sourceCount ? '本次没有获得匹配影片，可换个关键词再试。' : '自动搜索暂未开放，请稍后再试。';
            live.setAttribute('aria-busy', String(pending > 0));
            $('catalogSkeleton').hidden = !pending || groupCount > 0;
            $('catalogEmpty').hidden = pending > 0 || groupCount > 0;
            for (const button of retries) button.disabled = pending > 0;
            if(!pending)maybeFindSources();
        }
        async function searchSource(source, current, interactive = false, notice = null, attempt = 0) {
            const id = source.dataset.liveSource, name = source.dataset.sourceName || id;
            const controller = new AbortController(); controllers.add(controller);
            // A queued search may yield to a slow detail reader, then resume.
            const timer = setTimeout(() => controller.abort(), shared.metadataTimeout(id,interactive)+(shared.nativeMetadata(id)&&!interactive?60000:0));
            let repeat=false;
            function receive(data) {
                if(current!==generation || controller.signal.aborted || data?.source_id!==id || data.status!=='ok' || !Array.isArray(data.results))return;
                let record=records.find(item=>item.source===id);
                if(!record){record={source:id,name,rows:[]};records.push(record);}
                // Preserve arrival order and prior rows when a dynamic page sends
                // an incomplete later snapshot. Replace metadata, not DOM cards.
                for(const row of data.results.slice(0,12)) {
                    const page=shared.safeResultUrl(id,row?.page_url);if(!page || typeof row.title!=='string')continue;
                    const index=record.rows.findIndex(old=>old.page_url===page);
                    if(index<0){if(record.rows.length<12)record.rows.push(row);}
                    else {const old=record.rows[index];record.rows[index]={...old,...row,year:row.year||old.year,poster_url:row.poster_url||old.poster_url};}
                }
                render();
            }
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
                const response = await shared.metadataRequest('search', { source: id, q: activeQuery }, fetcher, controller.signal, interactive,receive);
                if (current !== generation) return;
                if (!response.ok) throw new Error(response.status === 429 ? 'rate' : 'unavailable');
                const data = await response.json();
                if (current !== generation) return;
                if (data.source_id !== id) throw new Error('invalid');
                if (data.status === 'verification_required') { note('原站要求手动验证；若验证码无法显示或通过，请换一个来源。', shared.nativeMetadata(id)?'verify':null, true); return; }
                if (data.status === 'access_blocked') { note('原站拒绝了本次访问，不是普通验证码；请换一个来源。'); return; }
                if (data.status === 'cancelled') { note('已取消原站查询，其他结果不受影响。', 'retry', true); return; }
                if (data.status === 'client_required') { note('当前环境尚不支持此项查询，其他结果不受影响。', false, true); return; }
                if (data.status !== 'ok' || !Array.isArray(data.results)) throw new Error(data.status==='busy'?'busy':'unavailable');
                receive(data);
                if (notice) notice.replaceChildren(el('span', name + '：已完成，结果已合入上方影片。'));
            } catch (error) {
                repeat=current===generation && !interactive && error.message!=='rate' && error.message!=='invalid' && attempt<retryDelays.length;
                if(repeat) {
                    if(!notice){notice=el('div',null,'catalog-query-note');$('catalogSearchNotesBody').append(notice);}
                    notice.replaceChildren(el('span',name+`：暂未读取成功，正在自动补查（${attempt+1} / ${retryDelays.length}），已有结果可直接选片。`));
                    $('catalogSearchNotes').hidden=false;
                } else if (current === generation) note(error.message === 'rate' ? '查询较频繁，请稍后重试。' : '自动查询结束，仍未读取成功；已有结果保留，可以换来源或稍后重试。',
                    'retry', true, error.message!=='rate' && shared.nativeMetadata(id));
            } finally {
                clearTimeout(timer); controllers.delete(controller);
                if (current === generation && !repeat) { pending--; completed++; progress(); }
            }
            if(repeat) {
                const waiting=new AbortController();controllers.add(waiting);
                await new Promise(resolve=>{const timer=setTimeout(resolve,retryDelays[attempt]);waiting.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
                controllers.delete(waiting);
                if(current===generation)return searchSource(source,current,false,notice,attempt+1);
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
            // Server requests must not hold the two on-device WebView slots (or
            // vice versa). Bound each lane to two; never launch every site tab.
            const local=queue.filter(source=>shared.nativeMetadata(source.dataset.liveSource));
            const remote=queue.filter(source=>!local.includes(source));
            async function worker(lane) { while (current === generation && lane.length) await searchSource(lane.shift(), current); }
            await Promise.all([worker(local),worker(local),worker(remote),worker(remote)]);
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
