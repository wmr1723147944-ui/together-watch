(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else { root.TogetherWatchCatalogMobile = api; document.addEventListener('DOMContentLoaded', () => api.init(document)); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    function init(doc) {
        const home = doc.getElementById('catalogMobileHome'), search = doc.getElementById('catalogMobileSearch');
        const query = doc.getElementById('discoveryQuery'), live = doc.getElementById('discoveryLive');
        if (!home || !search || !query || !live) return null;
        const win = doc.defaultView || globalThis, viewport = win.visualViewport;
        // Reuse only the hero's successfully loaded image. This is decoration,
        // not a second source lookup; cover fallback/replacement remains owned
        // by the poster loader. Desktop and playback never load this copy.
        const atmosphere = doc.getElementById('catalogMobileAtmosphere');
        const heroArt = doc.getElementById('catalogHeroImage');
        const ambientImage = atmosphere?.querySelector('img');
        function syncAtmosphere() {
            if (!ambientImage || !heroArt) return;
            const mobile = win.matchMedia?.('(max-width: 680px)').matches;
            const picture = heroArt.querySelector('img[data-loading="false"]:not([hidden])');
            const src = picture?.currentSrc || picture?.getAttribute('src');
            const use = mobile && !heroArt.hidden && picture?.complete && picture?.naturalWidth > 0 && /^https?:\/\//i.test(src || '');
            if (use) {
                if (ambientImage.getAttribute('src') !== src) ambientImage.setAttribute('src', src);
                ambientImage.hidden = false;
            } else {
                ambientImage.hidden = true; ambientImage.removeAttribute('src');
            }
        }
        let tallest = viewport?.height || win.innerHeight;
        const scrollHeader = () => doc.body.classList.toggle('catalog-scrolled', (win.scrollY || 0) > 32);
        win.addEventListener('scroll', scrollHeader, { passive:true });
        scrollHeader();
        function update() {
            const searching = !live.hidden || doc.activeElement === query;
            home.toggleAttribute('aria-current', !searching);
            search.toggleAttribute('aria-current', searching);
            if (!searching) home.setAttribute('aria-current', 'page');
            if (searching) search.setAttribute('aria-current', 'page');
        }
        function keyboard() {
            const height = viewport?.height || win.innerHeight;
            tallest = Math.max(tallest, height);
            const input = /^(INPUT|TEXTAREA)$/.test(doc.activeElement?.tagName || '');
            // Shrink/overlay keyboards differ across WebView versions. Hide only
            // while editing with a substantial viewport loss, never on scroll.
            doc.body.classList.toggle('catalog-keyboard-open', input && tallest - height > 140);
            update();
        }
        home.addEventListener('click', () => {
            query.blur();
            win.TogetherWatchCatalogNavigation?.home(false);
            win.scrollTo?.({ top: 0, behavior: 'instant' });
            doc.body.classList.toggle('catalog-keyboard-open', false); update();
        });
        search.addEventListener('click', () => {
            win.scrollTo?.({ top: 0, behavior: 'instant' });
            query.focus({ preventScroll: true }); update();
        });
        doc.getElementById('discoveryForm')?.addEventListener('submit', () => {
            if (win.matchMedia?.('(max-width: 680px)').matches) {
                query.blur(); doc.body.classList.toggle('catalog-keyboard-open', false);
            }
            update();
        });
        doc.addEventListener('focusin', keyboard);
        doc.addEventListener('focusout', () => { keyboard(); win.setTimeout?.(keyboard, 0); });
        viewport?.addEventListener('resize', keyboard);
        win.addEventListener('orientationchange', () => { tallest = 0; keyboard(); });
        const observer = win.MutationObserver ? new win.MutationObserver(update) : null;
        observer?.observe(live, { attributes: true, attributeFilter: ['hidden'] });
        const artObserver = heroArt && win.MutationObserver ? new win.MutationObserver(syncAtmosphere) : null;
        artObserver?.observe(heroArt, { childList:true, subtree:true, attributes:true, attributeFilter:['hidden','src','data-loading'] });
        heroArt?.addEventListener('load', syncAtmosphere, true);
        heroArt?.addEventListener('error', syncAtmosphere, true);
        win.addEventListener('resize', syncAtmosphere);
        syncAtmosphere();
        update();
        // The invitation remains an ordinary first-party link: Android/Windows
        // intercept it themselves. Do not create another room or native bridge.
        return { update, keyboard, syncAtmosphere };
    }
    return { init };
});
