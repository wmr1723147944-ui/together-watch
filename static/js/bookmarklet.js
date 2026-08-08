(() => {
    function startTogetherWatchBookmark(serverUrl) {
        const existing = window.__TW_BOOKMARK_COMPANION__;
        if (existing?.open) {
            existing.open();
            return;
        }

        const serverOrigin = new URL(serverUrl).origin;
        const CHANNEL_FROM_TARGET = 'tw-bookmark-target';
        const CHANNEL_FROM_COMPANION = 'tw-bookmark-companion';
        const randomBytes = new Uint8Array(18);
        if (window.crypto?.getRandomValues) {
            window.crypto.getRandomValues(randomBytes);
        } else {
            for (let index = 0; index < randomBytes.length; index += 1) {
                randomBytes[index] = Math.floor(Math.random() * 256);
            }
        }
        const bridgeToken = Array.from(randomBytes, byte => (
            byte.toString(16).padStart(2, '0')
        )).join('');
        const popupName = `tw_companion_${bridgeToken}`;

        let popupWindow = null;
        let player = null;
        let playerEvents = null;
        let remoteGuardUntil = 0;
        let serverClockOffset = 0;
        let bufferingTimer = null;
        let bufferingReported = false;
        let resumeTimer = null;
        let connected = false;

        const host = document.createElement('div');
        host.id = 'together-watch-bookmark-status';
        host.style.cssText = [
            'position:fixed',
            'right:16px',
            'bottom:16px',
            'z-index:2147483647',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif',
        ].join(';');
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                * { box-sizing:border-box; }
                button { display:flex; align-items:center; gap:8px; max-width:min(320px,calc(100vw - 24px)); min-height:42px; padding:9px 13px; border:1px solid rgba(255,255,255,.2); border-radius:999px; color:#fff; background:rgba(20,20,28,.94); box-shadow:0 12px 34px rgba(0,0,0,.42); font:600 13px/1.3 inherit; cursor:pointer; }
                .dot { width:9px; height:9px; flex:0 0 auto; border-radius:50%; background:#e6a52f; }
                .dot.online { background:#3dd985; box-shadow:0 0 0 4px rgba(61,217,133,.16); }
                .label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            </style>
            <button type="button" title="点击打开或重新连接助手">
                <span class="dot"></span><span class="label">一起看：正在寻找播放器</span>
            </button>
        `;
        document.documentElement.appendChild(host);
        const statusButton = shadow.querySelector('button');
        const statusDot = shadow.querySelector('.dot');
        const statusLabel = shadow.querySelector('.label');

        function setStatus(text, online = connected) {
            statusLabel.textContent = `一起看：${text}`;
            statusDot.classList.toggle('online', Boolean(online));
        }

        function postToCompanion(type, payload = {}) {
            if (!popupWindow || popupWindow.closed) return;
            popupWindow.postMessage({
                channel: CHANNEL_FROM_TARGET,
                token: bridgeToken,
                type,
                payload,
            }, serverOrigin);
        }

        function openPopup() {
            popupWindow = window.open(
                `${serverOrigin}/companion#tw=${bridgeToken}`,
                popupName,
                'popup=yes,width=390,height=690,resizable=yes,scrollbars=yes',
            );
            if (!popupWindow) {
                setStatus('弹窗被拦截，请允许后重试', false);
                return;
            }
            popupWindow.focus();
            setStatus(player ? '等待助手连接' : '正在寻找播放器', false);
            let attempts = 0;
            const helloTimer = window.setInterval(() => {
                attempts += 1;
                if (!popupWindow || popupWindow.closed || attempts > 12) {
                    window.clearInterval(helloTimer);
                    if (!popupWindow || popupWindow.closed) {
                        connected = false;
                        setStatus('助手窗口已关闭，点这里重开', false);
                    }
                    return;
                }
                postToCompanion('hello', { playerReady: Boolean(player) });
            }, 500);
        }

        function findPrimaryVideo() {
            return [...document.querySelectorAll('video')]
                .filter(video => {
                    const rect = video.getBoundingClientRect();
                    return rect.width >= 160 && rect.height >= 90;
                })
                .sort((left, right) => {
                    const a = left.getBoundingClientRect();
                    const b = right.getBoundingClientRect();
                    return (b.width * b.height) - (a.width * a.height);
                })[0] || null;
        }

        function emitPlayerEvent(type, extra = {}) {
            if (!player || Date.now() < remoteGuardUntil) return;
            postToCompanion('player_event', {
                type,
                time: Number.isFinite(player.currentTime) ? player.currentTime : 0,
                ...extra,
            });
        }

        function sendBuffering(active) {
            postToCompanion('buffering_event', {
                active,
                time: Number(player?.currentTime) || 0,
            });
        }

        function clearBuffering() {
            window.clearTimeout(bufferingTimer);
            if (!bufferingReported) return;
            bufferingReported = false;
            sendBuffering(false);
        }

        function bindPlayer(nextPlayer) {
            if (player === nextPlayer) return;
            playerEvents?.abort();
            playerEvents = new AbortController();
            player = nextPlayer;
            const options = { signal: playerEvents.signal };
            player.addEventListener('play', () => emitPlayerEvent('play'), options);
            player.addEventListener('pause', () => {
                if (!player.seeking) emitPlayerEvent('pause');
            }, options);
            player.addEventListener('seeked', () => emitPlayerEvent('seek'), options);
            player.addEventListener('ratechange', () => {
                emitPlayerEvent('speed', { speed: Number(player.playbackRate) || 1 });
            }, options);
            player.addEventListener('waiting', () => {
                window.clearTimeout(bufferingTimer);
                bufferingTimer = window.setTimeout(() => {
                    if (!player.paused && player.readyState < 3 && !bufferingReported) {
                        bufferingReported = true;
                        sendBuffering(true);
                    }
                }, 1200);
            }, options);
            for (const eventName of ['playing', 'canplay', 'canplaythrough']) {
                player.addEventListener(eventName, clearBuffering, options);
            }
            setStatus(connected ? '播放器与房间已连接' : '已找到播放器，等待房间', connected);
            postToCompanion('target_ready', { playerReady: true });
        }

        function estimatedServerNow() {
            return Date.now() / 1000 + serverClockOffset;
        }

        function expectedPosition(state) {
            let position = Number(state?.time) || 0;
            if (state?.playing && Number.isFinite(Number(state?.server_time))) {
                position += Math.max(0, estimatedServerNow() - Number(state.server_time))
                    * (Number(state.speed) || 1);
            }
            return Math.max(0, position);
        }

        function applyState(state) {
            if (!player || !state) return;
            remoteGuardUntil = Date.now() + 900;
            const position = expectedPosition(state);
            if (Math.abs((Number(player.currentTime) || 0) - position) > 0.6) {
                try {
                    player.currentTime = position;
                } catch (_error) {
                    setStatus('播放器尚未允许跳转', connected);
                }
            }
            const speed = Number(state.speed);
            if (Number.isFinite(speed) && speed >= 0.25 && speed <= 4) {
                try {
                    player.playbackRate = speed;
                } catch (_error) {
                    // Some managed players lock their playback rate.
                }
            }
            if (state.playing) {
                player.play().then(() => {
                    setStatus('正在同步播放', connected);
                }).catch(() => {
                    setStatus('请先手动点一次播放', connected);
                });
            } else if (!player.paused) {
                player.pause();
                setStatus('已同步暂停', connected);
            }
        }

        function handleRoomEvent(eventName, payload) {
            window.clearTimeout(resumeTimer);
            if (eventName === 'companion_command') {
                if (payload?.command !== 'set_volume' || !player) return;
                const volume = Math.max(0, Math.min(1, Number(payload.value) || 0));
                try {
                    player.volume = volume;
                    player.muted = volume === 0;
                } catch (_error) {
                    setStatus('请使用系统音量调节', connected);
                }
                return;
            }
            if (eventName === 'room_state') {
                const resumeAt = Number(payload?.resume_at);
                if (payload?.playing && Number.isFinite(resumeAt) && resumeAt > estimatedServerNow()) {
                    applyState({ ...payload, playing: false });
                    resumeTimer = window.setTimeout(() => {
                        applyState({ ...payload, server_time: resumeAt, resume_at: null });
                    }, Math.max(0, (resumeAt - estimatedServerNow()) * 1000));
                    return;
                }
                applyState(payload);
                return;
            }
            if (eventName === 'buffering_state') {
                const pausedState = {
                    time: payload?.time,
                    playing: false,
                    speed: payload?.speed,
                    server_time: payload?.server_time,
                };
                applyState(pausedState);
                if (!payload?.active && payload?.playing) {
                    const resumeAt = Number(payload?.resume_at) || estimatedServerNow();
                    resumeTimer = window.setTimeout(() => {
                        applyState({ ...pausedState, playing: true, server_time: resumeAt });
                    }, Math.max(0, (resumeAt - estimatedServerNow()) * 1000));
                }
                return;
            }
            if (eventName !== 'sync_video') return;
            const eventType = payload?.type;
            if (!['play', 'pause', 'seek', 'speed'].includes(eventType)) return;
            applyState({
                time: payload?.time,
                speed: payload?.speed || player?.playbackRate || 1,
                server_time: payload?.server_time,
                playing: eventType === 'play'
                    || ((eventType === 'seek' || eventType === 'speed') && !player?.paused),
            });
        }

        function refreshPlayer() {
            const nextPlayer = findPrimaryVideo();
            if (nextPlayer && nextPlayer !== player) {
                bindPlayer(nextPlayer);
            } else if (!nextPlayer) {
                player = null;
                setStatus('未找到 HTML5 播放器', false);
                postToCompanion('target_ready', { playerReady: false });
            }
        }

        window.addEventListener('message', event => {
            const data = event.data;
            if (
                event.origin !== serverOrigin
                || event.source !== popupWindow
                || data?.channel !== CHANNEL_FROM_COMPANION
                || data?.token !== bridgeToken
            ) {
                return;
            }
            serverClockOffset = Number(data.serverClockOffset) || serverClockOffset;
            if (data.type === 'hello') {
                postToCompanion('hello', { playerReady: Boolean(player) });
                return;
            }
            if (data.type === 'connection') {
                connected = Boolean(data.payload?.connected);
                setStatus(
                    connected
                        ? (player ? '播放器与房间已连接' : '房间已连接，等待播放器')
                        : '房间连接中断，点这里重试',
                    connected,
                );
                return;
            }
            if (data.type === 'room_event') {
                handleRoomEvent(data.payload?.eventName, data.payload?.payload);
            }
        });

        statusButton.addEventListener('click', openPopup);
        window.__TW_BOOKMARK_COMPANION__ = {
            open: openPopup,
            refresh: refreshPlayer,
        };
        refreshPlayer();
        window.setInterval(refreshPlayer, 1800);
        window.setInterval(() => {
            if (popupWindow && popupWindow.closed) {
                connected = false;
                setStatus('助手窗口已关闭，点这里重开', false);
            }
        }, 1600);
        window.addEventListener('beforeunload', () => {
            if (bufferingReported) sendBuffering(false);
        });
        openPopup();
    }

    function buildHref(serverUrl) {
        const origin = new URL(serverUrl, window.location.href).origin;
        const runnerUrl = new URL(
            '/static/js/bookmarklet.js?run=1&v=20260808-short',
            origin,
        ).href;
        const loadErrorMessage = '该网页阻止了助手脚本，请改用浏览器插件兼容模式。';
        return [
            'javascript:(function(){',
            'if(window.__TW_BOOKMARK_COMPANION__&&window.__TW_BOOKMARK_COMPANION__.open){',
            'window.__TW_BOOKMARK_COMPANION__.open();return}',
            'var old=document.getElementById("tw-bookmark-loader");',
            'if(old){old.remove()}',
            'var script=document.createElement("script");',
            'script.id="tw-bookmark-loader";',
            `script.src=${JSON.stringify(runnerUrl)};`,
            'script.async=true;',
            `script.onerror=function(){alert(${JSON.stringify(loadErrorMessage)})};`,
            '(document.head||document.documentElement).appendChild(script)',
            '})()',
        ].join('');
    }

    window.TogetherWatchBookmarklet = { buildHref };

    const currentScriptUrl = document.currentScript?.src;
    if (currentScriptUrl) {
        const currentScript = new URL(currentScriptUrl);
        if (currentScript.searchParams.get('run') === '1') {
            startTogetherWatchBookmark(currentScript.origin);
        }
    }
})();
