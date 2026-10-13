'use strict';
const { isIP } = require('node:net');
const SERVER = 'https://watchtogethernow.cloud';
const APP_ORIGIN = 'tw-app://desktop';
const ROOM_RE = /^[\p{L}\p{N}_-]{4,64}$/u;
function publicHttps(value) {
    if (typeof value !== 'string' || value.length > 4096) return '';
    try {
        const url = new URL(value.trim());
        const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
        // Public domains only. Not a DNS-level network sandbox.
        if (url.protocol !== 'https:' || url.username || url.password || isIP(host)
            || !host.includes('.') || /\.(local|localhost|internal|test|invalid)$/.test(host)
            || host.endsWith('.localhost') || (url.port && url.port !== '443')) return '';
        return url.href;
    } catch { return ''; }
}
function roomFrom(value, server = SERVER) {
    const text = String(value || '').trim();
    if (ROOM_RE.test(text)) return text;
    try {
        const url = new URL(text);
        if (url.origin !== server || url.username || url.password) return '';
        const match = /^\/(?:mobile-room|room)\/([^/]+)$/.exec(url.pathname);
        const id = match ? decodeURIComponent(match[1]) : '';
        return ROOM_RE.test(id) ? id : '';
    } catch { return ''; }
}
function isRoomUrl(value, room, server = SERVER) {
    try {
        const url = new URL(value);
        return !url.username && !url.password && url.origin === server
            && decodeURIComponent(url.pathname) === `/mobile-room/${room}`;
    } catch { return false; }
}
function timingSample(raw, session) {
    if (!raw || !Number.isFinite(raw.time) || raw.time < 0) return null;
    const finite = (v, max) => Number.isFinite(v) && v >= 0 && v <= max;
    return { active: true, session, time: Math.min(raw.time, 604800),
        duration: finite(raw.duration, 604800) ? raw.duration : 0,
        speed: finite(raw.speed, 4) && raw.speed >= .25 ? raw.speed : 1,
        playing: raw.playing === true, ready: raw.ready === true && !raw.blocked, seeking: raw.seeking === true,
        appliedCommand: Number.isSafeInteger(raw.appliedCommand) ? raw.appliedCommand : 0,
        error: raw.blocked ? '请先在视频中点击播放，浏览器阻止了自动播放' : '',
        events: (Array.isArray(raw.events) ? raw.events : []).slice(-16)
            .filter(e => e && ['play','pause','seek','speed'].includes(e.type) && finite(e.time, 604800))
            .map(e => ({ type: e.type, time: e.time, speed: finite(e.speed, 4) && e.speed >= .25 ? e.speed : 1 })),
    };
}
function playbackCommand(raw, session) {
    if (!raw || raw.session !== session) return null;
    if (raw.type === 'volume' && Number.isFinite(raw.value))
        return { type: 'volume', value: Math.max(0, Math.min(1, raw.value)) };
    if (raw.type !== 'state' || !Number.isSafeInteger(raw.id) || raw.id < 0
        || !Number.isFinite(raw.time) || raw.time < 0 || raw.time > 604800
        || !Number.isFinite(raw.speed) || raw.speed < .25 || raw.speed > 4) return null;
    return { type: 'state', id: raw.id, time: raw.time, speed: raw.speed,
        playing: raw.playing === true, seek: raw.seek === true,
        issuedAt: Number.isFinite(raw.issuedAt) ? raw.issuedAt : Date.now() };
}
function panelBounds(width, height, full) {
    const top = full ? 0 : 156;
    const roomWidth = full ? 0 : Math.min(400, Math.max(300, Math.round(width * .29)));
    return { video: { x: 0, y: top, width: width - roomWidth, height: Math.max(1, height - top) },
        room: { x: width - roomWidth, y: top, width: roomWidth, height: Math.max(1, height - top) } };
}
module.exports = { SERVER, APP_ORIGIN, publicHttps, roomFrom, isRoomUrl, timingSample, playbackCommand, panelBounds };
