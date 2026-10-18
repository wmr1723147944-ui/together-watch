'use strict';
const crypto = require('node:crypto');
const { publicHttps } = require('./policy.cjs');
const WEB_ONLY = ['iqiyi.com','youku.com','qq.com','mgtv.com','bilibili.com','youtube.com','youtu.be','netflix.com','disneyplus.com','douyin.com','kuaishou.com'];
function preferWeb(value) {
    try { const h = new URL(value).hostname.toLowerCase().replace(/\.$/, ''); return WEB_ONLY.some(x => h === x || h.endsWith('.' + x)); }
    catch { return true; }
}
function mediaKind(value, mime = '') {
    if (!publicHttps(value)) return '';
    const path = new URL(value).pathname.toLowerCase();
    const type = String(mime).split(';')[0].trim().toLowerCase();
    // Never treat manifests' fragments, key files, DASH or a blob URL as a movie.
    if (/\.(ts|m4s|aac|key|mpd)$/.test(path)) return '';
    if (/\.m3u8$/.test(path) || ['application/vnd.apple.mpegurl','application/x-mpegurl','audio/mpegurl','audio/x-mpegurl'].includes(type)) return 'hls';
    if (/\.(mp4|m4v)$/.test(path) || type === 'video/mp4') return 'mp4';
    if (/\.webm$/.test(path) || type === 'video/webm') return 'webm';
    return '';
}
class MediaCatalog {
    constructor() { this.reset(); }
    reset() { this.items = new Map(); this.protected = false; this.reason = ''; }
    block(reason = '检测到受保护内容，请保留原网页播放。') { this.protected = true; this.reason = reason; this.items.clear(); }
    add(value, page, mime = '', details = {}) {
        if (this.protected || preferWeb(page) || !publicHttps(page)) return null;
        const kind = mediaKind(value, mime);
        if (!kind) return null;
        const url = new URL(value); url.hash = '';
        let item = this.items.get(url.href);
        if (!item) {
            if (this.items.size >= 24) return null;
            let file = url.pathname.split('/').pop() || '视频';
            try { file = decodeURIComponent(file); } catch { /* Use encoded label. */ }
            item = { id: crypto.randomBytes(12).toString('hex'), url: url.href, kind,
                label: `${kind.toUpperCase()} · ${url.hostname} · ${file.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 48)}`, position: 0, duration: 0, active: false };
            this.items.set(url.href, item);
        }
        if (details.dom) {
            item.active = details.active === true;
            item.position = Number.isFinite(details.position) ? Math.max(0, Math.min(604800, details.position)) : 0;
            item.duration = Number.isFinite(details.duration) ? Math.max(0, Math.min(604800, details.duration)) : 0;
        }
        return item;
    }
    get(id) { return this.protected ? null : [...this.items.values()].find(item => item.id === id) || null; }
    summaries() {
        return [...this.items.values()].sort((a,b) => Number(b.active) - Number(a.active)).map(({id,label,active,duration}) => ({id,
            label: `${active ? '正在播放 · ' : ''}${label}${duration ? ' · ' + Math.round(duration) + '秒' : ''}`}));
    }
}
module.exports = { MediaCatalog, mediaKind, preferWeb };
