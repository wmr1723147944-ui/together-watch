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
        let lastPlayerReason = '正在寻找播放器';
        let returnedFocus = false;
        let lastPlayerSample = null;
        const overlayState = {
            room: '',
            username: '',
            online: null,
            unread: 0,
        };

        const host = document.createElement('div');
        host.id = 'together-watch-room-overlay';
        host.dataset.collapsed = 'false';
        host.style.cssText = [
            'position:fixed',
            'right:16px',
            'bottom:16px',
            'z-index:2147483647',
            'pointer-events:none',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif',
        ].join(';');
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                * { box-sizing:border-box; }
                button, input { font:inherit; }
                .panel, .launcher { pointer-events:auto; }
                .panel { width:min(350px,calc(100vw - 24px)); height:min(470px,calc(100vh - 92px)); display:grid; grid-template-rows:auto auto 1fr auto auto; overflow:hidden; border:1px solid rgba(255,255,255,.16); border-radius:16px; color:#f7f7fb; background:rgba(18,18,24,.95); box-shadow:0 18px 60px rgba(0,0,0,.5); backdrop-filter:blur(18px); }
                .header { display:flex; align-items:center; gap:10px; padding:12px 13px; border-bottom:1px solid rgba(255,255,255,.1); }
                .title { min-width:0; flex:1; }
                .title strong, .room { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .title strong { font-size:14px; }
                .room { margin-top:2px; color:#a9a9b8; font-size:11px; }
                .connection { display:flex; align-items:center; gap:5px; color:#f2b84b; font-size:11px; white-space:nowrap; }
                .connection::before { content:""; width:7px; height:7px; border-radius:50%; background:currentColor; }
                .connection.online { color:#49d98a; }
                .icon-button { width:29px; height:29px; border:0; border-radius:8px; color:#ddd; background:rgba(255,255,255,.08); cursor:pointer; }
                .summary { display:grid; grid-template-columns:1fr auto; gap:6px 10px; padding:9px 12px; border-bottom:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.035); }
                .sync { min-width:0; overflow:hidden; color:#dedee8; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
                .online { color:#9c9cac; font-size:11px; white-space:nowrap; }
                .messages { min-height:0; overflow:auto; padding:12px; overscroll-behavior:contain; }
                .message { width:fit-content; max-width:88%; margin:0 0 10px; padding:8px 10px; border-radius:12px 12px 12px 4px; background:#2c2c38; }
                .message.mine { margin-left:auto; border-radius:12px 12px 4px 12px; background:#5a46db; }
                .message.system { max-width:100%; margin:4px auto 10px; padding:5px 9px; border-radius:999px; color:#bfc0cd; background:rgba(255,255,255,.07); font-size:11px; text-align:center; }
                .message-meta { display:flex; justify-content:space-between; gap:12px; margin-bottom:3px; color:#c9c9d4; font-size:10px; }
                .message-meta strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .message-body { color:#fff; font-size:13px; line-height:1.45; overflow-wrap:anywhere; white-space:pre-wrap; }
                .composer { display:grid; grid-template-columns:1fr auto; gap:8px; padding:10px; border-top:1px solid rgba(255,255,255,.1); }
                .composer input { min-width:0; height:38px; padding:0 11px; border:1px solid rgba(255,255,255,.14); border-radius:10px; outline:none; color:#fff; background:rgba(255,255,255,.07); }
                .composer input:focus { border-color:#806df0; box-shadow:0 0 0 3px rgba(128,109,240,.18); }
                .composer button { height:38px; padding:0 14px; border:0; border-radius:10px; color:#fff; background:#6c55e8; cursor:pointer; }
                .composer button:disabled, .composer input:disabled { cursor:not-allowed; opacity:.55; }
                .footer { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:0 11px 10px; color:#858594; font-size:9px; }
                .helper-button { border:0; padding:4px 7px; border-radius:7px; color:#bcbccc; background:rgba(255,255,255,.07); cursor:pointer; }
                .launcher { display:none; position:relative; align-items:center; gap:8px; max-width:min(340px,calc(100vw - 24px)); min-height:42px; padding:9px 13px; border:1px solid rgba(255,255,255,.2); border-radius:999px; color:#fff; background:rgba(20,20,28,.95); box-shadow:0 12px 34px rgba(0,0,0,.42); font-weight:600; font-size:12px; cursor:pointer; }
                .launcher-dot { width:9px; height:9px; flex:0 0 auto; border-radius:50%; background:#e6a52f; }
                .launcher-dot.online { background:#3dd985; box-shadow:0 0 0 4px rgba(61,217,133,.16); }
                .launcher-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .unread { min-width:19px; height:19px; padding:0 5px; border-radius:999px; color:#fff; background:#e34d69; font-size:10px; line-height:19px; text-align:center; }
                :host([data-collapsed="true"]) .panel { display:none; }
                :host([data-collapsed="true"]) .launcher { display:flex; }
                @media (max-width:560px) { .panel { width:calc(100vw - 20px); height:min(56vh,450px); } }
            </style>
            <section class="panel" aria-label="Together Watch 房间侧栏">
                <header class="header">
                    <div class="title"><strong>💬 一起看房间</strong><span class="room">正在读取房间</span></div>
                    <span class="connection">连接中</span>
                    <button class="icon-button minimize" type="button" aria-label="收起房间侧栏">−</button>
                </header>
                <div class="summary"><span class="sync">正在寻找播放器</span><span class="online">在线人数获取中</span></div>
                <div class="messages" aria-live="polite"><div class="message system">助手正在后台建立房间连接…</div></div>
                <div class="composer">
                    <input type="text" maxlength="500" placeholder="连接后可以聊天" aria-label="聊天消息" disabled>
                    <button type="button" disabled>发送</button>
                </div>
                <div class="footer"><span>只同步状态和聊天，不读取账号或视频地址</span><button class="helper-button" type="button">后台助手</button></div>
            </section>
            <button class="launcher" type="button" title="展开一起看房间">
                <span class="launcher-dot"></span><span class="launcher-label">一起看：正在连接</span><span class="unread" hidden>0</span>
            </button>
        `;
        document.documentElement.appendChild(host);
        const statusButton = shadow.querySelector('.launcher');
        const statusDot = shadow.querySelector('.launcher-dot');
        const statusLabel = shadow.querySelector('.launcher-label');
        const connectionLabel = shadow.querySelector('.connection');
        const roomLabel = shadow.querySelector('.room');
        const onlineLabel = shadow.querySelector('.online');
        const syncLabel = shadow.querySelector('.sync');
        const overlayMessages = shadow.querySelector('.messages');
        const overlayInput = shadow.querySelector('.composer input');
        const overlaySend = shadow.querySelector('.composer button');
        const unreadBadge = shadow.querySelector('.unread');

        function updateOverlayHeader() {
            roomLabel.textContent = overlayState.room
                ? `房间 ${overlayState.room}`
                : '正在读取房间';
            onlineLabel.textContent = Number.isFinite(overlayState.online)
                ? `${overlayState.online} 人在线`
                : '在线人数获取中';
            connectionLabel.textContent = connected ? '已连接' : '连接中';
            connectionLabel.classList.toggle('online', connected);
            overlayInput.disabled = !connected;
            overlaySend.disabled = !connected;
            overlayInput.placeholder = connected ? '说点什么…' : '连接后可以聊天';
            unreadBadge.textContent = overlayState.unread > 99
                ? '99+'
                : String(overlayState.unread);
            unreadBadge.hidden = overlayState.unread === 0;
        }

        function messageTime(value) {
            const date = new Date(Number(value) || Date.now());
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        function addOverlayMessage(payload = {}, system = false) {
            const text = String(payload.message || payload.msg || '').trim().slice(0, 500);
            if (!text) return;
            const item = document.createElement('div');
            item.className = system
                ? 'message system'
                : `message ${payload.username === overlayState.username ? 'mine' : ''}`;
            if (!system) {
                const meta = document.createElement('div');
                meta.className = 'message-meta';
                const author = document.createElement('strong');
                author.textContent = payload.username || '房间成员';
                const time = document.createElement('span');
                time.textContent = messageTime(payload.sent_at);
                meta.append(author, time);
                item.appendChild(meta);
            }
            const body = document.createElement('div');
            body.className = 'message-body';
            body.textContent = text;
            item.appendChild(body);
            overlayMessages.appendChild(item);
            while (overlayMessages.children.length > 80) {
                overlayMessages.firstElementChild?.remove();
            }
            overlayMessages.scrollTop = overlayMessages.scrollHeight;
            if (host.dataset.collapsed === 'true' && payload.username !== overlayState.username) {
                overlayState.unread += 1;
                updateOverlayHeader();
            }
        }

        function setStatus(text, online = connected) {
            statusLabel.textContent = `一起看：${text}`;
            syncLabel.textContent = text;
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

        function sendOverlayChat() {
            const message = overlayInput.value.trim();
            if (!message || !connected) return;
            postToCompanion('chat_submit', { message });
            overlayInput.value = '';
            overlayInput.focus();
        }

        overlaySend.addEventListener('click', sendOverlayChat);
        overlayInput.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Enter' && !event.isComposing) {
                event.preventDefault();
                sendOverlayChat();
            }
        });
        for (const eventName of ['keyup', 'keypress']) {
            overlayInput.addEventListener(eventName, event => event.stopPropagation());
        }
        shadow.querySelector('.minimize').addEventListener('click', () => {
            host.dataset.collapsed = 'true';
        });
        statusButton.addEventListener('click', () => {
            host.dataset.collapsed = 'false';
            overlayState.unread = 0;
            updateOverlayHeader();
            if (!popupWindow || popupWindow.closed) openPopup();
            else overlayInput.focus();
        });
        shadow.querySelector('.helper-button').addEventListener('click', openPopup);
        updateOverlayHeader();

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

        function inspectPlayers() {
            const videos = [];
            const visitedDocuments = new Set();
            let frameCount = 0;
            let blockedFrameCount = 0;

            function scanDocument(currentDocument) {
                if (!currentDocument || visitedDocuments.has(currentDocument)) return;
                visitedDocuments.add(currentDocument);
                videos.push(...currentDocument.querySelectorAll('video'));

                for (const frame of currentDocument.querySelectorAll('iframe')) {
                    frameCount += 1;
                    try {
                        const childDocument = frame.contentWindow?.document;
                        if (!childDocument) {
                            blockedFrameCount += 1;
                            continue;
                        }
                        scanDocument(childDocument);
                    } catch (_error) {
                        blockedFrameCount += 1;
                    }
                }
            }

            scanDocument(document);
            const primaryVideo = videos
                .filter(video => {
                    const rect = video.getBoundingClientRect();
                    return rect.width >= 160 && rect.height >= 90;
                })
                .sort((left, right) => {
                    const a = left.getBoundingClientRect();
                    const b = right.getBoundingClientRect();
                    return (b.width * b.height) - (a.width * a.height);
                })[0] || null;

            return { primaryVideo, frameCount, blockedFrameCount };
        }

        function emitPlayerEvent(type, extra = {}) {
            if (!player || Date.now() < remoteGuardUntil) return;
            postToCompanion('player_event', {
                type,
                time: Number.isFinite(player.currentTime) ? player.currentTime : 0,
                ...extra,
            });
            lastPlayerSample = readPlayerSample();
        }

        function readPlayerSample() {
            if (!player) return null;
            return {
                sampledAt: performance.now(),
                time: Number(player.currentTime) || 0,
                paused: Boolean(player.paused),
                speed: Number(player.playbackRate) || 1,
            };
        }

        function monitorPlayerState() {
            const current = readPlayerSample();
            if (!current) {
                lastPlayerSample = null;
                return;
            }
            const previous = lastPlayerSample;
            lastPlayerSample = current;
            if (!previous || Date.now() < remoteGuardUntil) return;

            if (current.paused !== previous.paused) {
                emitPlayerEvent(current.paused ? 'pause' : 'play');
                return;
            }
            if (Math.abs(current.speed - previous.speed) > 0.01) {
                emitPlayerEvent('speed', { speed: current.speed });
                return;
            }
            const elapsed = Math.max(0, (current.sampledAt - previous.sampledAt) / 1000);
            const expected = previous.paused
                ? previous.time
                : previous.time + elapsed * previous.speed;
            if (Math.abs(current.time - expected) > 1.1) {
                emitPlayerEvent('seek');
            }
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
            lastPlayerReason = '';
            lastPlayerSample = readPlayerSample();
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
            const inspection = inspectPlayers();
            const nextPlayer = inspection.primaryVideo;
            if (nextPlayer && nextPlayer !== player) {
                bindPlayer(nextPlayer);
            } else if (!nextPlayer) {
                player = null;
                lastPlayerSample = null;
                const reason = inspection.blockedFrameCount > 0
                    ? `检测到 ${inspection.blockedFrameCount} 个跨域播放器框架，书签无权读取`
                    : inspection.frameCount > 0
                        ? '已检查页面框架，仍未找到 HTML5 播放器'
                        : '未找到 HTML5 播放器';
                lastPlayerReason = reason;
                setStatus(reason, false);
                postToCompanion('target_ready', { playerReady: false, reason });
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
                postToCompanion('hello', {
                    playerReady: Boolean(player),
                    reason: player ? '' : lastPlayerReason,
                });
                return;
            }
            if (data.type === 'connection') {
                connected = Boolean(data.payload?.connected);
                overlayState.room = String(data.payload?.room || overlayState.room || '');
                overlayState.username = String(
                    data.payload?.username || overlayState.username || '观影成员',
                );
                if (Number.isFinite(Number(data.payload?.online))) {
                    overlayState.online = Number(data.payload.online);
                }
                updateOverlayHeader();
                setStatus(
                    connected
                        ? (player ? '播放器与房间已连接' : lastPlayerReason)
                        : '房间连接中断，点这里重试',
                    connected && Boolean(player),
                );
                if (connected && !returnedFocus) {
                    returnedFocus = true;
                    window.setTimeout(() => {
                        popupWindow?.blur();
                        window.focus();
                    }, 180);
                }
                return;
            }
            if (data.type === 'overlay_state') {
                connected = Boolean(data.payload?.connected);
                overlayState.room = String(data.payload?.room || overlayState.room || '');
                overlayState.username = String(
                    data.payload?.username || overlayState.username || '观影成员',
                );
                overlayState.online = Number.isFinite(Number(data.payload?.online))
                    ? Number(data.payload.online)
                    : null;
                updateOverlayHeader();
                return;
            }
            if (data.type === 'chat_event') {
                addOverlayMessage(data.payload?.message || {}, Boolean(data.payload?.system));
                return;
            }
            if (data.type === 'companion_status') {
                if (!connected) connectionLabel.textContent = String(data.payload?.text || '连接中');
                return;
            }
            if (data.type === 'room_event') {
                handleRoomEvent(data.payload?.eventName, data.payload?.payload);
            }
        });

        window.__TW_BOOKMARK_COMPANION__ = {
            open: openPopup,
            refresh: refreshPlayer,
        };
        refreshPlayer();
        window.setInterval(refreshPlayer, 1800);
        window.setInterval(monitorPlayerState, 650);
        window.setInterval(() => {
            if (popupWindow && popupWindow.closed) {
                connected = false;
                returnedFocus = false;
                updateOverlayHeader();
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
            '/static/js/bookmarklet.js?run=1',
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
            `script.src=${JSON.stringify(runnerUrl)}+"&v="+Date.now();`,
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
