const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const NativeSync = require('../static/js/native-sync.js');

function harness() {
    let now = 100000;
    const emitted = [], commands = [];
    const sync = new NativeSync({
        now: () => now,
        emit: (name, data, ack) => emitted.push({ name, data, ack }),
        command: data => commands.push(data),
    });
    let sample = { session: 1, time: 0, duration: 600, speed: 1, playing: false,
        ready: true, seeking: false, appliedCommand: 0 };
    return {
        sync, emitted, commands,
        advance(ms) { now += ms; },
        receive(changes = {}, events = []) { sample = { ...sample, ...changes }; sync.receive(sample, events); },
        reply(state) { emitted.filter(e => e.name === 'request_room_state').at(-1).ack({ ok: true, state }); },
        state(changes = {}) { return { revision: 1, time: 30, playing: false, speed: 1, server_time: now / 1000, ...changes }; },
        clear() { emitted.length = 0; commands.length = 0; },
    };
}

test('late join waits for confirmed room position before publishing a snapshot', () => {
    const h = harness();
    h.receive();
    assert.deepEqual(h.emitted.map(e => e.name), ['request_room_state']);
    h.reply(h.state({ time: 180 }));
    const command = h.commands.at(-1);
    assert.equal(command.time, 180);
    assert.equal(command.seek, true);
    h.receive();
    assert.equal(h.emitted.filter(e => e.name === 'playback_snapshot').length, 0);
    h.receive({ time: 180, appliedCommand: command.id });
    assert.equal(h.emitted.at(-1).name, 'playback_snapshot');
    assert.equal(h.emitted.at(-1).data.observed_revision, 1);
});

test('confirmed empty room can start a first native player', () => {
    const h = harness();
    h.receive({ time: 42 });
    h.reply(null);
    assert.equal(h.commands.at(-1).playing, true);
    assert.equal(h.commands.at(-1).time, 42);
});

test('periodic state tolerates small drift but explicit seek does not', () => {
    const h = harness();
    h.receive({ time: 30 }); h.reply(h.state()); h.clear();
    h.sync.state(h.state({ time: 31.2, revision: 2 }));
    assert.equal(h.commands.length, 0);
    h.sync.state(h.state({ time: 31.2, revision: 3 }), 'sync_video');
    assert.equal(h.commands.at(-1).seek, true);
});

test('remote controls are not echoed as local user actions', () => {
    const h = harness();
    h.receive(); h.reply(h.state({ time: 90, playing: true }));
    const command = h.commands.at(-1); h.clear();
    h.receive({ time: 90, playing: true, appliedCommand: command.id });
    assert.equal(h.emitted.filter(e => e.name === 'video_event').length, 0);
});

test('local seek blocks stale snapshots until acknowledged', () => {
    const h = harness();
    h.receive({ time: 30 }); h.reply(h.state()); h.clear();
    h.receive({ time: 120 }, [{ type: 'seek', time: 120, speed: 1 }]);
    assert.deepEqual(h.emitted.map(e => e.name), ['video_event']);
    h.sync.state(h.state({ time: 31 }));
    assert.equal(h.commands.length, 0);
    h.sync.state(h.state({ time: 120, revision: 2 }), 'playback_ack');
    h.receive();
    assert.equal(h.emitted.at(-1).name, 'playback_snapshot');
    assert.equal(h.emitted.at(-1).data.time, 120);
});

test('old revision cannot undo a newer seek', () => {
    const h = harness();
    h.receive(); h.reply(h.state({ revision: 9, time: 300 }));
    h.clear();
    h.sync.state(h.state({ revision: 8, time: 10 }), 'sync_video');
    assert.equal(h.commands.length, 0);
    assert.equal(h.sync.revision, 9);
});

test('clock offset and playback rate project a live room position', () => {
    const h = harness();
    h.receive(); h.sync.offset = 5;
    h.reply(h.state({ time: 10, playing: true, speed: 2, server_time: 103 }));
    assert.equal(h.commands.at(-1).time, 14);
});

test('scheduled resume waits instead of repeatedly seeking', () => {
    const h = harness();
    h.receive({ time: 30 });
    h.reply(h.state({ playing: true, resume_at: 102 }));
    assert.equal(h.commands.length, 0);
    h.advance(1000); h.receive();
    assert.equal(h.commands.length, 0);
    h.advance(1200); h.receive();
    assert.equal(h.commands.at(-1).playing, true);
    assert.equal(h.commands.at(-1).seek, false);
});

test('buffer recovery requests fresh state before publishing stalled progress', () => {
    const h = harness();
    h.receive({ time: 30 }); h.reply(h.state()); h.clear();
    h.receive({ ready: false }); h.advance(10000); h.receive({ ready: true });
    assert.equal(h.emitted.at(-1).name, 'request_room_state');
    assert.equal(h.emitted.filter(e => e.name === 'playback_snapshot').length, 0);
    h.reply(h.state({ time: 40, playing: true }));
    assert.equal(h.commands.at(-1).time, 40);
});

test('lost acknowledgement recovers without publishing uncertain local state', () => {
    const h = harness();
    h.receive({ time: 30 }); h.reply(h.state()); h.clear();
    h.receive({ time: 200 }, [{ type: 'seek', time: 200, speed: 1 }]);
    h.advance(5100); h.receive();
    assert.equal(h.emitted.at(-1).name, 'request_room_state');
});

test('reconnect keeps command IDs monotonic and rejects old session replies', () => {
    const h = harness();
    h.receive(); const oldReply = h.emitted[0].ack;
    h.reply(h.state()); const oldId = h.commands.at(-1).id;
    h.sync.reset(); h.receive({ session: 2 });
    oldReply({ ok: true, state: h.state({ time: 99 }) });
    assert.equal(h.sync.initialized, false);
    h.reply(h.state({ time: 90 }));
    assert.ok(h.commands.at(-1).id > oldId);
    assert.equal(h.commands.at(-1).session, 2);
});

test('delayed empty-room acknowledgement cannot overwrite a newly received pause', () => {
    const h = harness();
    h.receive();
    const reply = h.emitted[0].ack;
    h.sync.state(h.state({ time: 80, playing: false, revision: 5 }), 'sync_video');
    h.clear();
    reply({ ok: true, state: null });
    assert.equal(h.commands.length, 0);
    assert.equal(h.sync.revision, 5);
});

test('only the most recent refresh may initialize the player', () => {
    const h = harness();
    h.receive(); const first = h.emitted.at(-1).ack;
    h.advance(6000); h.receive();
    first({ ok: true, state: null });
    assert.equal(h.sync.initialized, false);
    h.reply(h.state());
    assert.equal(h.commands.at(-1).time, 30);
});

test('snapshots contain timing only even if player input includes media credentials', () => {
    const h = harness();
    h.receive({ time: 30, url: 'https://example.test/movie.mp4?token=secret', cookie: 'secret' });
    h.reply(h.state()); h.receive();
    const message = h.emitted.find(e => e.name === 'playback_snapshot');
    assert.ok(message);
    assert.equal(JSON.stringify(message.data).includes('secret'), false);
    assert.deepEqual(Object.keys(message.data).sort(), [
        'time', 'duration', 'playing', 'speed', 'readyState', 'seeking', 'observed_revision', 'recent_interaction',
    ].sort());
});

const discovery = fs.readFileSync(path.join(__dirname, '../android-app/app/src/main/assets/media-discovery.js'), 'utf8');
function discover(videos = [], resources = [], frames = []) {
    const document = { querySelectorAll(selector) {
        return selector === 'video' ? videos : selector === 'iframe' ? frames : [];
    } };
    return vm.runInNewContext(discovery, { document, URL, location: { href: 'https://public.example/watch' },
        performance: { getEntriesByType: () => resources.map(name => ({ name })) } });
}
function video(changes = {}) {
    return { currentSrc: 'https://media.example/movie.mp4', currentTime: 90, duration: 600,
        paused: false, readyState: 4, mediaKeys: null,
        getBoundingClientRect: () => ({ width: 640, height: 360 }), querySelectorAll: () => [], ...changes };
}
test('discovery recognizes visible playback and ignores segments and unrelated URLs', () => {
    const result = discover([video()], ['https://media.example/part.ts', 'https://media.example/ad.js']);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].active, true);
    assert.equal(result.candidates[0].position, 90);
});
test('network-only manifests are not marked as active playback', () => {
    const result = discover([], ['https://media.example/master.m3u8', 'http://media.example/insecure.mp4']);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].active, false);
});
test('protected video suppresses captured network candidates', () => {
    const result = discover([video({ mediaKeys: {} })], ['https://media.example/master.mpd']);
    assert.equal(result.protectedVideo, true);
    assert.equal(result.candidates.length, 0);
});
test('inaccessible frames do not break discovery', () => {
    const frame = { get contentDocument() { throw new Error('cross origin'); } };
    assert.equal(discover([video()], [], [frame]).candidates.length, 1);
});

function mobileHarness() {
    const elements = new Map(), sockets = [], intervals = [];
    const storage = new Map([['tw_client_key', 'mobile-test-client-key-1234']]);
    const element = id => {
        if (!elements.has(id)) elements.set(id, { value: id === 'roomData' ? 'mobile-test' : '',
            textContent: '', disabled: false, children: [], handlers: {},
            addEventListener(name, callback) { this.handlers[name] = callback; },
            appendChild(child) { this.children.push(child); },
            click() { this.handlers.click?.({}); },
        });
        return elements.get(id);
    };
    let boot;
    const window = { TogetherWatchNativeSync: NativeSync, addEventListener() {},
        createVoiceCallController: () => ({ handleSocketReconnect() {}, handleSocketDisconnect() {}, destroy() {} }) };
    const io = () => {
        const socket = { connected: false, handlers: {}, emitted: [],
            on(name, callback) { this.handlers[name] = callback; },
            emit(name, data, ack) { this.emitted.push({ name, data, ack }); },
            removeAllListeners() { this.handlers = {}; },
            disconnect() { this.connected = false; this.handlers.disconnect?.(); },
            connect() { this.connected = true; this.handlers.connect?.(); },
        };
        sockets.push(socket); return socket;
    };
    const context = { window, io, crypto: require('node:crypto').webcrypto,
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        document: { addEventListener: (_, callback) => { boot = callback; }, getElementById: element,
            createElement: () => ({ textContent: '' }) },
        setInterval(callback) { intervals.push(callback); return intervals.length; }, clearInterval() {},
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/js/mobile-room.js'), 'utf8'), context);
    boot();
    return { window, sockets, element, storage, bridge: window.TogetherWatchMobile };
}

test('mobile native and human sockets pair as one member; reconnect discards stale commands', () => {
    const h = mobileHarness(); h.sockets[0].connect();
    const sample = { active: true, session: 1, time: 0, duration: 600, ready: true, speed: 1, playing: false };
    h.bridge.receive(sample); h.sockets[1].connect(); h.bridge.receive(sample);
    const humanJoin = h.sockets[0].emitted.find(e => e.name === 'join').data;
    const nativeJoin = h.sockets[1].emitted.find(e => e.name === 'join').data;
    assert.equal(nativeJoin.client_key, humanJoin.client_key);
    assert.equal(nativeJoin.role, 'companion');
    h.sockets[1].handlers.sync_video({ revision: 1, time: 80, playing: false });
    h.sockets[1].disconnect();
    assert.equal(h.bridge.drain().commands.length, 0);
    h.sockets[1].connect();
    assert.equal(h.bridge.drain().commands.some(c => c.type === 'state'), false);
});

test('mobile volume changes stay on this device and coalesce instead of flooding playback commands', () => {
    const h = mobileHarness(); h.sockets[0].connect();
    h.bridge.receive({ active: true, session: 4 }); h.sockets[1].connect();
    const slider = h.element('mobileVideoVolume');
    for (let n = 0; n < 100; n++) { slider.value = n; slider.handlers.input(); }
    const commands = h.bridge.drain().commands;
    assert.equal(commands.length, 1);
    assert.equal(commands[0].type, 'volume');
    assert.equal(commands[0].session, 4);
    assert.equal(commands[0].value, 0.99);
    assert.equal(h.sockets[0].emitted.filter(e => e.name === 'video_event').length, 0);
});

test('web fallback volume targets the paired companion and suspending disconnects native sync', () => {
    const h = mobileHarness(); h.sockets[0].connect();
    const slider = h.element('mobileVideoVolume'); slider.value = 40; slider.handlers.input();
    const event = h.sockets[0].emitted.at(-1);
    assert.equal(event.name, 'companion_command');
    assert.equal(event.data.value, 0.4);
    h.bridge.receive({ active: true, session: 1 }); h.sockets[1].connect();
    h.bridge.suspend();
    assert.equal(h.sockets[1].connected, false);
    assert.equal(h.bridge.drain().commands.length, 0);
});
