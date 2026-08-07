const serverInput = document.getElementById('server');
const roomInput = document.getElementById('room');
const usernameInput = document.getElementById('username');
const enabledInput = document.getElementById('enabled');
const configPaste = document.getElementById('configPaste');
const status = document.getElementById('status');
const inviteBanner = document.getElementById('inviteBanner');
const advancedSetup = document.getElementById('advancedSetup');
const videoVolume = document.getElementById('videoVolume');
const videoVolumeValue = document.getElementById('videoVolumeValue');

let pendingClientKey = '';
let activeTabId = null;

function generateClientKey() {
    return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => (
        byte.toString(16).padStart(2, '0')
    )).join('');
}

function normalizeServer(value) {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('服务器必须使用 HTTP 或 HTTPS');
    }
    return parsed.origin;
}

function serverPermissionPattern(value) {
    const parsed = new URL(value);
    const hostname = parsed.hostname.includes(':')
        ? `[${parsed.hostname}]`
        : parsed.hostname;
    return `${parsed.protocol}//${hostname}/*`;
}

function decodeInviteConfig(urlValue) {
    try {
        const parsed = new URL(urlValue);
        const match = parsed.hash.match(/^#tw=([A-Za-z0-9_-]+)$/);
        if (!match) return null;
        const base64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
        const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
        const config = JSON.parse(new TextDecoder().decode(bytes));
        if (!config?.server || !config?.room) return null;
        return config;
    } catch (_error) {
        return null;
    }
}

function applyConfig(config) {
    if (config.server) serverInput.value = config.server;
    if (config.room) roomInput.value = config.room;
    if (config.username) usernameInput.value = config.username;
    if (config.clientKey || config.client_key) {
        pendingClientKey = config.clientKey || config.client_key;
    }
    if (typeof config.enabled === 'boolean') enabledInput.checked = config.enabled;
    if (Number.isFinite(Number(config.videoVolume))) {
        setVideoVolume(Number(config.videoVolume), false);
    }
}

function setVideoVolume(value, persist = true) {
    const normalized = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    videoVolume.value = String(normalized);
    videoVolumeValue.textContent = normalized === 0 ? '静音' : `${normalized}%`;
    if (persist) chrome.storage.local.set({ videoVolume: normalized });
    if (activeTabId) {
        chrome.tabs.sendMessage(
            activeTabId,
            { type: 'tw_set_local_volume', value: normalized / 100 },
        ).catch(() => {});
    }
}

async function loadConfiguration() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    activeTabId = activeTab?.id || null;
    const invitation = activeTab?.url ? decodeInviteConfig(activeTab.url) : null;

    chrome.storage.local.get(
        {
            server: '',
            room: '',
            username: '',
            clientKey: '',
            enabled: true,
            videoVolume: 100,
        },
        config => {
            applyConfig(config);
            setVideoVolume(config.videoVolume, false);
            if (invitation) {
                applyConfig(invitation);
                inviteBanner.classList.remove('hidden');
                advancedSetup.open = false;
                status.textContent = `已识别房间 ${invitation.room}，等待连接。`;
                return;
            }
            advancedSetup.open = !(config.server && config.room);
            status.textContent = config.server && config.room
                ? `当前房间：${config.room}`
                : '尚未配置房间，请展开手动配置。';
        },
    );
}

document.getElementById('readConfigBtn').addEventListener('click', () => {
    try {
        const config = JSON.parse(configPaste.value.trim());
        applyConfig(config);
        status.textContent = '配置已读取，请点击“连接当前房间”。';
    } catch (_error) {
        status.textContent = '配置格式不正确，请回到房间页重新复制。';
    }
});

videoVolume.addEventListener('input', () => {
    setVideoVolume(videoVolume.value);
});

document.getElementById('saveBtn').addEventListener('click', async () => {
    try {
        const config = {
            server: normalizeServer(serverInput.value.trim()),
            room: roomInput.value.trim(),
            username: usernameInput.value.trim().slice(0, 32) || '观影成员',
            clientKey: /^[A-Za-z0-9_-]{16,96}$/.test(pendingClientKey)
                ? pendingClientKey
                : generateClientKey(),
            enabled: enabledInput.checked,
            videoVolume: Number(videoVolume.value),
        };
        if (!/^[\p{L}\p{N}_-]{4,64}$/u.test(config.room)) {
            throw new Error('房间号格式不正确');
        }
        const granted = await chrome.permissions.contains({
            origins: [serverPermissionPattern(config.server)],
        });
        if (!granted) {
            throw new Error('该版本只允许连接 Together Watch 正式站点');
        }
        chrome.storage.local.set(config, () => {
            status.textContent = '已连接当前房间，可以直接开始播放。';
            inviteBanner.classList.add('hidden');
            if (activeTabId) {
                chrome.tabs.sendMessage(
                    activeTabId,
                    { type: 'tw_clear_invite_hash' },
                ).catch(() => {});
            }
        });
    } catch (error) {
        status.textContent = error.message || '配置无效';
        advancedSetup.open = true;
    }
});

loadConfiguration().catch(() => {
    status.textContent = '无法读取当前标签页，请手动配置房间。';
    advancedSetup.open = true;
});
