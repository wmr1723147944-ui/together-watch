/* Playback-only adapter. Media URLs and credentials never enter this module. */
(function (root) {
    'use strict';
    class NativeSync {
        constructor({ emit, command, now = () => Date.now() }) {
            this.emit = emit;
            this.command = command;
            this.now = now;
            // Survive reconnects and WebView reloads while the same native
            // player still holds the last applied command number.
            this.commandId = Date.now() * 1000;
            this.epoch = 0;
            this.reset();
        }
        reset() {
            this.revision = 0;
            this.offset = 0;
            this.initialized = false;
            this.pending = null;
            this.sample = null;
            this.lastSnapshot = 0;
            this.epoch++;
            this.awaitingCommand = 0;
            this.pendingLocal = 0;
            this.localSince = 0;
            this.roomDuration = 0;
            this.requestedAt = 0;
            this.resumeAt = 0;
            this.session = null;
            this.requestId = 0;
            this.stateVersion = 0;
        }
        state(payload, event = 'room_state') {
            if (!payload) {
                this.stateVersion++;
                this.initialized = true;
                this.pending = { time: this.sample?.time || 0, playing: true, speed: 1,
                    server_time: this.now() / 1000 + this.offset };
                this.apply(true);
                return;
            }
            const revision = Number(payload.revision);
            if (!Number.isFinite(revision) || revision < this.revision) return;
            this.stateVersion++;
            this.revision = revision;
            this.initialized = true;
            if (Number(payload.duration) > 0) this.roomDuration = Number(payload.duration);
            if (event === 'playback_ack') {
                this.pendingLocal = Math.max(0, this.pendingLocal - 1);
                return;
            }
            if (event === 'sync_video' || payload.force_sync) this.pendingLocal = 0;
            if (this.pendingLocal) return;
            const time = Number(payload.time);
            if (!Number.isFinite(time) || time < 0) return;
            this.pending = { ...payload };
            if (event === 'buffering_state' && payload.active) this.pending.playing = false;
            this.apply(event === 'sync_video' || Boolean(payload.force_sync));
        }
        apply(force = false) {
            if (!this.pending || !this.sample?.ready) return;
            const state = this.pending;
            this.pending = null;
            const speed = Math.min(4, Math.max(0.25, Number(state.speed) || 1));
            const serverNow = this.now() / 1000 + this.offset;
            const startAt = Number(state.resume_at) || 0;
            const playing = Boolean(state.playing) && startAt <= serverNow;
            let time = Number(state.time);
            if (playing && Number.isFinite(Number(state.server_time))) {
                time += Math.max(0, serverNow - Math.max(Number(state.server_time), startAt)) * speed;
            }
            if (this.sample.duration > 0) time = Math.min(time, this.sample.duration);
            const seek = Math.abs(time - this.sample.time) > (force ? 0.35 : 2);
            this.resumeAt = startAt > serverNow && state.playing ? startAt : 0;
            if (this.resumeAt) this.resumeState = { ...state, server_time: startAt, resume_at: null };
            if (!seek && playing === this.sample.playing && Math.abs(speed - this.sample.speed) < 0.01) return;
            this.awaitingCommand = ++this.commandId;
            this.command({ type: 'state', session: this.session, id: this.commandId,
                time, speed, playing, seek, issuedAt: this.now() });
        }
        receive(sample, events = []) {
            if (!sample || !Number.isFinite(sample.time)) return;
            const recovered = this.sample && !this.sample.ready && sample.ready;
            this.sample = sample;
            if (this.session !== sample.session) {
                this.session = sample.session;
                this.awaitingCommand = 0;
                this.pending = null;
                this.resumeAt = 0;
                this.initialized = false;
                this.pendingLocal = 0;
                this.refresh();
            } else if (recovered || (this.pendingLocal && this.now() - this.localSince > 5000)
                || (!this.initialized && this.now() - this.requestedAt > 5000)) {
                // Recover locally instead of reporting a stale buffered frame
                // as the new room position. Missing acknowledgements retry.
                this.refresh();
            }
            if (sample.appliedCommand >= this.awaitingCommand) this.awaitingCommand = 0;
            // Explicit UI actions are independent of player callbacks, so a
            // remote seek can never masquerade as a fresh local seek.
            if (this.initialized) for (const event of events.slice(-16)) {
                if (!['play', 'pause', 'seek', 'speed'].includes(event.type)) continue;
                this.resumeAt = 0;
                this.pending = null;
                this.pendingLocal++;
                this.localSince = this.now();
                this.emit('video_event', { type: event.type, time: event.time, speed: event.speed });
            }
            if (this.resumeAt && this.now() / 1000 + this.offset >= this.resumeAt) {
                this.pending = this.resumeState;
                this.resumeAt = 0;
            }
            this.apply();
            if (!this.initialized || !sample.ready || sample.seeking || this.awaitingCommand
                || this.pendingLocal || this.resumeAt || this.now() - this.lastSnapshot < 3000) return;
            this.lastSnapshot = this.now();
            this.emit('playback_snapshot', {
                time: sample.time, duration: sample.duration, playing: sample.playing,
                speed: sample.speed, readyState: sample.ready ? 4 : 2, seeking: sample.seeking,
                observed_revision: this.revision, recent_interaction: events.length > 0,
            });
        }
        refresh() {
            this.initialized = false;
            this.pendingLocal = 0;
            this.requestedAt = this.now();
            const session = this.session;
            const epoch = this.epoch;
            const requestId = ++this.requestId;
            const stateVersion = this.stateVersion;
            this.emit('request_room_state', {}, response => {
                // A retry or newer broadcast supersedes this reply. In
                // particular, an old "empty room" reply must not undo a seek.
                if (this.epoch === epoch && this.session === session
                    && this.requestId === requestId && this.stateVersion === stateVersion
                    && response?.ok) this.state(response.state);
            });
        }
    }
    if (typeof module !== 'undefined') module.exports = NativeSync;
    else root.TogetherWatchNativeSync = NativeSync;
})(typeof window === 'undefined' ? globalThis : window);
