'use strict';
const { isIP } = require('node:net');
const {api:catalogAdapters}=require('./catalog-adapters.cjs');
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
    if (text.length > 2048) return '';
    const clean = id => ROOM_RE.test(id) ? (/^[a-f\d]{24}$/i.test(id) ? id.toLowerCase() : id) : '';
    const bare = clean(text.replace(/^房间(?:号)?[：:\s]+/, '').trim());
    if (bare) return bare;
    try {
        const link = text.match(/https?:\/\/[^\s<>]+/i);
        const url = new URL(link ? link[0].replace(/[)\]}>，。；！？]+$/, '') : text);
        if (url.origin !== server || url.username || url.password) return '';
        const match = /^\/(?:mobile-room|room)\/([^/]+)\/?$/.exec(url.pathname);
        const id = match ? decodeURIComponent(match[1]) : url.pathname === '/' && url.searchParams.getAll('room').length === 1 ? url.searchParams.get('room').trim() : '';
        return clean(id);
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
function danmakuOverlay(raw, session) {
    if (!raw || raw.session !== session || !Array.isArray(raw.items)) return null;
    return {enabled:raw.enabled===true,opacity:.85,size:22,items:raw.items.slice(0,6)
        .filter(r=>r && typeof r.text==='string' && Number.isFinite(r.time) && r.time>=0 && r.time<=604800 && Number.isInteger(r.lane) && r.lane>=0 && r.lane<6)
        .map(r=>({text:r.text.slice(0,80),time:r.time,lane:r.lane,kind:r.kind==='room'?'room':'public'}))};
}
function panelBounds(width, height, full, expanded = false) {
    const top = full ? 0 : expanded ? 328 : 128;
    const roomWidth = full ? 0 : Math.min(400, Math.max(300, Math.round(width * .29)));
    return { video: { x: 0, y: top, width: width - roomWidth, height: Math.max(1, height - top) },
        room: { x: width - roomWidth, y: top, width: roomWidth, height: Math.max(1, height - top) } };
}
function playSelection(value, server = SERVER) {
    try {
        const url = new URL(value);
        if (url.origin !== server || url.username || url.password || url.search || url.hash) return null;
        const match = /^\/discover\/play\/(cupfox|huarw|blender|yhdmoe|fcma|ddys|233dm|pkavi|kanju)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
        if (!match) return null;
        const [, source, item, episode] = match;
        if (catalogAdapters.sources[source]) {
            const selected=catalogAdapters.selection(source,item,episode);
            return selected ? {source,episode,page:selected.page} : null;
        }
        if (source === 'cupfox' && /^\d{1,20}$/.test(item) && /^ep\d{1,5}$/.test(episode))
            return { source, episode, page: `https://www.cupfox.in/vod-detail/${item}.html` };
        if (source === 'huarw' && /^\d{1,20}$/.test(item) && new RegExp('^' + item + '(?:-\\d{1,5}){1,3}$').test(episode))
            return { source, episode, page: `https://huarw.com/play/${episode}` };
        if (source === 'blender' && /^[0-9a-f-]{36}$/.test(item) && episode === 'video')
            return { source, episode, page: `https://video.blender.org/videos/watch/${item}` };
        if (source === 'yhdmoe' && /^\d{1,20}$/.test(item) && /^EP\d{1,5}(?:\.\d{1,2})?$/.test(episode))
            return { source, episode, page: `https://yhdmoe.com/watch/${item}#play_ep_${episode}` };
        if (source === 'fcma' && /^\d{1,20}-\d{1,5}$/.test(item) && /^\d{1,20}$/.test(episode))
            return { source, episode, page: `https://www.fcma.cc/p/${item.replace('-', '/')}/${episode}` };
        if (source === 'ddys' && /^[a-z0-9][a-z0-9-]{0,119}$/.test(item) && episode === 'page')
            return { source, episode, page: `https://ddys.io/movie/${item}` };
    } catch { /* Not a first-party handoff. */ }
    return null;
}
function isDiscoveryUrl(value, server = SERVER) {
    try { const url = new URL(value); return !url.username && !url.password && url.origin === server && url.pathname === '/discover'; }
    catch { return false; }
}
function programSelection(value, server = SERVER) {
    const original=catalogAdapters.fromPage(value);
    if (original) return {source:original.source,item:original.item,episode:original.episode};
    const selection = playSelection(value, server);
    if (selection) {
        const parts = new URL(value).pathname.split('/');
        return {source: parts[3], item: parts[4], episode: parts[5]};
    }
    const samples = {sintel:'https://media.w3.org/2010/05/sintel/trailer.mp4', bunny:'https://media.w3.org/2010/05/bunny/trailer.mp4'};
    for (const [item, page] of Object.entries(samples)) if (value === page) return {source:'sample',item,episode:'video'};
    try {
        const url = new URL(value);
        if (!url.searchParams.has('episode')) {
            const d=catalogAdapters.detail('kanju',value);
            if(d) return {source:'kanju',item:d.item,episode:'page'};
        }
    } catch {}
    return null;
}
function programTarget(value, server = SERVER) {
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 1) return null;
    const p = value.program;
    if (!p || ![p.source,p.item,p.episode].every(v => typeof v === 'string')) return null;
    const selection = playSelection(`${server}/discover/play/${p.source}/${p.item}/${p.episode}`, server);
    let page = selection?.page;
    if (p.source === 'sample' && ['sintel','bunny'].includes(p.item) && p.episode === 'video') page = `https://media.w3.org/2010/05/${p.item}/trailer.mp4`;
    if (p.source === 'kanju' && catalogAdapters.publicId(p.item) && p.episode === 'page') page = `https://www.kanju.ai/player/${encodeURIComponent(p.item)}`;
    return page && page === p.page ? {...selection, page, revision:value.revision, exact:p.exact_episode === true} : null;
}
function isKanju(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && ['www.kanju.ai','kanju.ai'].includes(u.host) && !u.username && !u.password; } catch { return false; }
}
module.exports = { SERVER, APP_ORIGIN, publicHttps, roomFrom, isRoomUrl, timingSample, playbackCommand, danmakuOverlay, panelBounds, playSelection, isDiscoveryUrl, programSelection, programTarget, isKanju };
