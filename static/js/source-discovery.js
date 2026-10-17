(function () {
    'use strict';
    function normalizeQuery(value) {
        return Array.from(String(value || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ').trim()).slice(0, 80).join('').trim();
    }
    function matches(text, query) {
        const haystack = String(text).normalize('NFKC').toLowerCase();
        return normalizeQuery(query).toLowerCase().split(' ').filter(Boolean).every(word => haystack.includes(word));
    }
    function searchUrl(base, param, home, query) {
        const value = normalizeQuery(query);
        if (!value) return home;
        const url = new URL(base);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid search provider');
        if (param) { url.searchParams.set(param, value); return url.href; }
        return base + encodeURIComponent(value);
    }
    function sourceMatches(genres, type, has4k, quality) {
        return (type === 'all' || String(genres).split(' ').includes(type))
            && (quality !== '4k' || has4k === 'true');
    }
    function safeResultUrl(sourceId, value) {
        const rules = {
            blender: ['video.blender.org', /^\/videos\/watch\/[0-9a-f-]{36}$/],
            huarw: ['huarw.com', /^\/movie\/[0-9]+$/],
            cupfox: ['www.cupfox.in', /^\/vod-detail\/[0-9]+\.html$/],
            yhdmoe: ['yhdmoe.com', /^\/watch\/[0-9]{1,20}$/],
            fcma: ['www.fcma.cc', /^\/v\/[0-9]{1,20}\/[0-9]{1,5}$/],
        };
        try {
            if (typeof value !== 'string' || value.includes('\\')) return null;
            const url = new URL(value);
            const rule = rules[sourceId];
            return rule && url.protocol === 'https:' && url.host === rule[0]
                && !url.username && !url.password && !url.search && !url.hash && rule[1].test(url.pathname) ? url.href : null;
        } catch (_) { return null; }
    }
    function safeLaunchPath(source, item, episode, value) {
        if (typeof item !== 'string' || typeof episode !== 'string') return null;
        const valid = source === 'cupfox' ? /^\d{1,20}$/.test(item) && /^ep\d{1,5}$/.test(episode)
            : source === 'huarw' ? /^\d{1,20}$/.test(item) && new RegExp('^' + item + '(?:-\\d{1,5}){1,3}$').test(episode)
            : source === 'yhdmoe' ? /^\d{1,20}$/.test(item) && /^EP\d{1,5}(?:\.\d{1,2})?$/.test(episode)
            : source === 'fcma' ? /^\d{1,20}-\d{1,5}$/.test(item) && /^\d{1,20}$/.test(episode)
            : source === 'blender' && /^[0-9a-f-]{36}$/.test(item) && episode === 'video';
        const path = `/discover/play/${source}/${item}/${episode}`;
        return valid && value === path ? path : null;
    }
    function createDetails(doc, fetcher) {
        const panel = doc.getElementById('discoveryDetail');
        if (!panel) return { open() {}, close() {} };
        const title = doc.getElementById('discoveryDetailTitle');
        const status = doc.getElementById('discoveryDetailStatus');
        const description = doc.getElementById('discoveryDetailDescription');
        const list = doc.getElementById('discoveryEpisodes');
        const original = doc.getElementById('discoveryDetailOriginal');
        const filter = doc.getElementById('discoveryEpisodeFilter');
        const more = doc.getElementById('discoveryEpisodeMore');
        let episodes = [], visible = 100;
        function renderEpisodes() {
            const query = normalizeQuery(filter?.value || '').toLowerCase();
            const matching = episodes.filter(e => e.label.toLowerCase().includes(query));
            list.replaceChildren();
            for (const episode of matching.slice(0, visible)) {
                const link = doc.createElement('a'); link.className = 'discovery-episode';
                link.textContent = episode.label; link.href = episode.path;
                link.referrerPolicy = 'no-referrer'; link.target = '_self'; list.append(link);
            }
            if (more) { more.hidden = matching.length <= visible; more.textContent = `再显示 100 个（共 ${matching.length} 个）`; }
        }
        filter?.addEventListener('input', () => { visible = 100; renderEpisodes(); });
        more?.addEventListener('click', () => { visible += 100; renderEpisodes(); });
        let generation = 0, controller = null, opener = null;
        function cancel() { generation++; controller?.abort(); controller = null; }
        function close() { cancel(); if (panel.open) panel.close(); opener?.focus(); }
        doc.getElementById('discoveryDetailClose').addEventListener('click', close);
        panel.addEventListener('close', cancel);
        async function open(source, row, trigger) {
            const url = safeResultUrl(source, row.page_url);
            if (!url) return;
            cancel(); const current = generation;
            opener = trigger; title.textContent = row.title.slice(0, 160);
            description.textContent = ''; list.replaceChildren();
            episodes = []; visible = 100;
            if (filter) { filter.value = ''; filter.hidden = true; }
            if (more) more.hidden = true;
            original.href = url; status.textContent = '正在读取集数…';
            if (!panel.open) panel.showModal();
            const active = new AbortController(); controller = active;
            const timer = setTimeout(() => active.abort(), 12000);
            try {
                const response = await fetcher('/api/discover/detail', { method: 'POST',
                    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, page_url: url }),
                    credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: active.signal });
                if (!response.ok) throw new Error('unavailable');
                const data = await response.json();
                if (generation !== current) return;
                const parts = new URL(url).pathname.split('/');
                const item = source === 'fcma' ? parts.slice(2).join('-') : parts.pop().replace(/\.html$/, '');
                if (data.source_id !== source || data.page_url !== url || data.item_id !== item || !Array.isArray(data.episodes)) throw new Error('invalid');
                if (typeof data.description === 'string') description.textContent = data.description.slice(0, 500);
                for (const episode of data.episodes.slice(0, 6000)) {
                    if (!episode || typeof episode.title !== 'string') continue;
                    const path = safeLaunchPath(source, item, episode.id, episode.launch_path);
                    if (!path) continue;
                    const line = typeof episode.line === 'string' ? episode.line.slice(0, 30) : '';
                    episodes.push({ path, label: (line ? line + ' · ' : '') + episode.title.slice(0, 60) });
                }
                const found = episodes.length;
                renderEpisodes(); if (filter) filter.hidden = found <= 100;
                status.textContent = found ? `${found} 个选集 · 点击后在新版客户端播放区打开。各成员仍需选择同一集。`
                    : data.status === 'no_episodes' ? '暂未识别到可用集数，可以改用原站选集。'
                    : '这个来源暂时无法读取集数，请稍后重试或换一个来源。';
                if (data.truncated === true) status.textContent += ' 已达选集数量上限，其余请用原站选集。';
            } catch (_) {
                if (generation === current) status.textContent = '集数读取失败或超时，可关闭后重试；没有切换当前影片。';
            } finally { clearTimeout(timer); }
        }
        return { open, close };
    }
    function createLiveSearch(doc, fetcher = globalThis.fetch) {
        const section = doc.getElementById('discoveryLive');
        if (!section) return { run: async () => {}, cancel: () => {} };
        const results = doc.getElementById('discoveryLiveResults');
        const status = doc.getElementById('discoveryLiveStatus');
        const choices = Array.from(doc.getElementById('sourceDiscovery').querySelectorAll('[data-live-source]'));
        const query = doc.getElementById('discoveryQuery');
        const details = createDetails(doc, fetcher);
        let generation = 0;
        const controllers = new Set();
        function element(tag, text, className) {
            const el = doc.createElement(tag);
            if (text != null) el.textContent = String(text);
            if (className) el.className = className;
            return el;
        }
        function cancel(hide = false) {
            generation++;
            for (const controller of controllers) controller.abort();
            controllers.clear();
            results.replaceChildren();
            section.hidden = hide;
            section.setAttribute('aria-busy', 'false');
            status.textContent = hide ? '' : '条件已更改，点击“搜索”查看新结果。';
        }
        for (const choice of choices) choice.addEventListener('change', () => cancel());
        async function run() {
            cancel();
            const current = generation;
            const value = normalizeQuery(query.value);
            const selected = choices.filter(choice => choice.checked);
            if (!value || !selected.length) {
                status.textContent = !value ? '先输入想看的片名，再点击“搜索”。' : '请至少勾选一个来源。';
                return;
            }
            section.setAttribute('aria-busy', 'true');
            let completed = 0, count = 0, failures = 0;
            function progress() {
                status.textContent = `“${value}”：已完成 ${completed} / ${selected.length} 个来源，找到 ${count} 个条目`
                    + (failures ? `，${failures} 个来源暂不可用` : '')
                    + '。条目不等于已验证可播放；同名不一定是同一版本。';
            }
            progress();
            const tasks = selected.map(async choice => {
                const sourceId = choice.dataset.liveSource;
                const block = element('section', null, 'discovery-live-source');
                block.append(element('h4', choice.dataset.sourceName), element('p', choice.dataset.sourceNote, 'discovery-note'));
                const state = element('p', '正在查询…', 'discovery-query-state');
                const list = element('div', null, 'discovery-films');
                block.append(state, list); results.append(block);
                const controller = new AbortController();
                controllers.add(controller);
                const timer = setTimeout(() => controller.abort(), 12000);
                try {
                    const response = await fetcher('/api/discover/search', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ source: sourceId, q: value }),
                        credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal,
                    });
                    if (!response.ok) throw new Error(response.status === 429 ? 'rate' : 'unavailable');
                    const data = await response.json();
                    if (current !== generation) return;
                    if (data.source_id !== sourceId || !Array.isArray(data.results) || data.status !== 'ok') {
                        throw new Error(data.status === 'busy' ? 'busy' : 'unavailable');
                    }
                    let found = 0;
                    for (const row of data.results.slice(0, 12)) {
                        if (!row || typeof row.title !== 'string') continue;
                        const url = safeResultUrl(sourceId, row.page_url);
                        if (!url) continue;
                        found++;
                        const card = element('article', null, 'discovery-film discovery-title-card');
                        const cover = element('button', row.title.slice(0, 24), 'discovery-title-art');
                        cover.type = 'button'; cover.setAttribute('aria-label', `查看${row.title.slice(0, 160)}的详情和集数`);
                        cover.addEventListener('click', () => details.open(sourceId, row, cover));
                        card.append(cover);
                        card.append(element('h5', row.title.slice(0, 160)));
                        const facts = [row.year || '年份未标注', row.episode_label || '', '画质 / 免费范围待确认'].filter(Boolean);
                        card.append(element('p', facts.join(' · '), 'discovery-note'));
                        const nav = element('nav');
                        const select = element('button', '详情 / 选集', 'discovery-primary');
                        select.type = 'button'; select.addEventListener('click', () => details.open(sourceId, row, select));
                        const link = element('a', '原站详情 ↗');
                        link.href = url;
                        link.target = results.dataset.linkTarget === '_self' ? '_self' : '_blank';
                        link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
                        const copy = element('button', '复制详情地址', 'discovery-copy');
                        copy.type = 'button';
                        copy.addEventListener('click', async () => {
                            try {
                                await navigator.clipboard.writeText(url);
                                if (current === generation) doc.getElementById('discoveryFeedback').textContent = '详情地址已复制；请先在原站选择具体集数，不是视频直链。';
                            } catch (_) {
                                if (current !== generation) return;
                                const field = doc.getElementById('discoveryCopyValue');
                                doc.getElementById('discoveryCopyFallback').hidden = false;
                                field.value = url; field.focus(); field.select();
                            }
                        });
                        nav.append(select, link, copy); card.append(nav); list.append(card);
                    }
                    count += found;
                    state.textContent = found ? `找到 ${found} 个条目${data.cached ? '（5 分钟内缓存）' : ''}，尚未验证播放。`
                        : '此来源没有匹配条目，不代表其他来源没有这部作品。';
                } catch (error) {
                    if (current !== generation) return;
                    failures++;
                    state.textContent = error.message === 'rate' ? '搜索较频繁，请稍后再试。'
                        : error.message === 'busy' ? '来源正在查询中，请稍后重试。'
                        : '此来源查询失败或超时；其他来源仍会显示，可稍后重试或用下方原站入口。';
                } finally {
                    clearTimeout(timer); controllers.delete(controller);
                    if (current === generation) { completed++; progress(); }
                }
            });
            await Promise.all(tasks);
            if (current === generation) section.setAttribute('aria-busy', 'false');
        }
        return { run, cancel };
    }
    function init(doc) {
        const root = doc.getElementById('sourceDiscovery');
        if (!root) return;
        const query = doc.getElementById('discoveryQuery');
        const cards = Array.from(root.querySelectorAll('[data-search-text]'));
        const links = Array.from(root.querySelectorAll('[data-search-base]'));
        const sourceCards = Array.from(root.querySelectorAll('[data-source-genres]'));
        const copyLinks = Array.from(root.querySelectorAll('[data-copy-link]'));
        const sourceType = doc.getElementById('discoverySourceType');
        const quality = doc.getElementById('discoveryQuality');
        const feedback = doc.getElementById('discoveryFeedback');
        const fallback = doc.getElementById('discoveryCopyFallback');
        const clear = doc.getElementById('discoveryClear');
        const live = createLiveSearch(doc);
        function render() {
            const value = normalizeQuery(query.value);
            const selectedQuality = quality ? quality.value : 'all';
            let count = 0;
            for (const card of cards) {
                card.hidden = !matches(card.dataset.searchText, value)
                    || (selectedQuality === '4k' && card.dataset.has4k !== 'true');
                if (!card.hidden) count++;
            }
            let sourceCount = 0;
            for (const card of sourceCards) {
                card.hidden = !sourceMatches(card.dataset.sourceGenres, sourceType ? sourceType.value : 'all',
                    card.dataset.has4k, selectedQuality);
                if (!card.hidden) sourceCount++;
            }
            const sourceStatus = doc.getElementById('discoverySourceCount');
            if (sourceStatus) sourceStatus.textContent = `导航显示 ${sourceCount} / ${sourceCards.length} 个入口`;
            const sourceEmpty = doc.getElementById('discoverySourceEmpty');
            if (sourceEmpty) sourceEmpty.hidden = sourceCount > 0;
            for (const link of links) {
                link.href = searchUrl(link.dataset.searchBase, link.dataset.searchParam, link.dataset.searchHome, value);
                link.textContent = value ? `去${link.dataset.platformName}搜索` : `打开${link.dataset.platformName}`;
            }
            doc.getElementById('discoveryResultCount').textContent = `本地目录匹配 ${count} / ${cards.length} 部`;
            doc.getElementById('discoveryEmpty').hidden = count > 0;
            feedback.textContent = '';
            fallback.hidden = true;
        }
        doc.getElementById('discoveryForm').addEventListener('submit', async event => {
            event.preventDefault();
            query.value = normalizeQuery(query.value);
            render();
            await live.run();
        });
        query.addEventListener('input', () => { render(); live.cancel(!normalizeQuery(query.value)); });
        if (sourceType) sourceType.addEventListener('change', render);
        if (quality) quality.addEventListener('change', render);
        clear.hidden = false;
        clear.addEventListener('click', () => {
            query.value = '';
            if (sourceType) sourceType.value = 'all';
            if (quality) quality.value = 'all';
            render(); live.cancel(true); query.focus();
        });
        for (const link of copyLinks) {
            const button = link.parentElement.querySelector('.discovery-copy');
            button.hidden = false;
            button.addEventListener('click', async () => {
                const url = link.href;
                try {
                    await navigator.clipboard.writeText(url);
                    feedback.textContent = '入口地址已复制。请粘贴到浏览器；它不是视频直链。';
                } catch (_error) {
                    feedback.textContent = '浏览器未允许自动复制，可手动复制下面的地址。';
                    fallback.hidden = false;
                    const field = doc.getElementById('discoveryCopyValue');
                    field.value = url;
                    field.focus();
                    field.select();
                }
            });
        }
        render();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { normalizeQuery, matches, searchUrl, sourceMatches, safeResultUrl, safeLaunchPath, createDetails, createLiveSearch, init };
    if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => init(document));
})();
