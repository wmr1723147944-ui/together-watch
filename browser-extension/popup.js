const serverInput = document.getElementById('server');
const roomInput = document.getElementById('room');
const usernameInput = document.getElementById('username');
const enabledInput = document.getElementById('enabled');
const configPaste = document.getElementById('configPaste');
const status = document.getElementById('status');

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

function applyConfig(config) {
    if (config.server) serverInput.value = config.server;
    if (config.room) roomInput.value = config.room;
    if (config.username) usernameInput.value = config.username;
    if (typeof config.enabled === 'boolean') enabledInput.checked = config.enabled;
}

chrome.storage.local.get(
    { server: '', room: '', username: '', enabled: true },
    config => {
        applyConfig(config);
        status.textContent = config.server && config.room
            ? '配置已载入；保存后刷新官方视频页即可连接。'
            : '尚未配置房间。';
    },
);

document.getElementById('readConfigBtn').addEventListener('click', () => {
    try {
        const config = JSON.parse(configPaste.value.trim());
        applyConfig(config);
        status.textContent = '配置已读取，请点击“保存并连接”。';
    } catch (_error) {
        status.textContent = '配置格式不正确，请回到房间页重新复制。';
    }
});

document.getElementById('saveBtn').addEventListener('click', async () => {
    try {
        const config = {
            server: normalizeServer(serverInput.value.trim()),
            room: roomInput.value.trim(),
            username: usernameInput.value.trim().slice(0, 32) || '观影成员',
            enabled: enabledInput.checked,
        };
        if (!/^[\p{L}\p{N}_-]{4,64}$/u.test(config.room)) {
            throw new Error('房间号格式不正确');
        }
        const granted = await chrome.permissions.request({
            origins: [serverPermissionPattern(config.server)],
        });
        if (!granted) {
            throw new Error('需要允许扩展连接你的房间服务器');
        }
        chrome.storage.local.set(config, () => {
            status.textContent = '已保存。请刷新官方视频页面开始同步。';
        });
    } catch (error) {
        status.textContent = error.message || '配置无效';
    }
});
