const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const section = (source, start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
    return source.slice(from, to);
};

function clock() {
    let now = 100000;
    let id = 0;
    const jobs = new Map();
    return {
        jobs,
        Date: class extends Date { static now() { return now; } },
        setTimeout(fn, delay = 0) { jobs.set(++id, { fn, at: now + delay }); return id; },
        clearTimeout(key) { jobs.delete(key); },
        setInterval(fn, delay) { jobs.set(++id, { fn, at: now + delay, interval: delay }); return id; },
        clearInterval(key) { jobs.delete(key); },
        tick(ms) {
            now += ms;
            for (const [key, job] of [...jobs]) {
                if (job.at > now || !jobs.has(key)) continue;
                if (job.interval) job.at = now + job.interval;
                else jobs.delete(key);
                job.fn();
            }
        },
    };
}

class Element {
    constructor() {
        this.handlers = new Map();
        this.children = [];
        this.dataset = {};
        this.value = '';
        this.textContent = '';
        this.classList = { add() {}, remove() {}, toggle() {} };
    }
    addEventListener(name, fn, options = {}) {
        const list = this.handlers.get(name) || [];
        list.push({ fn, options });
        this.handlers.set(name, list);
    }
    async fire(name, event = {}) {
        for (const item of this.handlers.get(name) || []) {
            if (!item.options.signal?.aborted) await item.fn(event);
        }
    }
    appendChild(child) { this.children.push(child); }
    append(...children) { this.children.push(...children); }
    querySelectorAll() { return this.children; }
    remove() {}
    focus() {}
}

function media() {
    const video = new Element();
    Object.assign(video, {
        currentTime: 0, duration: 1000, readyState: 4, playbackRate: 1,
        paused: true, seeking: false, volume: 1, muted: false, playCount: 0,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }),
        play() { this.paused = false; ++this.playCount; return Promise.resolve(); },
        pause() { this.paused = true; },
    });
    return video;
}

function helper(file, bookmark) {
    const source = read(file);
    const timer = clock();
    const outgoing = [];
    const context = vm.createContext({
        Date: timer.Date, window: timer, AbortController, console,
        player: null, lastRevision: 0, localInteractionUntil: 0,
        remoteGuardUntil: 0, remoteSeekUntil: 0, pendingPlayerState: null,
        resumeTimer: null, serverClockOffset: 0, localVolume: 1,
        connected: true, playerEvents: null, lastPlayerReason: '', lastPlayerSample: null,
        chatUi: null, chatState: {},
        report() {}, setStatus() {}, setChatConnection() {}, addChatMessage() {},
        updateChatHeader() {}, readPlayerSample() { return null; },
        notify(value) { outgoing.push(value); },
        postToCompanion(type, payload) { outgoing.push({ type, payload }); },
        playerMetrics() { return {}; }, requestRoomState() {},
        sendSnapshot() {}, sendPlayerSnapshot() {}, clearBuffering() {},
    });
    vm.runInContext(section(source, 'function estimatedServerNow(', 'function refreshPlayer('), context);
    vm.runInContext(section(source, 'function bindPlayer(', 'function estimatedServerNow('), context);
    const emitName = bookmark ? 'emitPlayerEvent' : 'emit';
    vm.runInContext(section(source, `function ${emitName}(`,
        bookmark ? 'function readPlayerSample(' : 'function sendSnapshot('), context);
    vm.runInContext(section(source, 'function isRemotePlayerUpdate(', 'document.addEventListener('), context);
    return { context, timer, outgoing, handle: bookmark ? context.handleRoomEvent : context.handleEvent,
        emit: context[emitName] };
}

for (const [file, bookmark] of [['static/js/bookmarklet.js', true], ['browser-extension/content.js', false]]) {
    test(`${file}: state received before metadata is applied when the video loads`, async () => {
        const runtime = helper(file, bookmark);
        runtime.handle('room_state', { revision: 4, time: 120, playing: false, speed: 1 });
        const video = media();
        video.readyState = 0;
        runtime.context.bindPlayer(video);
        assert.equal(video.currentTime, 0);
        video.readyState = 4;
        await video.fire('loadedmetadata');
        assert.equal(video.currentTime, 120);
    });

    test(`${file}: old revisions cannot undo seek and slow remote seeks do not echo`, async () => {
        const runtime = helper(file, bookmark);
        const video = media();
        runtime.context.bindPlayer(video);
        runtime.outgoing.length = 0;
        runtime.handle('sync_video', { revision: 9, type: 'seek', time: 120, playing: false });
        runtime.handle('room_state', { revision: 8, time: 5, playing: false });
        assert.equal(video.currentTime, 120);
        video.seeking = true;
        runtime.timer.tick(2500);
        runtime.outgoing.length = 0; // Ignore the scheduled player-ready notification.
        runtime.emit('seek');
        assert.equal(runtime.outgoing.length, 0);
        video.seeking = false;
        await video.fire('seeked');
        assert.equal(runtime.outgoing.length, 0);
        runtime.timer.tick(500);
        runtime.emit('seek');
        assert.equal(runtime.outgoing[0].payload.type, 'seek');
    });

    test(`${file}: volume preserves scheduled resume, a newer pause cancels it`, () => {
        const runtime = helper(file, bookmark);
        const video = media();
        runtime.context.player = video;
        runtime.handle('buffering_state', { revision: 4, active: false, playing: true,
            time: 5, speed: 1, resume_at: 101 });
        runtime.handle('companion_command', { command: 'set_volume', value: 0.3 });
        assert.equal(runtime.timer.jobs.size, 1);
        runtime.handle('sync_video', { revision: 5, type: 'pause', playing: false, time: 5 });
        runtime.timer.tick(2000);
        assert.equal(video.playCount, 0);
        assert.equal(video.volume, 0.3);
    });

    test(`${file}: forced catch-up overrides old local interaction and reconnect resets revisions`, () => {
        const runtime = helper(file, bookmark);
        const video = media();
        runtime.context.player = video;
        runtime.context.localInteractionUntil = 999999;
        runtime.handle('room_state', { revision: 80, time: 150, playing: false, force_sync: true });
        assert.equal(video.currentTime, 150);
        runtime.handle('sync_reset', {});
        runtime.handle('room_state', { revision: 1, time: 3, playing: false });
        assert.equal(video.currentTime, 3);
    });
}

function voice(getUserMedia, AudioContext) {
    const timer = clock();
    const elements = new Map();
    const events = new Map();
    const emitted = [];
    const connections = [];
    const socket = {
        connected: true, on(name, fn) { events.set(name, fn); },
        emit(name, payload) { emitted.push({ name, payload }); },
    };
    class Peer extends Element {
        constructor() { super(); connections.push(this); this.connectionState = 'new'; }
        addTrack() {}
        createOffer() { return Promise.resolve({ type: 'offer' }); }
        setLocalDescription(value) { this.localDescription = { toJSON: () => value }; return Promise.resolve(); }
        close() { this.connectionState = 'closed'; }
    }
    const context = vm.createContext({
        window: { ...timer, RTCPeerConnection: Peer, AudioContext,
            addEventListener() {}, removeEventListener() {} }, RTCPeerConnection: Peer,
        AbortController, console, localStorage: { getItem: () => null, setItem() {} },
        navigator: { mediaDevices: { getUserMedia } },
        document: { getElementById(id) {
            if (!elements.has(id)) elements.set(id, new Element());
            return elements.get(id);
        }, createElement: media },
    });
    vm.runInContext(read('static/js/voice-call.js'), context);
    const controller = context.window.createVoiceCallController({
        socket, roomId: 'test-room', username: 'tester', addSystemMessage() {},
    });
    return { timer, elements, events, emitted, connections, socket, controller };
}

function microphone() {
    const track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
    return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}

test('voice: leaving while microphone permission is pending stops the late stream', async () => {
    let grant;
    const stream = microphone();
    const runtime = voice(() => new Promise(resolve => { grant = resolve; }));
    const joining = runtime.elements.get('joinCallBtn').fire('click');
    runtime.controller.destroy();
    grant(stream);
    await joining;
    assert.equal(stream.track.stopped, true);
    assert.equal(runtime.controller.joined, false);
    assert.equal(runtime.emitted.some(event => event.name === 'call_join'), false);
});

test('voice: leaving cancels ICE restart and mute survives signaling reconnect', async () => {
    const stream = microphone();
    const runtime = voice(() => Promise.resolve(stream));
    await runtime.elements.get('joinCallBtn').fire('click');
    await runtime.events.get('call_ready')({ self_id: 'self', members: [{ id: 'peer' }], ice_servers: [] });
    await runtime.elements.get('muteCallBtn').fire('click');
    runtime.controller.handleSocketDisconnect();
    runtime.controller.handleSocketReconnect();
    runtime.timer.tick(300);
    await runtime.events.get('call_ready')({ self_id: 'new-self', members: [{ id: 'peer' }], ice_servers: [] });
    assert.equal(stream.track.enabled, false);
    assert.equal(runtime.emitted.filter(event => event.name === 'call_mute').length, 2);
    const peer = runtime.connections.at(-1);
    peer.connectionState = 'failed';
    await peer.fire('connectionstatechange');
    assert.ok(runtime.timer.jobs.size > 0);
    runtime.controller.destroy();
    const count = runtime.connections.length;
    runtime.timer.tick(2000);
    assert.equal(runtime.connections.length, count);
    assert.equal(stream.track.stopped, true);
});

test('web companion: repeated reconnects keep exactly one pair of sync timers', () => {
    const timer = clock();
    const elements = new Map();
    const events = new Map();
    const socket = { connected: true, on(name, fn) { events.set(name, fn); }, emit() {},
        removeAllListeners() {}, disconnect() {} };
    let initialize;
    const context = vm.createContext({
        window: { ...timer, location: { hash: '' }, opener: null, io: () => socket, addEventListener() {} },
        Date: timer.Date, localStorage: { getItem: () => null, setItem() {} },
        document: {
            addEventListener(_name, fn) { initialize = fn; },
            getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
            createElement() { return new Element(); },
        },
    });
    vm.runInContext(read('static/js/web-companion.js'), context);
    initialize();
    elements.get('webCompanionRoom').value = 'test-room';
    elements.get('webCompanionConnect').fire('click');
    for (let index = 0; index < 3; index++) {
        events.get('connect')();
        timer.tick(200);
        assert.equal([...timer.jobs.values()].filter(job => job.interval).length, 2);
        events.get('disconnect')();
        assert.equal([...timer.jobs.values()].filter(job => job.interval).length, 0);
    }
});

test('voice: mobile call volume changes the audio gain with no duplicate audible path', async () => {
    const gains = [];
    const node = () => ({ connect() {}, disconnect() {} });
    class AudioContext {
        constructor() { this.state = 'running'; this.destination = {}; }
        resume() { return Promise.resolve(); }
        close() { this.state = 'closed'; return Promise.resolve(); }
        createMediaStreamSource() { return node(); }
        createGain() { const gain = { ...node(), gain: { value: 1 } }; gains.push(gain); return gain; }
    }
    const runtime = voice(() => Promise.resolve(microphone()), AudioContext);
    await runtime.elements.get('joinCallBtn').fire('click');
    await runtime.events.get('call_ready')({ self_id: 'self', members: [{ id: 'peer' }], ice_servers: [] });
    await runtime.connections[0].fire('track', { streams: [microphone()] });
    const slider = runtime.elements.get('callVolumeSlider');
    slider.value = '30';
    await slider.fire('input');
    assert.equal(gains[0].gain.value, 0.3);
    assert.equal(runtime.elements.get('remoteAudioContainer').children[0].muted, true);
    runtime.controller.destroy();
});

test('room player: newer state cancels delayed resume; metadata state is applied only once', async () => {
    const source = read('static/js/main.js');
    const timer = clock();
    const video = media();
    const context = vm.createContext({
        Date: timer.Date, window: timer, videoPlayer: video, AbortController,
        playbackResumeTimer: null, sourceStateAbort: null, sourceStateTimer: null,
        basePlaybackRate: 1, lastRevision: 0, sourceChangeUntil: 0, activeMediaSource: null,
        estimatedServerNow: () => timer.Date.now() / 1000,
        guardRemoteUpdate() {}, expectedPosition: state => state.time,
        updateSyncHealth() {}, correctPlaybackDriftWithoutRateChange() {},
        setInternalPlaybackRate() {}, setVideoTime: value => { video.currentTime = value; },
        requestPlayback: () => video.play(), updateOfficialPlaybackState() {},
        rememberPlaybackState() {}, pausePlayback: () => video.pause(),
    });
    vm.runInContext(section(source, 'function applyPlaybackState(', 'function applyRoomState('), context);
    vm.runInContext(section(source, 'function scheduleSourceState(', 'function changeVideoSource('), context);
    context.applyPlaybackState({ time: 10, playing: true, speed: 1, resume_at: 101 });
    context.applyPlaybackState({ time: 10, playing: false, speed: 1 });
    timer.tick(2000);
    assert.equal(video.playCount, 0);
    video.readyState = 0;
    context.scheduleSourceState({ time: 20, playing: false, speed: 1, revision: 1 });
    video.readyState = 4;
    await video.fire('loadedmetadata');
    video.currentTime = 50;
    timer.tick(4000);
    assert.equal(video.currentTime, 50);
});

test('room player: a slow synchronized seek does not become a new room command', async () => {
    const source = read('static/js/main.js');
    const timer = clock();
    const video = media();
    const outgoing = [];
    const context = vm.createContext({
        Date: timer.Date, videoPlayer: video, remoteGuardUntil: 0, remoteSeekUntil: 0,
        sourceChangeUntil: 0, localMirrorStream: null, localInteractionUntil: 0,
        roomId: 'test-room', EVENT_COOLDOWN: 250, SEEK_THRESHOLD: 0.5,
        lastEventType: '', lastEventAt: 0, lastSeekTime: 0,
        cancelPendingPlayback() {},
        invalidatePlaybackAttempt() {},
        socket: { connected: true, emit(name, payload) { outgoing.push({ name, payload }); } },
    });
    vm.runInContext(section(source, 'function guardRemoteUpdate(', 'const savedStrictSync'), context);
    vm.runInContext(section(source, 'function setVideoTime(', 'function correctPlaybackDriftWithoutRateChange('), context);
    vm.runInContext(section(source, 'function emitVideoEvent(', 'function sendSyncPing('), context);
    vm.runInContext(section(source, "videoPlayer.addEventListener('play',", "videoPlayer.addEventListener('ratechange',"), context);
    context.setVideoTime(120);
    timer.tick(2500);
    await video.fire('seeked');
    assert.equal(outgoing.length, 0);
    timer.tick(500);
    video.currentTime = 130;
    await video.fire('seeking');
    await video.fire('seeked');
    assert.equal(outgoing.length, 1);
    assert.equal(outgoing[0].payload.time, 130);
    context.setVideoTime(200);
    timer.tick(16000);
    video.currentTime = 230;
    await video.fire('seeking');
    await video.fire('seeked');
    assert.equal(outgoing.length, 2, 'An expired remote seek must not swallow the next user seek');
});

function roomPlayback() {
    const source = read('static/js/main.js');
    const timer = clock();
    const video = media();
    const resume = new Element();
    const outgoing = [];
    const prompt = { hidden: true, classList: { toggle(_name, hidden) { prompt.hidden = hidden; } } };
    const context = vm.createContext({
        Date: timer.Date, window: timer, console: { debug() {} }, videoPlayer: video,
        document: { visibilityState: 'visible' }, playbackResumePrompt: prompt, resumePlaybackBtn: resume,
        autoplayBlocked: false, autoplayNoticeShown: false, playbackAttempt: 0,
        latestPlaybackState: null, remotePlaybackEvents: new Map(), activeSource: '/movie.mp4',
        localMirrorStream: null, remoteGuardUntil: 0, remoteSeekUntil: 0,
        sourceChangeUntil: 0, localInteractionUntil: 0, lastEventType: '', lastEventAt: 0,
        lastSeekTime: 0, EVENT_COOLDOWN: 250, SEEK_THRESHOLD: 0.5, roomId: 'mixed-room',
        updateSyncHealth() {}, addSystemMessage() {}, cancelPendingPlayback() {},
        expectedPosition: state => state.time + (timer.Date.now() / 1000 - state.server_time),
        setVideoTime: time => { video.currentTime = time; },
        socket: { connected: true, emit(name, payload) { outgoing.push({ name, payload }); } },
    });
    vm.runInContext(section(source, 'function guardRemoteUpdate(', 'const savedStrictSync'), context);
    vm.runInContext(section(source, 'function setPlaybackPrompt(', 'function isHlsSource('), context);
    vm.runInContext(section(source, 'function emitVideoEvent(', 'function sendSyncPing('), context);
    vm.runInContext(section(source, "for (const name of ['pointerdown',", "videoPlayer.addEventListener('ratechange',"), context);
    return { context, timer, video, resume, prompt, outgoing };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('room player: denied autoplay offers local-only resume at the current room position', async () => {
    const r = roomPlayback();
    r.context.rememberPlaybackState({ time: 20, server_time: 100, playing: true });
    r.video.play = () => Promise.reject({ name: 'NotAllowedError' });
    r.context.requestPlayback();
    await settle();
    assert.equal(r.prompt.hidden, false);
    r.timer.tick(5000);
    r.video.play = () => { r.video.paused = false; return Promise.resolve(); };
    await r.resume.fire('click');
    await r.video.fire('play');
    await settle();
    assert.equal(r.prompt.hidden, true);
    assert.equal(r.video.currentTime, 25);
    assert.equal(r.outgoing.filter(event => event.name === 'video_event').length, 0);
    assert.equal(r.outgoing.at(-1).name, 'request_room_state');
});

test('room player: aborted or superseded play promises do not show an autoplay warning', async () => {
    const r = roomPlayback();
    r.context.rememberPlaybackState({ playing: true });
    r.video.play = () => Promise.reject({ name: 'AbortError' });
    r.context.requestPlayback();
    await settle();
    assert.equal(r.prompt.hidden, true);
    let reject;
    r.video.play = () => new Promise((_resolve, fail) => { reject = fail; });
    r.context.requestPlayback();
    r.context.rememberPlaybackState({ playing: false });
    reject({ name: 'NotAllowedError' });
    await settle();
    assert.equal(r.prompt.hidden, true);
});

test('room player: delayed remote media events do not echo after the time guard expires', async () => {
    const r = roomPlayback();
    r.context.rememberPlaybackState({ playing: true });
    r.context.requestPlayback();
    r.timer.tick(2500);
    await r.video.fire('play');
    r.context.pausePlayback();
    r.timer.tick(2500);
    await r.video.fire('pause');
    assert.equal(r.outgoing.length, 0);
    // A subsequent genuine user action is still published.
    r.context.guardRemoteUpdate();
    await r.video.fire('pointerdown', { isTrusted: true });
    r.video.paused = false;
    await r.video.fire('play');
    assert.equal(r.outgoing.at(-1).payload.type, 'play');
});

test('room player: background suspension and end-of-video do not pause other members', async () => {
    const r = roomPlayback();
    r.context.document.visibilityState = 'hidden';
    await r.video.fire('pause');
    r.context.document.visibilityState = 'visible';
    r.video.ended = true;
    await r.video.fire('pause');
    assert.equal(r.outgoing.length, 0);
    r.video.ended = false;
    await r.video.fire('pause');
    assert.equal(r.outgoing.at(-1).payload.type, 'pause');
});

test('room player: direct media wins over a stale external-playback flag and force sync catches up', () => {
    const source = read('static/js/main.js');
    const states = [];
    const context = vm.createContext({
        Date: { now: () => 100 }, lastRevision: 0, localInteractionUntil: 200,
        activeMediaSource: { mode: 'direct_media' }, externalPlaybackState: { external_playback: true },
        videoPlayer: { readyState: 4 }, sourceIdentity: value => value.mode,
        applyPlaybackState: state => states.push(state),
        updateOfficialPlaybackState: () => assert.fail('A room video must not be treated as an external player'),
    });
    vm.runInContext(section(source, 'function applyRoomState(', 'function cancelPendingPlayback('), context);
    context.applyRoomState({ media_source: { mode: 'direct_media' }, external_playback: true,
        playing: true, time: 30, revision: 5, force_sync: true });
    assert.equal(states.length, 1);
    assert.equal(context.externalPlaybackState, null);
});
