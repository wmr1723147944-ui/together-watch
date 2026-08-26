(() => {
    let player = null;
    let playerEvents = null;
    let remoteGuardUntil = 0;
    let localInteractionUntil = 0;
    let bufferingTimer = null;
    let bufferingReported = false;
    let serverClockOffset = 0;
    let resumeTimer = null;
    let localVolume = 1;
    let lastRoomStateRequestAt = 0;
    const playerBridgeId = crypto.randomUUID();
    let chatUi = null;
    const chatState = {
        connected: false,
        room: '',
        username: '',
        online: null,
        unread: 0,
    };

    function notify(message) {
        try {
            const pending = chrome.runtime.sendMessage(message);
            pending?.catch?.(() => {});
        } catch (_error) {
            // The extension may be reloading while the content script is still alive.
        }
    }

    function report(status, detail) {
        notify({
            type: 'tw_companion_status',
            status,
            detail,
        });
    }

    function isTopFrame() {
        return window.top === window;
    }

    function messageTime(value) {
        const date = new Date(Number(value) || Date.now());
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function updateChatHeader() {
        if (!chatUi) return;
        const roomLabel = chatState.room ? `房间 ${chatState.room}` : '一起看聊天室';
        const onlineLabel = Number.isFinite(chatState.online)
            ? ` · ${chatState.online} 人在线`
            : '';
        chatUi.room.textContent = `${roomLabel}${onlineLabel}`;
        chatUi.connection.textContent = chatState.connected ? '已连接' : '连接中';
        chatUi.connection.classList.toggle('online', chatState.connected);
        chatUi.input.disabled = !chatState.connected;
        chatUi.send.disabled = !chatState.connected;
        chatUi.input.placeholder = chatState.connected ? '说点什么…' : '正在连接聊天室…';
        chatUi.unread.textContent = chatState.unread > 99 ? '99+' : String(chatState.unread);
        chatUi.unread.hidden = chatState.unread === 0;
    }

    function addChatMessage({ username = '', message = '', sent_at: sentAt } = {}, system = false) {
        if (!isTopFrame() || !message) return;
        const ui = ensureChatOverlay();
        if (!ui) return;

        const item = document.createElement('div');
        item.className = system
            ? 'message system'
            : `message ${username === chatState.username ? 'mine' : ''}`;
        if (!system) {
            const meta = document.createElement('div');
            meta.className = 'message-meta';
            const author = document.createElement('strong');
            author.textContent = username || '房间成员';
            const time = document.createElement('span');
            time.textContent = messageTime(sentAt);
            meta.append(author, time);
            item.appendChild(meta);
        }
        const body = document.createElement('div');
        body.className = 'message-body';
        body.textContent = String(message).slice(0, 500);
        item.appendChild(body);
        ui.messages.appendChild(item);
        while (ui.messages.children.length > 80) {
            ui.messages.firstElementChild?.remove();
        }
        ui.messages.scrollTop = ui.messages.scrollHeight;

        if (ui.host.dataset.collapsed === 'true' && username !== chatState.username) {
            chatState.unread += 1;
            updateChatHeader();
        }
    }

    function setChatConnection(payload = {}) {
        const wasConnected = chatState.connected;
        chatState.connected = Boolean(payload.connected);
        chatState.room = String(payload.room || chatState.room || '');
        chatState.username = String(payload.username || chatState.username || '观影成员');
        const ui = ensureChatOverlay(payload);
        updateChatHeader();
        if (ui && chatState.connected && !wasConnected) {
            addChatMessage({ message: '聊天室已连接，可以边看边聊。' }, true);
        } else if (ui && !chatState.connected && wasConnected) {
            addChatMessage({ message: '连接暂时中断，正在自动重连…' }, true);
        }
    }

    function ensureChatOverlay(config = {}) {
        if (!isTopFrame()) return null;
        chatState.room = String(config.room || chatState.room || '');
        chatState.username = String(config.username || chatState.username || '观影成员');
        if (chatUi) {
            updateChatHeader();
            return chatUi;
        }

        const host = document.createElement('div');
        host.id = 'together-watch-chat-overlay';
        host.dataset.collapsed = 'false';
        host.style.cssText = [
            'position:fixed',
            'right:16px',
            'bottom:16px',
            'z-index:2147483647',
            'pointer-events:none',
        ].join(';');
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
                * { box-sizing: border-box; }
                button, input { font: inherit; }
                .panel, .launcher { pointer-events: auto; }
                .panel {
                    width: min(350px, calc(100vw - 24px));
                    height: min(440px, calc(100vh - 96px));
                    display: grid;
                    grid-template-rows: auto 1fr auto auto;
                    overflow: hidden;
                    border: 1px solid rgba(255,255,255,.16);
                    border-radius: 16px;
                    color: #f7f7fb;
                    background: rgba(18,18,24,.94);
                    box-shadow: 0 18px 60px rgba(0,0,0,.48);
                    backdrop-filter: blur(18px);
                }
                .header { display:flex; align-items:center; gap:10px; padding:12px 13px; border-bottom:1px solid rgba(255,255,255,.1); }
                .title { min-width:0; flex:1; }
                .title strong, .room { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .title strong { font-size:14px; }
                .room { margin-top:2px; color:#a9a9b8; font-size:12px; }
                .connection { display:flex; align-items:center; gap:5px; color:#f2b84b; font-size:12px; }
                .connection::before { content:""; width:7px; height:7px; border-radius:50%; background:currentColor; }
                .connection.online { color:#49d98a; }
                .minimize { width:28px; height:28px; border:0; border-radius:8px; color:#ddd; background:rgba(255,255,255,.08); cursor:pointer; }
                .messages { min-height:0; overflow:auto; padding:12px; overscroll-behavior:contain; }
                .message { width:fit-content; max-width:88%; margin:0 0 10px; padding:8px 10px; border-radius:12px 12px 12px 4px; background:#2c2c38; }
                .message.mine { margin-left:auto; border-radius:12px 12px 4px 12px; background:#5a46db; }
                .message.system { max-width:100%; margin:4px auto 10px; padding:5px 9px; border-radius:999px; color:#bfc0cd; background:rgba(255,255,255,.07); font-size:12px; text-align:center; }
                .message-meta { display:flex; justify-content:space-between; gap:12px; margin-bottom:3px; color:#c9c9d4; font-size:11px; }
                .message-meta strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .message-body { color:#fff; font-size:13px; line-height:1.45; overflow-wrap:anywhere; white-space:pre-wrap; }
                .composer { display:grid; grid-template-columns:1fr auto; gap:8px; padding:10px; border-top:1px solid rgba(255,255,255,.1); }
                .composer input { min-width:0; height:38px; padding:0 11px; border:1px solid rgba(255,255,255,.14); border-radius:10px; outline:none; color:#fff; background:rgba(255,255,255,.07); }
                .composer input:focus { border-color:#806df0; box-shadow:0 0 0 3px rgba(128,109,240,.18); }
                .composer button { height:38px; padding:0 14px; border:0; border-radius:10px; color:#fff; background:#6c55e8; cursor:pointer; }
                .composer button:disabled, .composer input:disabled { cursor:not-allowed; opacity:.55; }
                .privacy { padding:0 12px 10px; color:#858594; font-size:10px; text-align:center; }
                .launcher { display:none; position:relative; align-items:center; gap:8px; padding:10px 13px; border:1px solid rgba(255,255,255,.16); border-radius:999px; color:#fff; background:rgba(18,18,24,.94); box-shadow:0 12px 35px rgba(0,0,0,.42); cursor:pointer; }
                .launcher-dot { width:8px; height:8px; border-radius:50%; background:#f2b84b; }
                .launcher-dot.online { background:#49d98a; }
                .unread { min-width:19px; height:19px; padding:0 5px; border-radius:999px; color:#fff; background:#e34d69; font-size:11px; line-height:19px; text-align:center; }
                :host([data-collapsed="true"]) .panel { display:none; }
                :host([data-collapsed="true"]) .launcher { display:flex; }
                @media (max-width: 560px) {
                    .panel { width:calc(100vw - 20px); height:min(52vh, 430px); }
                    :host { right:10px; bottom:10px; }
                }
            </style>
            <section class="panel" aria-label="Together Watch 聊天室">
                <header class="header">
                    <div class="title"><strong>💬 一起看聊天室</strong><span class="room"></span></div>
                    <span class="connection">连接中</span>
                    <button class="minimize" type="button" aria-label="收起聊天室">−</button>
                </header>
                <div class="messages" aria-live="polite"></div>
                <div class="composer">
                    <input type="text" maxlength="500" placeholder="正在连接聊天室…" aria-label="聊天消息">
                    <button type="button" disabled>发送</button>
                </div>
                <div class="privacy">只同步播放状态与聊天消息，不读取账号、Cookie 或视频地址</div>
            </section>
            <button class="launcher" type="button" aria-label="展开聊天室">
                <span class="launcher-dot"></span><span>一起看聊天室</span><span class="unread" hidden>0</span>
            </button>
        `;

        const input = shadow.querySelector('.composer input');
        const send = shadow.querySelector('.composer button');
        const submit = () => {
            const message = input.value.trim();
            if (!message || !chatState.connected) return;
            notify({ type: 'tw_chat_message', payload: { message } });
            input.value = '';
            input.focus();
        };
        send.addEventListener('click', submit);
        input.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Enter' && !event.isComposing) {
                event.preventDefault();
                submit();
            }
        });
        for (const eventName of ['keyup', 'keypress']) {
            input.addEventListener(eventName, event => event.stopPropagation());
        }
        shadow.querySelector('.minimize').addEventListener('click', () => {
            host.dataset.collapsed = 'true';
        });
        shadow.querySelector('.launcher').addEventListener('click', () => {
            host.dataset.collapsed = 'false';
            chatState.unread = 0;
            updateChatHeader();
            input.focus();
        });

        document.documentElement.appendChild(host);
        chatUi = {
            host,
            room: shadow.querySelector('.room'),
            connection: shadow.querySelector('.connection'),
            messages: shadow.querySelector('.messages'),
            input,
            send,
            launcherDot: shadow.querySelector('.launcher-dot'),
            unread: shadow.querySelector('.unread'),
        };
        updateChatHeader();
        return chatUi;
    }

    function decodeInviteConfig() {
        try {
            const match = location.hash.match(/^#tw=([A-Za-z0-9_-]+)$/);
            if (!match) return null;
            const base64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
            const bytes = Uint8Array.from(
                atob(padded),
                character => character.charCodeAt(0),
            );
            const config = JSON.parse(new TextDecoder().decode(bytes));
            return config?.server && config?.room ? config : null;
        } catch (_error) {
            return null;
        }
    }

    function acceptRoomInvite() {
        const config = decodeInviteConfig();
        if (!config) return;
        notify({ type: 'tw_accept_invite', config });
        report('finding', `已识别房间 ${config.room}，正在自动连接`);
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

    function playerMetrics(video) {
        const rect = video?.getBoundingClientRect?.();
        const width = Math.max(0, Number(rect?.width) || 0);
        const height = Math.max(0, Number(rect?.height) || 0);
        const visible = document.visibilityState === 'visible'
            && Boolean(rect)
            && rect.bottom > 0
            && rect.right > 0
            && rect.top < window.innerHeight
            && rect.left < window.innerWidth;
        return {
            area: Math.round(width * height),
            visible,
            playing: Boolean(video && !video.paused && !video.ended),
            topFrame: isTopFrame(),
            duration: Number.isFinite(Number(video?.duration)) ? Number(video.duration) : 0,
            bridgeId: playerBridgeId,
        };
    }

    function playerLayout(video) {
        const rect = video?.getBoundingClientRect?.();
        if (!rect) return null;
        const viewportWidth = Math.max(0, Number(window.innerWidth) || 0);
        const viewportHeight = Math.max(0, Number(window.innerHeight) || 0);
        const left = Math.max(0, Math.min(viewportWidth, Number(rect.left) || 0));
        const top = Math.max(0, Math.min(viewportHeight, Number(rect.top) || 0));
        const right = Math.max(left, Math.min(viewportWidth, Number(rect.right) || 0));
        const bottom = Math.max(top, Math.min(viewportHeight, Number(rect.bottom) || 0));
        if (right - left < 80 || bottom - top < 45) return null;
        return {
            viewport_width: viewportWidth,
            viewport_height: viewportHeight,
            left,
            top,
            width: right - left,
            height: bottom - top,
        };
    }

    function forwardPlayerLayout(layout, bridgeId = playerBridgeId) {
        if (!layout) return;
        if (isTopFrame()) {
            notify({
                type: 'tw_player_layout_bridge',
                bridgeId,
                layout,
            });
            return;
        }
        window.parent.postMessage({
            channel: 'tw-extension-player-layout',
            bridgeId,
            layout,
        }, '*');
    }

    window.addEventListener('message', event => {
        const data = event.data;
        if (data?.channel !== 'tw-extension-player-layout' || !data.layout) return;
        const frame = Array.from(document.querySelectorAll('iframe'))
            .find(item => item.contentWindow === event.source);
        if (!frame) return;
        const frameRect = frame.getBoundingClientRect();
        const childViewportWidth = Math.max(1, Number(data.layout.viewport_width) || 1);
        const childViewportHeight = Math.max(1, Number(data.layout.viewport_height) || 1);
        const scaleX = frame.clientWidth > 0
            ? frameRect.width / frame.clientWidth
            : frameRect.width / childViewportWidth;
        const scaleY = frame.clientHeight > 0
            ? frameRect.height / frame.clientHeight
            : frameRect.height / childViewportHeight;
        forwardPlayerLayout({
            viewport_width: Math.max(0, Number(window.innerWidth) || 0),
            viewport_height: Math.max(0, Number(window.innerHeight) || 0),
            left: frameRect.left + frame.clientLeft + Number(data.layout.left || 0) * scaleX,
            top: frameRect.top + frame.clientTop + Number(data.layout.top || 0) * scaleY,
            width: Number(data.layout.width || 0) * scaleX,
            height: Number(data.layout.height || 0) * scaleY,
        }, data.bridgeId);
    });

    function emit(type, extra = {}) {
        if (!player || Date.now() < remoteGuardUntil) return;
        localInteractionUntil = Date.now() + 2500;
        notify({
            type: 'tw_video_event',
            player: playerMetrics(player),
            payload: {
                type,
                time: Number.isFinite(player.currentTime) ? player.currentTime : 0,
                ...extra,
            },
        });
        sendSnapshot(true);
    }

    function sendSnapshot(recentInteraction = false) {
        if (!player) return;
        notify({
            type: 'tw_player_snapshot',
            player: playerMetrics(player),
            payload: {
                time: Number(player.currentTime) || 0,
                duration: Number.isFinite(Number(player.duration)) ? Number(player.duration) : 0,
                playing: !player.paused,
                speed: Number(player.playbackRate) || 1,
                readyState: Number(player.readyState) || 0,
                recent_interaction: recentInteraction || Date.now() < localInteractionUntil,
            },
        });
        forwardPlayerLayout(playerLayout(player));
    }

    document.addEventListener('pointerdown', event => {
        if (!player || Date.now() < remoteGuardUntil) return;
        if (chatUi?.host && event.composedPath().includes(chatUi.host)) return;
        const rect = player.getBoundingClientRect();
        if (
            event.clientX >= rect.left
            && event.clientX <= rect.right
            && event.clientY >= rect.top
            && event.clientY <= rect.bottom
        ) {
            localInteractionUntil = Date.now() + 5000;
        }
    }, true);
    document.addEventListener('keydown', event => {
        if (!player || Date.now() < remoteGuardUntil) return;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '')) return;
        if ([' ', 'ArrowLeft', 'ArrowRight', 'j', 'k', 'l'].includes(event.key)) {
            localInteractionUntil = Date.now() + 5000;
        }
    }, true);

    function sendBuffering(active) {
        if (active) {
            report('finding', '当前设备缓冲中，其他成员继续播放');
            return;
        }
        report('connected', '缓冲已恢复，正在追赶房间进度');
        requestRoomState();
    }

    function requestRoomState() {
        const now = Date.now();
        if (now - lastRoomStateRequestAt < 500) return;
        lastRoomStateRequestAt = now;
        notify({ type: 'tw_request_room_state' });
    }

    function clearBuffering(force = false) {
        window.clearTimeout(bufferingTimer);
        if (!bufferingReported || !force) return;
        bufferingReported = false;
        sendBuffering(false);
    }

    function bindPlayer(nextPlayer) {
        if (player === nextPlayer) return;
        playerEvents?.abort();
        playerEvents = new AbortController();
        player = nextPlayer;
        try {
            player.volume = localVolume;
            player.muted = localVolume === 0;
        } catch (_error) {
            // Some mobile browsers only expose the hardware volume.
        }
        const options = { signal: playerEvents.signal };
        player.addEventListener('play', () => emit('play'), options);
        player.addEventListener('pause', () => {
            if (!player.seeking) emit('pause');
        }, options);
        player.addEventListener('seeking', () => {
            if (Date.now() >= remoteGuardUntil) {
                localInteractionUntil = Date.now() + 3000;
            }
        }, options);
        player.addEventListener('seeked', () => emit('seek'), options);
        player.addEventListener('ratechange', () => {
            emit('speed', { speed: Number(player.playbackRate) || 1 });
        }, options);
        player.addEventListener('waiting', () => {
            window.clearTimeout(bufferingTimer);
            bufferingTimer = window.setTimeout(() => {
                if (!player.paused && player.readyState < 3 && !bufferingReported) {
                    bufferingReported = true;
                    sendBuffering(true);
                }
            }, 3500);
        }, options);
        for (const eventName of ['playing', 'canplay', 'canplaythrough']) {
            player.addEventListener(eventName, () => clearBuffering(true), options);
        }
        report('finding', '已找到官方页面播放器');
        notify({ type: 'tw_player_ready', player: playerMetrics(player) });
        sendSnapshot();
        for (const delay of [1000, 5000]) {
            window.setTimeout(() => {
                if (player === nextPlayer) {
                    notify({ type: 'tw_player_ready', player: playerMetrics(player) });
                }
            }, delay);
        }
    }

    function estimatedServerNow() {
        return Date.now() / 1000 + serverClockOffset;
    }

    function expectedPosition(state) {
        let position = Number(state?.time) || 0;
        if (state?.playing && state?.server_time) {
            position += Math.max(0, estimatedServerNow() - Number(state.server_time))
                * (Number(state.speed) || 1);
        }
        return Math.max(0, position);
    }

    function applyState(state, { correctionThreshold = 0.75 } = {}) {
        if (!player || !state) return;
        remoteGuardUntil = Date.now() + 900;
        const position = expectedPosition(state);
        if (Math.abs((Number(player.currentTime) || 0) - position) > correctionThreshold) {
            try {
                player.currentTime = position;
            } catch (_error) {
                // Some players reject seeks until metadata is ready.
            }
        }
        const speed = Number(state.speed);
        if (Number.isFinite(speed) && speed >= 0.25 && speed <= 4) {
            player.playbackRate = speed;
        }
        if (state.playing) {
            player.play().catch(() => {});
        } else if (!player.paused) {
            player.pause();
        }
    }

    function handleEvent(eventName, payload) {
        if (eventName === 'companion_connection') {
            setChatConnection(payload);
            if (chatUi) {
                chatUi.launcherDot.classList.toggle('online', chatState.connected);
            }
            return;
        }
        if (eventName === 'chat_message') {
            addChatMessage(payload);
            return;
        }
        if (eventName === 'status') {
            addChatMessage({ message: payload?.msg || '' }, true);
            return;
        }
        if (eventName === 'presence') {
            chatState.online = Number(payload?.count);
            updateChatHeader();
            return;
        }
        if (eventName === 'app_error') {
            addChatMessage({ message: payload?.message || '聊天室操作失败' }, true);
            return;
        }
        if (eventName === 'companion_command') {
            if (payload?.command !== 'set_volume') return;
            localVolume = Math.max(0, Math.min(1, Number(payload.value) || 0));
            if (player) {
                try {
                    player.volume = localVolume;
                    player.muted = localVolume === 0;
                } catch (_error) {
                    report('finding', '当前播放器只支持系统音量控制');
                }
            }
            return;
        }
        window.clearTimeout(resumeTimer);
        if (eventName === 'room_state') {
            if (Date.now() < localInteractionUntil) return;
            const resumeAt = Number(payload?.resume_at);
            if (
                payload?.playing
                && Number.isFinite(resumeAt)
                && resumeAt > estimatedServerNow()
            ) {
                applyState({ ...payload, playing: false }, { correctionThreshold: 2.0 });
                const delay = Math.max(0, (resumeAt - estimatedServerNow()) * 1000);
                resumeTimer = window.setTimeout(() => {
                    applyState({
                        ...payload,
                        server_time: resumeAt,
                        resume_at: null,
                    }, { correctionThreshold: 2.0 });
                }, delay);
                return;
            }
            applyState(payload, { correctionThreshold: 2.0 });
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
                const delay = Math.max(0, (resumeAt - estimatedServerNow()) * 1000);
                resumeTimer = window.setTimeout(() => {
                    applyState({
                        ...pausedState,
                        playing: true,
                        server_time: resumeAt,
                    });
                }, delay);
            }
            return;
        }
        if (eventName !== 'sync_video') return;
        const state = {
            time: payload?.time,
            speed: payload?.speed || player?.playbackRate || 1,
            server_time: payload?.server_time,
            playing: typeof payload?.playing === 'boolean'
                ? payload.playing
                : payload?.type === 'play',
        };
        if (payload?.type === 'pause' || payload?.type === 'seek') {
            state.playing = typeof payload?.playing === 'boolean'
                ? payload.playing
                : payload.type === 'seek' ? !player?.paused : false;
        }
        if (payload?.type === 'speed') {
            state.playing = typeof payload?.playing === 'boolean'
                ? payload.playing
                : !player?.paused;
        }
        if (['play', 'pause', 'seek', 'speed'].includes(payload?.type)) {
            applyState(state);
        }
    }

    function refreshPlayer() {
        const nextPlayer = findPrimaryVideo();
        if (nextPlayer && nextPlayer !== player) {
            bindPlayer(nextPlayer);
        } else if (!nextPlayer) {
            report('finding', '正在等待官方页面播放器');
        }
    }

    chrome.runtime.onMessage.addListener(message => {
        if (message?.type === 'tw_room_event') {
            serverClockOffset = Number(message.serverClockOffset) || 0;
            handleEvent(message.eventName, message.payload);
            return;
        }
        if (message?.type === 'tw_set_local_volume') {
            handleEvent('companion_command', {
                command: 'set_volume',
                value: message.value,
            });
            return;
        }
        if (message?.type === 'tw_clear_invite_hash' && location.hash.startsWith('#tw=')) {
            history.replaceState(null, '', `${location.pathname}${location.search}`);
        }
    });

    const inviteConfig = decodeInviteConfig();
    if (isTopFrame()) {
        if (inviteConfig) ensureChatOverlay(inviteConfig);
        notify({ type: 'tw_overlay_ready' });
    }
    acceptRoomInvite();
    refreshPlayer();
    window.setInterval(refreshPlayer, 2000);
    window.setInterval(sendSnapshot, 3000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') requestRoomState();
    });
    window.addEventListener('focus', requestRoomState);
    window.addEventListener('pageshow', requestRoomState);
    window.addEventListener('online', requestRoomState);
    window.addEventListener('beforeunload', () => {
        notify({ type: 'tw_player_gone' });
    });
})();
