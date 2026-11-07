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
        clientId: () => 'local-player',
        emit: (name, data, ack) => emitted.push({ name, data, ack }),
        command: data => commands.push(data),
        cancelCommand: () => { commands.length = 0; },
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

test('a fresh local play cancels an unapplied correction and its command wait', () => {
    const h = harness();
    h.receive({ time: 30, playing: true }); h.reply(h.state({ time: 30, playing: true }));
    h.sync.state(h.state({ revision: 2, time: 30, playing: false }));
    assert.equal(h.commands.at(-1).playing, false);
    h.receive({ playing: true }, [{ type: 'play', time: 30, speed: 1 }]);
    assert.equal(h.commands.length, 0);
    assert.equal(h.sync.awaitingCommand, 0);
    h.sync.state(h.state({ revision: 3, playing: true }), 'playback_ack');
    h.advance(3100); h.receive();
    assert.equal(h.emitted.at(-1).name, 'playback_snapshot');
    assert.equal(h.emitted.at(-1).data.playing, true);
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

test('reloading a failed native URL resumes the same episode with fresh room progress', () => {
    const h = harness();
    h.receive({ time: 420 }); h.reply(h.state({ time: 420 })); h.clear();
    h.receive({ session: 2, time: 420, ready: false });
    h.reply(h.state({ time: 430, revision: 2, playing: true }));
    assert.equal(h.commands.length, 0, 'do not command a player that is still loading');
    h.advance(10000); h.receive({ ready: true });
    h.reply(h.state({ time: 440, revision: 3, playing: true }));
    const command=h.commands.at(-1);
    assert.equal(command.session, 2); assert.equal(command.time, 440);
    assert.equal(h.emitted.filter(e=>e.name==='video_event' || e.name==='playback_snapshot').length, 0);
    h.receive({ time: 440, playing: true, appliedCommand: command.id });
    assert.equal(h.emitted.at(-1).data.time, 440);
});

test('buffer recovery does not discard a fresh local play or replay the old pause', () => {
    const h = harness();
    h.receive({ time: 30 }); h.reply(h.state()); h.clear();
    h.receive({ ready: false }); h.advance(10000);
    h.receive({ ready: true, playing: true }, [{ type: 'play', time: 30, speed: 1 }]);
    assert.equal(h.emitted.filter(e => e.name === 'video_event').length, 1);
    h.reply(h.state({ playing: false }));
    assert.equal(h.commands.length, 0, 'an older refresh must not cancel the user play');
    h.sync.state(h.state({ playing: true, revision: 2 }), 'playback_ack');
    h.receive();
    assert.equal(h.emitted.at(-1).data.playing, true);
});

test('first local pause survives a delayed empty-room initialization', () => {
    const h = harness();
    h.receive({ time: 20 }, [{ type: 'pause', time: 20, speed: 1 }]);
    assert.equal(h.emitted.filter(e => e.name === 'video_event').length, 1);
    h.reply(null);
    assert.equal(h.commands.length, 0);
});

test('periodic echo of our own snapshot cannot pause or seek the local leader', () => {
    const h = harness();
    h.receive({ time: 30 }); h.reply(h.state()); h.clear();
    h.receive({ time: 33, playing: true });
    h.sync.state(h.state({ revision: 2, playing: false, playback_owner: 'local-player' }));
    assert.equal(h.commands.length, 0);
    assert.equal(h.sync.revision, 2);
    h.sync.state(h.state({ revision: 3, time: 10, playing: false, playback_owner: 'other-player' }));
    assert.equal(h.commands.at(-1).playing, false, 'a peer must still be able to pause');
    assert.equal(h.commands.at(-1).time, 10);
});

test('own echo updates revision without rolling back a buffered local position', () => {
    const h = harness();
    h.receive({ time: 30 }); h.reply(h.state()); h.clear();
    h.receive({ ready: false }); h.advance(10000); h.receive({ ready: true, time: 31, playing: true });
    h.reply(h.state({ revision: 3, time: 45, playing: false, playback_owner: 'local-player', force_sync: true }));
    assert.equal(h.commands.length, 0);
    h.receive();
    assert.equal(h.emitted.at(-1).name, 'playback_snapshot');
    assert.equal(h.emitted.at(-1).data.time, 31);
    assert.equal(h.emitted.at(-1).data.observed_revision, 3);
});

test('buffer holds and scheduled group resumes still reach the local controller', () => {
    const h = harness();
    h.receive({ time: 30, playing: true }); h.reply(h.state({ playing: true })); h.clear();
    h.sync.state(h.state({ revision: 2, playing: false, active: true, playback_owner: 'local-player' }), 'buffering_state');
    assert.equal(h.commands.at(-1).playing, false);
    const command = h.commands.at(-1); h.clear();
    h.receive({ playing: false, appliedCommand: command.id });
    h.sync.state(h.state({ revision: 3, playing: true, resume_at: 102, playback_owner: 'local-player' }));
    assert.equal(h.commands.length, 0);
    h.advance(2200); h.receive();
    assert.equal(h.commands.at(-1).playing, true);
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
    assert.equal(result.candidates[0].visible, false);
});
test('Kanju-style CDN URLs: accept the decoded player URL, never infer a movie from signed traffic',()=>{
    const stream='https://cdn.example/opaqueId123?expires=123&sig=example';
    const other='https://cdn.example/otherToken';
    const v=video({currentSrc:stream,paused:true});
    const r=discover([v],[other,stream]);
    assert.equal(r.longFormPlayers,1);
    assert.deepEqual(Array.from(r.candidates,c=>c.url),[stream]);
    assert.equal(r.candidates[0].confirmed,true);
    assert.equal(discover([],[stream]).candidates.length,0);
    const alias='https://cdn.byteimg.com/v/token.v2.image?sig=example';
    assert.equal(discover([video({currentSrc:alias})]).candidates[0].confirmed,true);
    assert.equal(discover([],[alias]).candidates.length,0);
    assert.equal(discover([video({currentSrc:alias,readyState:0})]).candidates.length,0);
    for(const changes of [{readyState:0},{duration:NaN},{currentSrc:'',src:stream},{srcObject:{}},
        {getBoundingClientRect:()=>({width:5,height:5})},{mediaKeys:{}}]){
        assert.equal(discover([video({currentSrc:stream,...changes})],[stream]).candidates.length,0);
    }
    for(const u of ['http://cdn.example/id','https://user@cdn.example/id','https://cdn.example/part.m4s',
        'https://cdn.example/episode.html','https://cdn.example/auth.key','https://cdn.example/?file=test.mp4']){
        assert.equal(discover([video({currentSrc:u})]).candidates.length,0);
    }
});
test('a bound HLS instance retains its format even with an extensionless playlist',()=>{
    const v=video({currentSrc:'blob:https://public.example/id'});
    v.hls={media:v,url:'https://cdn.example/playlistID'};
    const r=discover([v]);assert.equal(r.candidates[0].confirmed,true);
    assert.equal(r.candidates[0].mime,'application/x-mpegURL');
});
test('an unbound blob may be retained in its original player, never mistaken for a native URL',()=>{
    const v=video({currentSrc:'blob:https://www.kanju.ai/local',paused:true});
    const r=discover([v],['https://cdn.example/other']);
    assert.equal(r.candidates.length,0);
    assert.equal(r.readyBlobPlayers,1);
    assert.equal(discover([video({...v,readyState:0})]).readyBlobPlayers,0);
    assert.equal(discover([video({...v,duration:15})]).readyBlobPlayers,0);
    assert.equal(discover([video({...v,mediaKeys:{}})]).readyBlobPlayers,0);
    assert.equal(discover([v,video()]).longFormPlayers,2);
});
test('Android discovery retains the confirmed element above a busy network log',()=>{
    const noise=Array.from({length:80},(_,n)=>'https://cdn.example/'+n+'.m3u8');
    const result=discover([video()],noise);
    assert.equal(result.candidates.length,24);
    assert.equal(result.candidates[0].url,'https://media.example/movie.mp4');
    assert.equal(result.candidates[0].visible,true);
    assert.ok(result.candidates.slice(1).every(c=>!c.visible));
});
test('blob playback uses only a manifest attached to this exact video',()=>{
    const v=video({currentSrc:'blob:https://public.example/123',paused:true});
    const win={hls:{media:{},url:'https://ads.example/ad.m3u8'}};
    v.ownerDocument={baseURI:'https://frame.example/movies/page',defaultView:win};
    assert.equal(discover([v]).candidates.length,0);
    win.dp={plugins:{hls:{media:v,url:'episode/master.m3u8'}}};
    const r=discover([v]);
    assert.equal(r.candidates.length,1);
    assert.equal(r.candidates[0].url,'https://frame.example/movies/episode/master.m3u8');
    assert.equal(r.candidates[0].visible,true);
    v.mediaKeys={};assert.equal(discover([v]).candidates.length,0);
});
test('a single source child can supply the visible player URL; multiple choices stay manual',()=>{
    const src={src:'https://cdn.example/one.mp4'};
    const v=video({currentSrc:'',querySelectorAll:()=>[src]});
    assert.equal(discover([v]).candidates[0].visible,true);
    v.querySelectorAll=()=>[src,{src:'https://cdn.example/two.mp4'}];
    assert.ok(discover([v]).candidates.every(c=>!c.visible));
});
test('preload none requests metadata only, without clicking or playing the hidden site',()=>{
    const v=video({preload:'none',readyState:0,paused:true,play:()=>assert.fail('autoplay')});
    const r=discover([v]);assert.equal(v.preload,'metadata');
    assert.equal(r.candidates[0].visible,false);
});
test('a paused long-form video can be recognized without playing the source page', () => {
    const result=discover([video({paused:true})],['https://media.example/movie.mp4']);
    assert.equal(result.candidates.length,1);
    assert.equal(result.candidates[0].active,false);
    assert.equal(result.candidates[0].visible,true);
    assert.equal(result.candidates[0].duration,600);
    assert.equal(discover([video({readyState:0})]).candidates[0].visible,false);
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
            textContent: '', disabled: false, children: [], handlers: {}, dataset: {},
            addEventListener(name, callback) { this.handlers[name] = callback; },
            appendChild(child) { this.children.push(child); },
            click() { this.handlers.click?.({}); },
        });
        return elements.get(id);
    };
    let boot;
    const window = { TogetherWatchNativeSync: NativeSync, addEventListener() {},
        // Playback transport unit tests isolate the independently tested room experience.
        createRoomExperience: () => ({program(){},context(){},receive(){},overlay(){return null;},send(){return true;},destroy(){}}),
        createVoiceCallController: () => ({ handleSocketReconnect() {}, handleSocketDisconnect() {}, destroy() {} }) };
    const io = () => {
        const socket = { id: `socket-${sockets.length}`, connected: false, handlers: {}, emitted: [],
            on(name, callback) { this.handlers[name] = callback; },
            emit(name, data, ack) { this.emitted.push({ name, data, ack, argumentCount: arguments.length }); },
            removeAllListeners() { this.handlers = {}; },
            disconnect() { this.connected = false; this.handlers.disconnect?.(); },
            connect() { this.connected = true; this.handlers.connect?.(); },
        };
        sockets.push(socket); return socket;
    };
    const context = { window, io, crypto: require('node:crypto').webcrypto,
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        document: { addEventListener: (_, callback) => { boot = callback; }, getElementById: element,
            createElement: () => ({ textContent: '', children: [], appendChild(child) { this.children.push(child); } }),
            createTextNode: text => ({ textContent: text, nodeType: 3 }) },
        setInterval(callback) { intervals.push(callback); return intervals.length; }, clearInterval() {},
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/js/mobile-room.js'), 'utf8'), context);
    boot();
    return { window, sockets, element, storage, bridge: window.TogetherWatchMobile };
}

test('room styling keeps chat text safe and clears connected indicator on failure', () => {
    const h = mobileHarness(), socket = h.sockets[0]; socket.connect();
    assert.equal(h.element('mobileStatus').dataset.connected, 'true');
    socket.handlers.chat_message({username:'<b>朋友</b>', message:'<img src=x onerror=alert(1)>'});
    const row = h.element('chatContainer').children.at(-1);
    assert.equal(row.className, 'chat-line');
    assert.equal(row.children[0].textContent, '<b>朋友</b>');
    assert.equal(row.children[1].nodeType, 3);
    assert.equal(row.children[1].textContent, '<img src=x onerror=alert(1)>');
    socket.handlers.status({msg:'朋友加入了房间'});
    assert.equal(h.element('chatContainer').children.at(-1).className, 'room-event');
    socket.handlers.connect_error();
    assert.equal(h.element('mobileStatus').dataset.connected, undefined);
    socket.connect(); socket.disconnect();
    assert.equal(h.element('mobileStatus').dataset.connected, undefined);
});

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

test('mobile emits one payload and only includes a real acknowledgement callback', () => {
    const h = mobileHarness(); h.sockets[0].connect();
    const sample = { active: true, session: 1, time: 10, duration: 600, ready: true, speed: 1, playing: false, appliedCommand: Number.MAX_SAFE_INTEGER };
    h.bridge.receive(sample); h.sockets[1].connect(); h.bridge.receive(sample);
    const refresh = h.sockets[1].emitted.find(e => e.name === 'request_room_state' && typeof e.ack === 'function');
    assert.equal(refresh.argumentCount, 3);
    refresh.ack({ ok: true, state: { revision: 1, time: 10, playing: false } });
    h.bridge.receive(sample);
    h.bridge.receive({ ...sample, time: 12, events: [{ type: 'seek', time: 12, speed: 1 }] });
    for (const name of ['playback_snapshot', 'video_event']) {
        const message = h.sockets[1].emitted.find(e => e.name === name);
        assert.ok(message, name);
        assert.equal(message.argumentCount, 2, name + ' must not send an undefined second payload');
    }
});

test('mobile bridge identifies its own controller but still applies peer controls', () => {
    const h = mobileHarness(); h.sockets[0].connect();
    const sample = { active: true, session: 1, time: 30, duration: 600, ready: true, speed: 1, playing: false };
    h.bridge.receive(sample); h.sockets[1].connect(); h.bridge.receive(sample);
    const refresh = h.sockets[1].emitted.find(e => e.name === 'request_room_state' && e.ack);
    refresh.ack({ ok: true, state: { revision: 1, time: 30, playing: false } });
    h.bridge.drain();
    h.bridge.receive({ ...sample, playing: true });
    h.sockets[1].handlers.room_state({ revision: 2, time: 30, playing: false, playback_owner: h.sockets[1].id });
    assert.equal(h.bridge.drain().commands.length, 0);
    h.sockets[1].handlers.sync_video({ revision: 3, time: 40, playing: false });
    assert.equal(h.bridge.drain().commands.at(-1).playing, false);
});

test('mobile drops superseded playback commands but retains this device volume', () => {
    const h = mobileHarness(); h.sockets[0].connect();
    const sample = { active: true, session: 1, time: 30, duration: 600, ready: true, speed: 1, playing: false };
    h.bridge.receive(sample); h.sockets[1].connect(); h.bridge.receive(sample);
    h.sockets[1].handlers.sync_video({ revision: 1, time: 60, playing: false });
    h.bridge.receive({ ...sample, playing: true, events: [{ type: 'play', time: 30, speed: 1 }] });
    const commands = h.bridge.drain().commands;
    assert.equal(commands.length, 1);
    assert.equal(commands[0].type, 'volume');
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

test('original site episode switch never broadcasts its progress under the previous room episode',()=>{
    const h=mobileHarness();h.sockets[0].connect();
    const program={source:'kanju',item:'av-test',episode:'ep-one'};
    h.sockets[0].handlers.room_program({revision:1,program});h.bridge.applyProgram(1);
    const sample={active:true,session:1,time:60,duration:600,ready:true,speed:1,playing:true,program_revision:1,history_context:{program}};
    h.bridge.receive(sample);h.sockets[1].connect();h.bridge.receive(sample);
    const before=h.sockets.length;
    h.bridge.receive({...sample,history_context:{program:{...program,episode:'ep-two'}},events:[{type:'seek',time:70,speed:1}]});
    assert.equal(h.sockets[1].connected,false);assert.equal(h.sockets.length,before);assert.equal(h.bridge.drain().commands.length,0);
    assert.match(h.element('mobilePlayerStatus').textContent,/原站已切换集数/);
});
