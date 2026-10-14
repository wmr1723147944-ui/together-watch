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
    function init(doc) {
        const root = doc.getElementById('sourceDiscovery');
        if (!root) return;
        const query = doc.getElementById('discoveryQuery');
        const cards = Array.from(root.querySelectorAll('[data-search-text]'));
        const links = Array.from(root.querySelectorAll('[data-search-base]'));
        const feedback = doc.getElementById('discoveryFeedback');
        const fallback = doc.getElementById('discoveryCopyFallback');
        const clear = doc.getElementById('discoveryClear');
        function render() {
            const value = normalizeQuery(query.value);
            let count = 0;
            for (const card of cards) {
                card.hidden = !matches(card.dataset.searchText, value);
                if (!card.hidden) count++;
            }
            for (const link of links) {
                link.href = searchUrl(link.dataset.searchBase, link.dataset.searchParam, link.dataset.searchHome, value);
                link.textContent = value ? `去${link.dataset.platformName}搜索` : `打开${link.dataset.platformName}`;
            }
            doc.getElementById('discoveryResultCount').textContent = `本地目录匹配 ${count} / ${cards.length} 部`;
            doc.getElementById('discoveryEmpty').hidden = count > 0;
            feedback.textContent = '';
            fallback.hidden = true;
        }
        doc.getElementById('discoveryForm').addEventListener('submit', event => {
            event.preventDefault();
            query.value = normalizeQuery(query.value);
            render();
        });
        query.addEventListener('input', render);
        clear.hidden = false;
        clear.addEventListener('click', () => { query.value = ''; render(); query.focus(); });
        for (const link of links) {
            const button = link.parentElement.querySelector('.discovery-copy');
            button.hidden = false;
            button.addEventListener('click', async () => {
                const url = link.href;
                try {
                    await navigator.clipboard.writeText(url);
                    feedback.textContent = '搜索地址已复制。请粘贴到浏览器；它不是视频直链。';
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
    if (typeof module !== 'undefined' && module.exports) module.exports = { normalizeQuery, matches, searchUrl, init };
    if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => init(document));
})();
