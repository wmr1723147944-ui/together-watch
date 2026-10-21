/* Layout only, on the known Kanju player route. No player/account data read. */
(() => {
    if (!['kanju.ai','www.kanju.ai'].includes(location.hostname)
        || location.protocol !== 'https:' || !location.pathname.startsWith('/player/')) return;
    if (document.getElementById('tw-android-player-layout')) return;
    const style=document.createElement('style');
    style.id='tw-android-player-layout';
    // A vertically split WebView can be wider than it is tall even in portrait.
    // Use width, not CSS orientation, to keep the original controls accessible.
    style.textContent=`
      @media (max-width: 700px) {
        .movie-player-shell-layout-grid {
          grid-template-columns: minmax(0, 1fr) !important;
          grid-template-rows: auto auto !important;
          width: 100% !important; min-width: 0 !important;
          height: auto !important; max-height: none !important;
        }
        .movie-player-shell-layout-grid > .movie-player-frame-region,
        .movie-player-shell-layout-grid > .movie-player-sidebar {
          grid-column: 1 !important; grid-row: auto !important;
          width: 100% !important; min-width: 0 !important; max-width: 100% !important;
        }
        .movie-player-shell-layout-grid > .movie-player-frame-region {
          height: auto !important; min-height: min(56.25vw, 395px) !important;
        }
        .movie-player-shell-layout-grid > .movie-player-sidebar {
          height: auto !important; overflow: visible !important;
        }
      }`;
    (document.head || document.documentElement).appendChild(style);
})();
