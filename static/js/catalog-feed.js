(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TogetherWatchFeed = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const MAX_VISIBLE = 480, KEEP_VISIBLE = 240;
    function createFeed(doc, fetcher, { groupResults, addPoster, registerPosters=()=>{}, openGroup }) {
        const $ = id => doc.getElementById(id), grid = $('catalogFeedGrid');
        if (!grid) return null;
        const win = doc.defaultView || globalThis;
        const configs = [...doc.querySelectorAll('[data-feed-source]')].map(el => ({
            id: el.dataset.feedSource, name: el.dataset.sourceName, categories: el.dataset.categories.split(',')
        }));
        let generation = 0, category = 'all', states = [], busy = false, visible = false, started = false;
        let autoPaused = false, emptyBatches = 0, total = 0, featured = null, trimMessage = '';
        const controllers = new Set(), entries = new Map(), seen = new Set();
        function el(tag, text, className) {
            const n = doc.createElement(tag); if (text != null) n.textContent = text;
            if (className) n.className = className; return n;
        }
        function cancel() {
            generation++; for (const c of controllers) c.abort(); controllers.clear(); busy = false;
        }
        function renderStatus() {
            renderSpotlight();
            const available = states.some(s => !s.done && !s.error), failed = states.filter(s => s.error);
            grid.setAttribute('aria-busy', String(busy));
            $('catalogFeedSkeleton').hidden = !busy || entries.size > 0;
            $('catalogFeedEmpty').hidden = busy || entries.size > 0;
            const button = $('catalogFeedMore'); button.disabled = busy;
            button.hidden = !busy && !available && !failed.length;
            button.textContent = busy ? '正在加载…' : entries.size >= MAX_VISIBLE ? '继续浏览（保留最近的影片）'
                : !available && failed.length ? '重试未完成的目录' : '加载更多影片';
            $('catalogFeedStatus').textContent = busy ? (total ? `已发现 ${total} 部，正在加载下一批…` : '正在从各站读取片单…')
                : !states.length ? '当前分类没有启用的目录来源，仍可使用上方搜索。'
                : `${total ? `已发现 ${total} 部。` : ''}${available ? entries.size >= MAX_VISIBLE ? '为保持页面流畅，请点下方按钮继续浏览。' : autoPaused ? '本批没有新增影片，点下方按钮可继续查找。' : '继续向下浏览，会自动加载更多。' : failed.length ? '部分目录暂时失败，可重试；已加载的影片仍可查看。' : states.some(s=>s.limit) ? '已到本轮分页上限，可刷新或切换分类继续浏览。' : '当前目录已浏览完，稍后刷新可查看更新。'}${trimMessage}`;
            const notes = $('catalogFeedNotesBody'); notes.replaceChildren();
            for (const s of failed) notes.append(el('p', `${s.name}：${s.error}`, 'catalog-query-note'));
            $('catalogFeedNotes').hidden = !failed.length;
        }
        // A bounded, real-metadata preview. No invented rankings or extra queries.
        const spotlightCards = new Map();
        let programme = [], previewPicked = false;
        function programmeGroups() {
            if (programme.length === 5 && programme.includes(featured) && programme.every(g=>entries.get(g.key)?.group===g)) return programme;
            const pool = [];
            for (const entry of entries.values()) {
                pool.push(entry.group);
                if (pool.length === 40) break;
            }
            if (!pool.length) return programme = [];
            if (!featured || !entries.has(featured.key)) setHero(pool[0]);
            // Keep the current title in place; sample across distinct covers
            // already on the shelf instead of mirroring its first row.
            const chosen = programme.filter(g=>entries.get(g.key)?.group===g);
            if (!chosen.includes(featured)) {
                if(chosen.length===5)chosen.pop();
                chosen.push(featured);
            }
            const covers = new Set(chosen.map(g=>g.poster).filter(Boolean));
            const available = pool.filter(g=>!chosen.includes(g));
            const pictured = available.filter(g=>{
                if (!g.poster || covers.has(g.poster)) return false;
                covers.add(g.poster); return true;
            });
            const take = Math.min(5-chosen.length,pictured.length);
            for(let i=0;i<take;i++)chosen.push(pictured[Math.ceil((i+1)*pictured.length/take)-1]);
            for(const g of available){if(chosen.length>=5)break;if(!chosen.includes(g))chosen.push(g);}
            return programme = chosen;
        }
        function renderSpotlight() {
            const preview = $('catalogSpotlightGrid');
            if (!preview) return;
            const groups = programmeGroups();
            const keep = new Set(groups.map(group => group.key));
            for (const [key, item] of spotlightCards) if (!keep.has(key)) { item.card.remove(); spotlightCards.delete(key); }
            for (const group of groups) {
                let item = spotlightCards.get(group.key);
                if (!item) {
                    const card = el('article', null, 'catalog-film catalog-spotlight-film');
                    const button = el('button', null, 'programme-choice'); button.type = 'button';
                    button.setAttribute('aria-label', '预览 ' + group.title);
                    const cover = el('span', null, 'catalog-film-poster');
                    const index = el('span', null, 'programme-number');
                    index.setAttribute('aria-hidden','true');
                    const title = el('span', group.title, 'catalog-title');
                    button.append(cover, index, title); card.append(button); preview.append(card);
                    item = { card, button, cover, index, group, poster: null }; spotlightCards.set(group.key, item);
                    button.addEventListener('click', ()=>selectPreview(item.group));
                }
                item.group = group;
                item.button.setAttribute('aria-pressed',String(group===featured));
                item.index.textContent = String(groups.indexOf(group)+1).padStart(2,'0');
                if (item.poster !== group.poster) {
                    item.cover.replaceChildren();
                    addPoster(doc, item.cover, group.poster, group.choices[0].row.page_url, group.title,group);
                    item.poster = group.poster;
                }
            }
            preview.hidden = groups.length === 0;
            const position=$('catalogHeroPosition');
            if(position)position.textContent=groups.includes(featured)
                ? String(groups.indexOf(featured)+1).padStart(2,'0')+' / '+String(groups.length).padStart(2,'0') : '';
            for(const id of ['catalogHeroPrevious','catalogHeroNext']) {
                const control=$(id); if(control)control.disabled=groups.length<2;
            }
        }
        function selectPreview(group) {
            previewPicked=true;
            if(featured!==group){setHero(group);renderSpotlight();}
            // Scroll only the thumbnail strip, never the page or the document.
            const strip=$('catalogSpotlightGrid'), card=spotlightCards.get(group.key)?.card;
            if(strip?.scrollWidth>strip?.clientWidth && card?.getBoundingClientRect) {
                const bounds=strip.getBoundingClientRect(),target=card.getBoundingClientRect();
                if(target.left<bounds.left || target.right>bounds.right) {
                    strip.scrollTo?.({left:strip.scrollLeft+target.left-bounds.left,behavior:'instant'});
                }
            }
        }
        function advancePreview(direction) {
            if(programme.length<2)return;
            const index=programme.indexOf(featured);
            selectPreview(programme[(index+direction+programme.length)%programme.length]);
        }
        function setHero(group) {
            featured = group;
            $('catalogHeroTitle').textContent = group.title;
            const row=group.choices[0].row;
            // Do not fetch a detail page just to fill decorative copy.
            const synopsis=typeof row.description==='string' ? row.description.trim() : '';
            $('catalogHeroTagline').textContent = synopsis.slice(0,110);
            $('catalogHeroFacts').textContent = [group.year,row.genre].filter(Boolean).join('  /  ');
            const art = $('catalogHeroImage'); art.hidden = false;art.replaceChildren();
            addPoster(doc,art,group.poster,group.choices[0].row.page_url,group.title,group);
            $('catalogHeroOpen').hidden = false;
        }
        function cardFacts(group) {
            const genre=group.choices.find(choice=>choice.row.genre)?.row.genre;
            const count=new Set(group.choices.map(choice=>choice.source)).size;
            return [group.year, genre, count>1 ? count+' 个片源' : ''].filter(Boolean).join(' · ');
        }
        function append(source, rows) {
            const fresh = rows.filter(row => {
                if (!row || typeof row.page_url !== 'string') return false;
                const key = source.id + ':' + row.page_url;
                if (seen.has(key)) return false;
                // Validate before retaining a server-supplied entry.
                if (!groupResults([{ source: source.id, rows: [row] }]).length) return false;
                seen.add(key); if (seen.size > 5000) seen.delete(seen.values().next().value);
                return true;
            });
            for (const group of groupResults([{ source: source.id, name: source.name, rows: fresh }], 60)) {
                registerPosters(doc,group);
                const old = entries.get(group.key);
                if (old) {
                    old.group.choices.push(...group.choices);
                    if (!old.group.poster && group.poster) {
                        old.group.poster = group.poster;
                        old.cover.replaceChildren();
                        addPoster(doc, old.cover, group.poster, old.group.choices[0].row.page_url, group.title,old.group);
                        old.cover.append(el('span', '查看影片 / 选集 →', 'catalog-hover-action'));
                        if (featured === old.group) setHero(old.group);
                    }
                    old.facts.textContent = cardFacts(old.group);
                    continue;
                }
                const card = el('article', null, 'catalog-film catalog-feed-film');
                const cover = el('button', null, 'catalog-film-poster'); cover.type = 'button';
                cover.setAttribute('aria-label', '查看 ' + group.title + ' 的来源和集数');
                addPoster(doc, cover, group.poster, group.choices[0].row.page_url, group.title,group);
                if (group.choices[0].row.genre) cover.append(el('span', group.choices[0].row.genre, 'catalog-film-badge'));
                cover.append(el('span', '查看影片 / 选集 →', 'catalog-hover-action'));
                const title = el('button', group.title, 'catalog-title'); title.type = 'button';
                const facts = el('p', cardFacts(group));
                card.append(cover, title, facts); grid.append(card);
                cover.addEventListener('click', () => openGroup(group, cover, true));
                title.addEventListener('click', () => openGroup(group, title, true));
                entries.set(group.key, { group, card, cover, facts }); total++;
                if (!featured || !previewPicked && !featured.poster && group.poster) setHero(group);
            }
            return fresh.length;
        }
        async function load(manual = false) {
            if (!visible || busy) return;
            if (manual) {
                autoPaused = false; emptyBatches = 0;
                for (const s of states) if (!s.done) s.error = '';
                if (entries.size >= MAX_VISIBLE) {
                    while (entries.size > KEEP_VISIBLE) {
                        const [key, entry] = entries.entries().next().value; entry.card.remove(); entries.delete(key);
                    }
                    trimMessage = '为保持流畅，页面保留最近浏览的影片。';
                }
            } else if (autoPaused || entries.size >= MAX_VISIBLE) return;
            const queue = states.filter(s => !s.done && !s.error);
            if (!queue.length) { renderStatus(); return; }
            busy = true; const current = generation; let added = 0; renderStatus();
            async function worker() {
                while (current === generation && queue.length) {
                    const s = queue.shift(), page = s.page;
                    const controller = new AbortController(); controllers.add(controller);
                    const timer = setTimeout(() => controller.abort(), 12000);
                    try {
                        const response = await fetcher('/api/discover/feed?' + new URLSearchParams({ source: s.id, category, page }), {
                            credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { Accept: 'application/json' }
                        });
                        if (!response.ok) throw Error(response.status === 429 ? 'rate' : 'network');
                        const data = await response.json();
                        if (current !== generation) return;
                        if (data.source_id !== s.id || data.page !== page || data.category !== category) throw Error('invalid');
                        if (data.status !== 'ok') throw Error(data.status === 'verification_required' ? 'verification' : 'network');
                        if (!Array.isArray(data.results) || data.results.length > 60 || typeof data.has_more !== 'boolean'
                            || (data.has_more && data.next_page !== page + 1)) throw Error('invalid');
                        const count = append(s, data.results); added += count;
                        s.emptyRounds = count ? 0 : s.emptyRounds + 1;
                        s.done = !data.has_more; s.limit = data.page_limit === true;
                        if (data.has_more) s.page = data.next_page;
                        if (!s.done && s.emptyRounds >= 2) s.error = '连续返回重复或空列表，已暂停自动翻页。';
                        renderStatus();
                    } catch (error) {
                        if (current === generation) s.error = error.message === 'verification' ? '原站要求验证，暂不自动读取。'
                            : error.message === 'rate' ? '查询较频繁，请稍后重试。' : '网络或目录暂不可用，可稍后重试。';
                    } finally { clearTimeout(timer); controllers.delete(controller); }
                }
            }
            await Promise.all([worker(), worker()]);
            if (current !== generation) return;
            // The current-year archive can overlap the category's first batch.
            // Skip one duplicate/empty batch, but never spin through unbounded
            // empty pages. Per-source and global guards both stop after two.
            emptyBatches = added ? 0 : emptyBatches + 1;
            busy = false; autoPaused = emptyBatches >= 2; renderStatus();
            if (!autoPaused) win.setTimeout?.(maybeLoad, 180);
        }
        function maybeLoad() {
            if (!visible || busy || autoPaused || doc.visibilityState === 'hidden' || $('discoveryDetail')?.open) return;
            const rect = $('catalogFeedSentinel').getBoundingClientRect();
            if (rect.top < (win.innerHeight || 0) + 420 && rect.bottom > 0) load();
        }
        function reset(nextCategory = category) {
            cancel(); category = nextCategory; started = true; autoPaused = false; emptyBatches = 0; total = 0; trimMessage = '';
            entries.clear(); seen.clear(); grid.replaceChildren(); featured = null; programme = []; previewPicked = false;
            $('catalogHeroImage').hidden = true; $('catalogHeroOpen').hidden = true;
            $('catalogHeroTitle').textContent = '今天，想看点什么？';
            $('catalogHeroTagline').textContent = '找一部喜欢的，留个位置给朋友。';
            $('catalogHeroFacts').textContent = '电影 · 剧集 · 动漫 · 纪录片';
            states = configs.filter(s => s.categories.includes(category)).map(s => ({ ...s, page: 1, done: false, error: '', emptyRounds: 0 }));
            renderStatus(); return load();
        }
        function setVisible(value) {
            visible = value;
            if (!value) { cancel(); renderStatus(); }
            else if (!started) return reset();
            else { renderStatus(); maybeLoad(); }
        }
        $('catalogFeedMore').addEventListener('click', () => load(true));
        $('catalogFeedRefresh').addEventListener('click', () => reset());
        $('catalogHeroOpen').addEventListener('click', () => { if (featured) openGroup(featured, $('catalogHeroOpen'), true); });
        $('catalogHeroPrevious')?.addEventListener('click',()=>advancePreview(-1));
        $('catalogHeroNext')?.addEventListener('click',()=>advancePreview(1));
        let scrollQueued = false;
        win.addEventListener?.('scroll', () => {
            if (scrollQueued) return; scrollQueued = true;
            win.setTimeout(() => { scrollQueued = false; maybeLoad(); }, 120);
        }, { passive: true });
        win.addEventListener?.('resize', maybeLoad);
        doc.addEventListener?.('visibilitychange', maybeLoad);
        win.addEventListener?.('pagehide', () => setVisible(false));
        win.addEventListener?.('pageshow', () => { if (!$('discoveryWelcome').hidden) setVisible(true); });
        return { reset, load, setVisible, maybeLoad };
    }
    return { createFeed };
});
