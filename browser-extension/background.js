const STATUS_STYLES = {
    connected: { text: '✓', color: '#20b26b' },
    finding: { text: '…', color: '#d89a17' },
    error: { text: '!', color: '#d84b58' },
    disabled: { text: '', color: '#666666' },
};

const DEFAULTS = {
    server: '',
    room: '',
    username: '',
    clientKey: '',
    enabled: true,
    videoVolume: 100,
};

const TRUSTED_INVITE_SERVERS = new Set([
    'https://watchtogethernow.cloud',
]);

let settings = { ...DEFAULTS };
let socket = null;
let target = null;
let overlayTabId = null;
let reconnectTimer = null;
let clockSyncTimer = null;
let serverClockOffset = 0;

function generateClientKey() {
    return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => (
        byte.toString(16).padStart(2, '0')
    )).join('');
}

function normalizeTrustedInvite(value) {
    try {
        const server = new URL(String(value?.server || '')).origin;
        const room = String(value?.room || '').trim();
        const username = String(value?.username || '观影成员')
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .trim()
            .slice(0, 32) || '观影成员';
        const suppliedKey = String(value?.clientKey || value?.client_key || '');
        if (!TRUSTED_INVITE_SERVERS.has(server)) return null;
        if (!/^[\p{L}\p{N}_-]{4,64}$/u.test(room)) return null;
        return {
            server,
            room,
            username,
            clientKey: /^[A-Za-z0-9_-]{16,96}$/.test(suppliedKey)
                ? suppliedKey
                : generateClientKey(),
            enabled: true,
        };
    } catch (_error) {
        return null;
    }
}

function report(status, detail, tabId = target?.tabId) {
    if (!tabId) return;
    const style = STATUS_STYLES[status] || STATUS_STYLES.error;
    chrome.action.setBadgeText({ tabId, text: style.text }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ tabId, color: style.color }).catch(() => {});
    chrome.action.setTitle({
        tabId,
        title: detail || 'Together Watch 观影伴侣',
    }).catch(() => {});
}

class SocketIoLite {
    constructor(origin, handlers) {
        this.origin = origin;
        this.handlers = handlers;
        this.ws = null;
        this.ready = false;
        this.closedByClient = false;
    }

    connect() {
        this.closedByClient = false;
        const base = new URL(this.origin);
        const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${base.host}/socket.io/?EIO=4&transport=websocket`;
        this.ws = new WebSocket(url);
        this.ws.addEventListener('message', event => this.handleMessage(String(event.data)));
        this.ws.addEventListener('close', () => {
            this.ready = false;
            if (!this.closedByClient) this.handlers.close?.();
        });
        this.ws.addEventListener('error', () => this.handlers.error?.());
    }

    handleMessage(rawMessage) {
        for (const raw of rawMessage.split('\x1e')) {
            if (!raw) continue;
            if (raw.startsWith('0')) {
                this.ws?.send('40');
                continue;
            }
            if (raw === '2') {
                this.ws?.send('3');
                continue;
            }
            if (raw.startsWith('40')) {
                this.ready = true;
                this.handlers.open?.();
                continue;
            }
            if (!raw.startsWith('42')) continue;
            try {
                const [eventName, payload] = JSON.parse(raw.slice(2));
                this.handlers.event?.(eventName, payload);
            } catch (_error) {
                // Ignore malformed packets from unrelated namespaces.
            }
        }
    }

    emit(eventName, payload) {
        if (!this.ready || this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send(`42${JSON.stringify([eventName, payload])}`);
    }

    close() {
        this.closedByClient = true;
        this.ready = false;
        this.ws?.close();
        this.ws = null;
    }
}

function setTarget(sender) {
    if (!sender.tab?.id) return;
    target = {
        tabId: sender.tab.id,
        frameId: Number(sender.frameId) || 0,
    };
}

function sendToPlayer(eventName, payload) {
    if (!target) return;
    chrome.tabs.sendMessage(
        target.tabId,
        {
            type: 'tw_room_event',
            eventName,
            payload,
            serverClockOffset,
        },
        { frameId: target.frameId },
    ).catch(() => {
        report('finding', '正在等待官方页面播放器');
    });
}

function sendToOverlay(eventName, payload) {
    const tabId = overlayTabId || target?.tabId;
    if (!tabId) return;
    chrome.tabs.sendMessage(
        tabId,
        {
            type: 'tw_room_event',
            eventName,
            payload,
            serverClockOffset,
        },
        { frameId: 0 },
    ).catch(() => {});
}

function sendConnectionState(connected) {
    sendToOverlay('companion_connection', {
        connected: Boolean(connected),
        room: settings.room,
        username: settings.username || '观影成员',
    });
}

function sendClockProbe() {
    socket?.emit('sync_ping', {
        room: settings.room,
        client_time: Date.now(),
    });
}

function startClockSync() {
    clearInterval(clockSyncTimer);
    sendClockProbe();
    clockSyncTimer = setInterval(sendClockProbe, 10000);
}

function handleRoomEvent(eventName, payload) {
    if (eventName === 'sync_pong') {
        const receivedAt = Date.now();
        const sentAt = Number(payload?.client_time);
        const serverTime = Number(payload?.server_time);
        if (Number.isFinite(sentAt) && Number.isFinite(serverTime)) {
            const midpoint = (sentAt + receivedAt) / 2000;
            const sample = serverTime - midpoint;
            serverClockOffset = serverClockOffset
                ? serverClockOffset * 0.75 + sample * 0.25
                : sample;
        }
        return;
    }
    if (['room_state', 'buffering_state', 'sync_video', 'companion_command'].includes(eventName)) {
        sendToPlayer(eventName, payload);
        return;
    }
    if (['chat_message', 'status', 'presence', 'app_error'].includes(eventName)) {
        sendToOverlay(eventName, payload);
    }
}

function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2500);
}

function connect() {
    socket?.close();
    clearInterval(clockSyncTimer);
    if (!settings.enabled || !settings.server || !settings.room) {
        report('disabled', '请在扩展中配置服务器和房间');
        return;
    }
    if (!target) {
        return;
    }

    socket = new SocketIoLite(settings.server, {
        open: () => {
            report('connected', `已连接房间 ${settings.room}`);
            socket.emit('join', {
                room: settings.room,
                username: (settings.username || '观影成员').slice(0, 32),
                role: 'companion',
                client_key: settings.clientKey,
            });
            sendConnectionState(true);
            sendToPlayer('companion_command', {
                command: 'set_volume',
                value: Math.max(0, Math.min(1, Number(settings.videoVolume) / 100)),
            });
            startClockSync();
            setTimeout(() => {
                socket.emit('request_room_state', { room: settings.room });
            }, 100);
        },
        event: handleRoomEvent,
        close: () => {
            clearInterval(clockSyncTimer);
            report('error', '同步连接已断开，正在重连');
            sendConnectionState(false);
            scheduleReconnect();
        },
        error: () => {
            report('error', '无法连接房间服务器');
            sendConnectionState(false);
        },
    });
    try {
        socket.connect();
    } catch (_error) {
        report('error', '房间服务器地址无效');
    }
}

chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message || !sender.tab?.id) return;

    if (message.type === 'tw_accept_invite') {
        const invite = normalizeTrustedInvite(message.config);
        if (!invite) {
            report('error', '房间邀请来源无效，已拒绝自动连接', sender.tab.id);
            return;
        }
        setTarget(sender);
        overlayTabId = sender.tab.id;
        chrome.storage.local.set(invite, () => {
            report('finding', `已自动加入房间 ${invite.room}，正在寻找播放器`, sender.tab.id);
            chrome.tabs.sendMessage(
                sender.tab.id,
                { type: 'tw_clear_invite_hash' },
                { frameId: Number(sender.frameId) || 0 },
            ).catch(() => {});
        });
        return;
    }

    if (message.type === 'tw_companion_status') {
        report(message.status, message.detail, sender.tab.id);
        return;
    }
    if (message.type === 'tw_overlay_ready') {
        if (target && target.tabId !== sender.tab.id) return;
        overlayTabId = sender.tab.id;
        if (settings.enabled && settings.server && settings.room) {
            sendConnectionState(Boolean(socket?.ready));
        }
        return;
    }
    if (message.type === 'tw_player_ready') {
        const changedTarget = (
            target?.tabId !== sender.tab.id
            || target?.frameId !== (Number(sender.frameId) || 0)
        );
        setTarget(sender);
        overlayTabId = sender.tab.id;
        report(socket?.ready ? 'connected' : 'finding', '已找到官方页面播放器');
        if (changedTarget || !socket?.ready) connect();
        sendToPlayer('companion_command', {
            command: 'set_volume',
            value: Math.max(0, Math.min(1, Number(settings.videoVolume) / 100)),
        });
        sendConnectionState(Boolean(socket?.ready));
        return;
    }
    if (message.type === 'tw_chat_message') {
        if (sender.tab.id !== (overlayTabId || target?.tabId)) return;
        const chatMessage = String(message.payload?.message || '')
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .trim()
            .slice(0, 500);
        if (!chatMessage || !socket?.ready) {
            sendConnectionState(false);
            return;
        }
        socket.emit('chat_message', {
            room: settings.room,
            message: chatMessage,
        });
        return;
    }
    if (message.type === 'tw_video_event') {
        setTarget(sender);
        socket?.emit('video_event', {
            room: settings.room,
            ...message.payload,
        });
        return;
    }
    if (message.type === 'tw_buffering_event') {
        setTarget(sender);
        socket?.emit('buffering_event', {
            room: settings.room,
            ...message.payload,
        });
    }
});

chrome.tabs.onRemoved.addListener(tabId => {
    if (overlayTabId === tabId) overlayTabId = null;
    if (target?.tabId !== tabId) return;
    target = null;
    socket?.close();
    socket = null;
    clearInterval(clockSyncTimer);
});

chrome.storage.local.get(DEFAULTS, config => {
    settings = { ...DEFAULTS, ...config };
    if (target) connect();
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, change] of Object.entries(changes)) {
        if (key in DEFAULTS) settings[key] = change.newValue;
    }
    if (changes.videoVolume) {
        sendToPlayer('companion_command', {
            command: 'set_volume',
            value: Math.max(0, Math.min(1, Number(settings.videoVolume) / 100)),
        });
    }
    if (['server', 'room', 'username', 'clientKey', 'enabled'].some(
        key => Boolean(changes[key]),
    )) {
        connect();
    }
});
