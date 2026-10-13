document.addEventListener('DOMContentLoaded', () => {
    if (window.TW_LEGAL_GATE_BLOCKED) return;
    const room = document.getElementById('roomData').value;
    const username = localStorage.getItem('tw_username') || '观影成员';
    let clientKey = localStorage.getItem('tw_client_key') || '';
    if (!/^[A-Za-z0-9_-]{16,96}$/.test(clientKey)) {
        clientKey = Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('tw_client_key', clientKey);
    }
    const status = document.getElementById('mobileStatus');
    const playerStatus = document.getElementById('mobilePlayerStatus');
    const messages = document.getElementById('chatContainer');
    const input = document.getElementById('chatInput');
    const send = document.getElementById('sendBtn');
    const volumeSlider = document.getElementById('mobileVideoVolume');
    const volumeValue = document.getElementById('mobileVideoVolumeValue');
    const storedVolume = localStorage.getItem('tw_video_volume');
    let videoVolume = storedVolume !== null && Number.isFinite(Number(storedVolume))
        ? Math.max(0, Math.min(100, Number(storedVolume))) : 100;
    volumeSlider.value = String(videoVolume);
    volumeValue.textContent = `${videoVolume}%`;
    let companion = null;
    let nativeSession = null;
    let commands = [];
    let lastProbe = 0;
    let receivedAt = 0;
    function queueCommand(command) {
        commands = commands.filter(item => item.type !== command.type);
        commands.push(command);
    }
    volumeSlider.addEventListener('input', () => {
        videoVolume = Math.max(0, Math.min(100, Number(volumeSlider.value) || 0));
        volumeValue.textContent = `${videoVolume}%`;
        localStorage.setItem('tw_video_volume', String(videoVolume));
        if (nativeSession !== null) queueCommand({ type: 'volume', session: nativeSession, value: videoVolume / 100 });
        else if (socket.connected) socket.emit('companion_command', { room, command: 'set_volume', value: videoVolume / 100 });
    });
    function addMessage(message, author = '') {
        if (!message) return;
        const row = document.createElement('p');
        row.textContent = `${author ? author + '：' : ''}${String(message).slice(0, 500)}`;
        messages.appendChild(row);
        while (messages.children.length > 100) messages.firstElementChild.remove();
        messages.scrollTop = messages.scrollHeight;
    }
    const socket = io({ transports: ['websocket', 'polling'] });
    const call = window.createVoiceCallController({ socket, roomId: room, username,
        addSystemMessage: text => addMessage(text) });
    socket.on('connect', () => {
        socket.emit('join', { room, username, client_key: clientKey });
        status.textContent = '房间已连接';
        send.disabled = false;
        call.handleSocketReconnect();
    });
    socket.on('disconnect', () => {
        status.textContent = '房间正在重连…';
        send.disabled = true;
        call.handleSocketDisconnect();
    });
    socket.on('connect_error', () => { status.textContent = '连接失败，正在重试…'; });
    socket.on('presence', data => { document.getElementById('onlineCount').textContent = `${data.count} 人在线`; });
    socket.on('chat_message', data => addMessage(data.message, data.username));
    socket.on('status', data => addMessage(data.msg));
    socket.on('app_error', data => addMessage(data.message));
    function sendChat() {
        const message = input.value.trim();
        if (!message || !socket.connected) return;
        socket.emit('chat_message', { room, message });
        input.value = '';
    }
    send.addEventListener('click', sendChat);
    document.getElementById('chatForm').addEventListener('submit', event => {
        event.preventDefault(); sendChat();
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); sendChat(); }
    });
    const sync = new window.TogetherWatchNativeSync({
        emit: (name, data, ack) => {
            if (!companion?.connected) return;
            // Socket.IO treats an explicit undefined callback as a second
            // payload (serialized to null), not as an omitted argument.
            if (typeof ack === 'function') companion.emit(name, { ...data, room }, ack);
            else companion.emit(name, { ...data, room });
        },
        command: queueCommand,
    });
    function stopNative() {
        companion?.removeAllListeners();
        companion?.disconnect();
        companion = null;
        commands = [];
        nativeSession = null;
        sync.reset();
    }
    function startNative(session) {
        stopNative();
        nativeSession = session;
        companion = io({ transports: ['websocket', 'polling'], forceNew: true });
        companion.on('connect', () => {
            commands = [];
            sync.reset();
            companion.emit('join', { room, username, client_key: clientKey, role: 'companion' });
            queueCommand({ type: 'volume', session: nativeSession, value: videoVolume / 100 });
        });
        companion.on('disconnect', () => { commands = []; sync.reset(); playerStatus.textContent = '播放器正在重连…'; });
        for (const name of ['room_state', 'sync_video', 'playback_ack', 'buffering_state']) {
            companion.on(name, data => sync.state(data, name));
        }
        companion.on('sync_pong', data => {
            const sample = Number(data.server_time) - (Number(data.client_time) + Date.now()) / 2000;
            if (Number.isFinite(sample)) sync.offset = sample;
        });
        companion.on('companion_command', data => {
            if (data.command === 'set_volume') queueCommand({ type: 'volume', session: nativeSession, value: data.value });
        });
        companion.on('app_error', data => addMessage(data.message));
    }
    // Android polls this object only while the top-level page is our HTTPS
    // mobile room. No Java interface is exposed to a third-party video page.
    window.TogetherWatchMobile = {
        receive(data) {
            receivedAt = Date.now();
            if (!data?.active) {
                if (companion) stopNative();
                playerStatus.textContent = '网页播放 · 在上方页面操作';
                return;
            }
            if (nativeSession !== data.session) startNative(data.session);
            if (!companion?.connected) {
                playerStatus.textContent = data.error || '播放器已打开，正在连接房间同步…';
                return;
            }
            if (Date.now() - lastProbe > 10000) {
                lastProbe = Date.now();
                companion.emit('sync_ping', { room, client_time: Date.now() });
                companion.emit('request_room_state', { room });
            }
            sync.receive(data, data.events || []);
            playerStatus.textContent = data.error || (!data.ready ? '内置播放器正在缓冲…'
                : !sync.initialized ? '正在获取房间进度…' : '内置播放 · 同步已连接');
            if (sync.roomDuration > 0 && data.duration > 0 && Math.abs(sync.roomDuration - data.duration) > 10) {
                playerStatus.textContent = '影片时长不同，请确认双方打开同一集、同一版本';
            }
        },
        suspend() {
            stopNative();
            document.getElementById('leaveCallBtn').click();
            playerStatus.textContent = '已暂停，返回 APP 后重新同步';
        },
        drain() { const result = { version: 1, commands }; commands = []; return result; },
    };
    const watchdog = setInterval(() => {
        if (companion && Date.now() - receivedAt > 12000) {
            stopNative();
            playerStatus.textContent = '播放器连接已暂停，返回 APP 后恢复';
        }
    }, 3000);
    window.addEventListener('beforeunload', () => {
        clearInterval(watchdog); stopNative(); call.destroy(); socket.disconnect();
    });
});
