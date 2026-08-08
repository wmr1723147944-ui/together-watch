document.addEventListener('DOMContentLoaded', () => {
    const CHANNEL_FROM_TARGET = 'tw-bookmark-target';
    const CHANNEL_FROM_COMPANION = 'tw-bookmark-companion';
    const tokenMatch = window.location.hash.match(/^#tw=([A-Za-z0-9_-]{16,128})$/);
    const bridgeToken = tokenMatch?.[1] || '';
    const openerWindow = window.opener && !window.opener.closed ? window.opener : null;

    const statusBadge = document.getElementById('webCompanionStatus');
    const playerState = document.getElementById('webCompanionPlayerState');
    const onlineState = document.getElementById('webCompanionOnline');
    const roomInput = document.getElementById('webCompanionRoom');
    const usernameInput = document.getElementById('webCompanionUsername');
    const connectButton = document.getElementById('webCompanionConnect');
    const messages = document.getElementById('webCompanionMessages');
    const chatInput = document.getElementById('webCompanionChatInput');
    const sendButton = document.getElementById('webCompanionSend');
    const help = document.getElementById('webCompanionHelp');

    let socket = null;
    let activeRoom = '';
    let activeUsername = '';
    let clientKey = '';
    let targetReady = false;
    let serverClockOffset = 0;
    let clockSyncTimer = null;
    let roomStateTimer = null;
    let onlineCount = null;

    function readStorage(key, fallback = '') {
        try {
            return localStorage.getItem(key) || fallback;
        } catch (_error) {
            return fallback;
        }
    }

    function writeStorage(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (_error) {
            // Private browsing modes can disable persistent storage.
        }
    }

    function generateClientKey() {
        if (window.crypto?.getRandomValues) {
            return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => (
                byte.toString(16).padStart(2, '0')
            )).join('');
        }
        return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
            .padEnd(24, '0')
            .slice(0, 48);
    }

    function setStatus(kind, text) {
        statusBadge.className = `companion-status ${kind === 'connected' ? 'is-connected' : 'is-waiting'}`;
        statusBadge.textContent = text;
        postToTarget('companion_status', { kind, text });
    }

    function messageTime(value) {
        const date = new Date(Number(value) || Date.now());
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function addMessage(payload = {}, system = false) {
        const text = String(system ? payload.message || payload.msg || '' : payload.message || '')
            .trim()
            .slice(0, 500);
        if (!text) return;

        const item = document.createElement('div');
        item.className = system
            ? 'message system'
            : `message ${payload.username === activeUsername ? 'me' : ''}`;
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
        messages.appendChild(item);
        while (messages.children.length > 100) messages.firstElementChild?.remove();
        messages.scrollTop = messages.scrollHeight;
        postToTarget('chat_event', {
            system,
            message: {
                username: system ? '' : String(payload.username || '房间成员').slice(0, 32),
                message: text,
                sent_at: Number(payload.sent_at) || Date.now(),
            },
        });
    }

    function postToTarget(type, payload = {}) {
        if (!openerWindow || openerWindow.closed || !bridgeToken) return;
        openerWindow.postMessage({
            channel: CHANNEL_FROM_COMPANION,
            token: bridgeToken,
            type,
            payload,
            serverClockOffset,
        }, '*');
    }

    function updateTargetState(ready, reason = '') {
        targetReady = Boolean(ready);
        playerState.textContent = targetReady
            ? '已找到播放页中的 HTML5 视频'
            : String(reason || '正在等待播放页回应…').slice(0, 120);
    }

    function pushOverlayState() {
        postToTarget('overlay_state', {
            connected: Boolean(socket?.connected),
            room: activeRoom,
            username: activeUsername,
            online: Number.isFinite(onlineCount) ? onlineCount : null,
        });
    }

    function validateRoom(value) {
        return /^[\p{L}\p{N}_-]{4,64}$/u.test(String(value || '').trim());
    }

    function cleanUsername(value) {
        return String(value || '观影成员')
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .trim()
            .slice(0, 32) || '观影成员';
    }

    function sendClockProbe() {
        if (!socket?.connected) return;
        socket.emit('sync_ping', { room: activeRoom, client_time: Date.now() });
    }

    function forwardRoomEvent(eventName, payload) {
        postToTarget('room_event', { eventName, payload });
    }

    function disconnectSocket() {
        window.clearInterval(clockSyncTimer);
        clockSyncTimer = null;
        window.clearInterval(roomStateTimer);
        roomStateTimer = null;
        if (socket) {
            socket.removeAllListeners();
            socket.disconnect();
            socket = null;
        }
        chatInput.disabled = true;
        sendButton.disabled = true;
    }

    function connect() {
        const room = roomInput.value.trim();
        const username = cleanUsername(usernameInput.value);
        if (!validateRoom(room)) {
            setStatus('waiting', '房间号无效');
            addMessage({ message: '房间号需为 4–64 位文字、数字、下划线或短横线。' }, true);
            return;
        }
        if (typeof window.io !== 'function') {
            setStatus('waiting', '组件加载失败');
            addMessage({ message: '实时同步组件加载失败，请刷新助手窗口。' }, true);
            return;
        }

        activeRoom = room;
        activeUsername = username;
        onlineCount = null;
        onlineState.textContent = '在线人数获取中';
        clientKey = readStorage('tw_client_key');
        if (!/^[A-Za-z0-9_-]{16,96}$/.test(clientKey)) clientKey = generateClientKey();
        writeStorage('tw_last_room', activeRoom);
        writeStorage('tw_username', activeUsername);
        writeStorage('tw_client_key', clientKey);
        usernameInput.value = activeUsername;

        disconnectSocket();
        setStatus('waiting', '连接中');
        socket = window.io({ transports: ['websocket', 'polling'] });

        socket.on('connect', () => {
            socket.emit('join', {
                room: activeRoom,
                username: activeUsername,
                role: 'companion',
                client_key: clientKey,
            });
            setStatus('connected', '房间已连接');
            chatInput.disabled = false;
            sendButton.disabled = false;
            addMessage({ message: `已连接房间 ${activeRoom}` }, true);
            postToTarget('connection', {
                connected: true,
                room: activeRoom,
                username: activeUsername,
                online: onlineCount,
            });
            pushOverlayState();
            sendClockProbe();
            clockSyncTimer = window.setInterval(sendClockProbe, 10000);
            roomStateTimer = window.setInterval(() => {
                if (socket?.connected && activeRoom) {
                    socket.emit('request_room_state', { room: activeRoom });
                }
            }, 3000);
            window.setTimeout(() => {
                socket?.emit('request_room_state', { room: activeRoom });
            }, 120);
        });

        socket.on('disconnect', () => {
            setStatus('waiting', '正在重连');
            chatInput.disabled = true;
            sendButton.disabled = true;
            postToTarget('connection', { connected: false, room: activeRoom });
            pushOverlayState();
        });
        socket.on('connect_error', () => {
            setStatus('waiting', '连接失败');
            pushOverlayState();
        });
        socket.on('sync_pong', payload => {
            const receivedAt = Date.now();
            const sentAt = Number(payload?.client_time);
            const serverTime = Number(payload?.server_time);
            if (!Number.isFinite(sentAt) || !Number.isFinite(serverTime)) return;
            const sample = serverTime - (sentAt + receivedAt) / 2000;
            serverClockOffset = serverClockOffset
                ? serverClockOffset * 0.75 + sample * 0.25
                : sample;
        });

        for (const eventName of ['room_state', 'buffering_state', 'sync_video', 'companion_command']) {
            socket.on(eventName, payload => forwardRoomEvent(eventName, payload));
        }
        socket.on('chat_message', payload => addMessage(payload));
        socket.on('status', payload => addMessage(payload, true));
        socket.on('app_error', payload => addMessage(payload, true));
        socket.on('presence', payload => {
            const count = Number(payload?.count);
            onlineCount = Number.isFinite(count) ? count : null;
            onlineState.textContent = Number.isFinite(count) ? `${count} 人在线` : '在线人数未知';
            pushOverlayState();
        });
    }

    function submitChat(value) {
        const message = String(value || '').trim().slice(0, 500);
        if (!message || !socket?.connected) return;
        socket.emit('chat_message', { room: activeRoom, message });
    }

    function sendChat() {
        const message = chatInput.value.trim();
        if (!message) return;
        submitChat(message);
        chatInput.value = '';
        chatInput.focus();
    }

    window.addEventListener('message', event => {
        const data = event.data;
        if (
            event.source !== openerWindow
            || data?.channel !== CHANNEL_FROM_TARGET
            || data?.token !== bridgeToken
        ) {
            return;
        }
        if (data.type === 'hello' || data.type === 'target_ready') {
            updateTargetState(
                Boolean(data.payload?.playerReady),
                data.payload?.reason,
            );
            postToTarget('connection', {
                connected: Boolean(socket?.connected),
                room: activeRoom,
                username: activeUsername,
            });
            if (data.type === 'target_ready' && socket?.connected) {
                socket.emit('request_room_state', { room: activeRoom });
            }
            return;
        }
        if (data.type === 'player_event' && socket?.connected) {
            socket.emit('video_event', { room: activeRoom, ...data.payload });
            return;
        }
        if (data.type === 'buffering_event' && socket?.connected) {
            socket.emit('buffering_event', { room: activeRoom, ...data.payload });
            return;
        }
        if (data.type === 'chat_submit') {
            submitChat(data.payload?.message);
            return;
        }
        if (data.type === 'overlay_request') {
            pushOverlayState();
        }
    });

    connectButton.addEventListener('click', connect);
    sendButton.addEventListener('click', sendChat);
    chatInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            sendChat();
        }
    });

    roomInput.value = readStorage('tw_last_room');
    usernameInput.value = cleanUsername(readStorage('tw_username', '观影成员'));
    if (!openerWindow || !bridgeToken) {
        help.textContent = '请从视频播放页点击“一起看助手”书签；直接打开此页面无法控制播放器。';
        updateTargetState(false);
    } else {
        postToTarget('hello', {});
    }
    if (validateRoom(roomInput.value)) connect();

    window.addEventListener('beforeunload', () => {
        postToTarget('connection', { connected: false, room: activeRoom });
        disconnectSocket();
    });
});
