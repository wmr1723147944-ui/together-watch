(() => {
    let player = null;
    let playerEvents = null;
    let remoteGuardUntil = 0;
    let bufferingTimer = null;
    let bufferingReported = false;
    let serverClockOffset = 0;
    let resumeTimer = null;
    let localVolume = 1;

    function notify(message) {
        try {
            const pending = chrome.runtime.sendMessage(message);
            pending?.catch?.(() => {});
        } catch (_error) {
            // The extension may be reloading while the content script is still alive.
        }
    }

    function report(status, detail) {
        notify({
            type: 'tw_companion_status',
            status,
            detail,
        });
    }

    function findPrimaryVideo() {
        return [...document.querySelectorAll('video')]
            .filter(video => {
                const rect = video.getBoundingClientRect();
                return rect.width >= 160 && rect.height >= 90;
            })
            .sort((left, right) => {
                const a = left.getBoundingClientRect();
                const b = right.getBoundingClientRect();
                return (b.width * b.height) - (a.width * a.height);
            })[0] || null;
    }

    function emit(type, extra = {}) {
        if (!player || Date.now() < remoteGuardUntil) return;
        notify({
            type: 'tw_video_event',
            payload: {
                type,
                time: Number.isFinite(player.currentTime) ? player.currentTime : 0,
                ...extra,
            },
        });
    }

    function sendBuffering(active) {
        notify({
            type: 'tw_buffering_event',
            payload: {
                active,
                time: Number(player?.currentTime) || 0,
            },
        });
    }

    function clearBuffering(force = false) {
        window.clearTimeout(bufferingTimer);
        if (!bufferingReported || !force) return;
        bufferingReported = false;
        sendBuffering(false);
    }

    function bindPlayer(nextPlayer) {
        if (player === nextPlayer) return;
        playerEvents?.abort();
        playerEvents = new AbortController();
        player = nextPlayer;
        try {
            player.volume = localVolume;
            player.muted = localVolume === 0;
        } catch (_error) {
            // Some mobile browsers only expose the hardware volume.
        }
        const options = { signal: playerEvents.signal };
        player.addEventListener('play', () => emit('play'), options);
        player.addEventListener('pause', () => {
            if (!player.seeking) emit('pause');
        }, options);
        player.addEventListener('seeked', () => emit('seek'), options);
        player.addEventListener('ratechange', () => {
            emit('speed', { speed: Number(player.playbackRate) || 1 });
        }, options);
        player.addEventListener('waiting', () => {
            window.clearTimeout(bufferingTimer);
            bufferingTimer = window.setTimeout(() => {
                if (!player.paused && player.readyState < 3 && !bufferingReported) {
                    bufferingReported = true;
                    sendBuffering(true);
                }
            }, 1200);
        }, options);
        for (const eventName of ['playing', 'canplay', 'canplaythrough']) {
            player.addEventListener(eventName, () => clearBuffering(true), options);
        }
        report('finding', '已找到官方页面播放器');
        notify({ type: 'tw_player_ready' });
    }

    function estimatedServerNow() {
        return Date.now() / 1000 + serverClockOffset;
    }

    function expectedPosition(state) {
        let position = Number(state?.time) || 0;
        if (state?.playing && state?.server_time) {
            position += Math.max(0, estimatedServerNow() - Number(state.server_time))
                * (Number(state.speed) || 1);
        }
        return Math.max(0, position);
    }

    function applyState(state) {
        if (!player || !state) return;
        remoteGuardUntil = Date.now() + 900;
        const position = expectedPosition(state);
        if (Math.abs((Number(player.currentTime) || 0) - position) > 0.6) {
            try {
                player.currentTime = position;
            } catch (_error) {
                // Some players reject seeks until metadata is ready.
            }
        }
        const speed = Number(state.speed);
        if (Number.isFinite(speed) && speed >= 0.25 && speed <= 4) {
            player.playbackRate = speed;
        }
        if (state.playing) {
            player.play().catch(() => {});
        } else if (!player.paused) {
            player.pause();
        }
    }

    function handleEvent(eventName, payload) {
        if (eventName === 'companion_command') {
            if (payload?.command !== 'set_volume') return;
            localVolume = Math.max(0, Math.min(1, Number(payload.value) || 0));
            if (player) {
                try {
                    player.volume = localVolume;
                    player.muted = localVolume === 0;
                } catch (_error) {
                    report('finding', '当前播放器只支持系统音量控制');
                }
            }
            return;
        }
        window.clearTimeout(resumeTimer);
        if (eventName === 'room_state') {
            const resumeAt = Number(payload?.resume_at);
            if (
                payload?.playing
                && Number.isFinite(resumeAt)
                && resumeAt > estimatedServerNow()
            ) {
                applyState({ ...payload, playing: false });
                const delay = Math.max(0, (resumeAt - estimatedServerNow()) * 1000);
                resumeTimer = window.setTimeout(() => {
                    applyState({
                        ...payload,
                        server_time: resumeAt,
                        resume_at: null,
                    });
                }, delay);
                return;
            }
            applyState(payload);
            return;
        }
        if (eventName === 'buffering_state') {
            const pausedState = {
                time: payload?.time,
                playing: false,
                speed: payload?.speed,
                server_time: payload?.server_time,
            };
            applyState(pausedState);
            if (!payload?.active && payload?.playing) {
                const resumeAt = Number(payload?.resume_at) || estimatedServerNow();
                const delay = Math.max(0, (resumeAt - estimatedServerNow()) * 1000);
                resumeTimer = window.setTimeout(() => {
                    applyState({
                        ...pausedState,
                        playing: true,
                        server_time: resumeAt,
                    });
                }, delay);
            }
            return;
        }
        if (eventName !== 'sync_video') return;
        const state = {
            time: payload?.time,
            speed: payload?.speed || player?.playbackRate || 1,
            server_time: payload?.server_time,
            playing: payload?.type === 'play',
        };
        if (payload?.type === 'pause' || payload?.type === 'seek') {
            state.playing = payload.type === 'seek' ? !player?.paused : false;
        }
        if (payload?.type === 'speed') {
            state.playing = !player?.paused;
        }
        if (['play', 'pause', 'seek', 'speed'].includes(payload?.type)) {
            applyState(state);
        }
    }

    function refreshPlayer() {
        const nextPlayer = findPrimaryVideo();
        if (nextPlayer && nextPlayer !== player) {
            bindPlayer(nextPlayer);
        } else if (!nextPlayer) {
            report('finding', '正在等待官方页面播放器');
        }
    }

    chrome.runtime.onMessage.addListener(message => {
        if (message?.type === 'tw_room_event') {
            serverClockOffset = Number(message.serverClockOffset) || 0;
            handleEvent(message.eventName, message.payload);
            return;
        }
        if (message?.type === 'tw_set_local_volume') {
            handleEvent('companion_command', {
                command: 'set_volume',
                value: message.value,
            });
            return;
        }
        if (message?.type === 'tw_clear_invite_hash' && location.hash.startsWith('#tw=')) {
            history.replaceState(null, '', `${location.pathname}${location.search}`);
        }
    });

    refreshPlayer();
    window.setInterval(refreshPlayer, 2000);
    window.addEventListener('beforeunload', () => {
        if (bufferingReported) sendBuffering(false);
    });
})();
