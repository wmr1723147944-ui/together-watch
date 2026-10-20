window.createVoiceCallController = ({
    socket,
    roomId,
    username,
    addSystemMessage,
}) => {
    const joinButton = document.getElementById('joinCallBtn');
    const callDock = document.getElementById('callDock');
    const callStatus = document.getElementById('callStatus');
    const callCount = document.getElementById('callCount');
    const callNetwork = document.getElementById('callNetwork');
    const muteButton = document.getElementById('muteCallBtn');
    const leaveButton = document.getElementById('leaveCallBtn');
    const audioContainer = document.getElementById('remoteAudioContainer');
    const callVolumeSlider = document.getElementById('callVolumeSlider');
    const callVolumeValue = document.getElementById('callVolumeValue');

    let localStream = null;
    let joined = false;
    let joining = false;
    let muted = false;
    let selfId = '';
    let iceServers = [];
    let turnConfigured = false;
    let warnedMissingTurn = false;
    let warnedAutoplay = false;
    let warnedNetworkNeedsTurn = false;
    let callGeneration = 0;
    let reconnectTimer = null;
    let audioContext = null;
    const storedCallVolumeRaw = localStorage.getItem('tw_call_volume');
    const storedCallVolume = Number(storedCallVolumeRaw);
    let callVolume = storedCallVolumeRaw !== null && Number.isFinite(storedCallVolume)
        ? Math.max(0, Math.min(100, storedCallVolume))
        : 100;
    const peers = new Map();
    const queuedCandidates = new Map();
    const peerAudioNodes = new Map();

    const supported = Boolean(
        navigator.mediaDevices?.getUserMedia
        && window.RTCPeerConnection,
    );
    if (!supported) {
        joinButton.disabled = true;
        joinButton.textContent = '浏览器不支持语音';
    }

    function setCallVolume(nextVolume) {
        callVolume = Math.max(0, Math.min(100, Math.round(Number(nextVolume) || 0)));
        const normalized = callVolume / 100;
        if (callVolumeSlider) callVolumeSlider.value = String(callVolume);
        if (callVolumeValue) {
            callVolumeValue.textContent = callVolume === 0 ? '静音' : `${callVolume}%`;
        }
        localStorage.setItem('tw_call_volume', String(callVolume));
        peerAudioNodes.forEach(record => {
            if (record.audio) record.audio.volume = normalized;
            if (record.gain) record.gain.gain.value = normalized;
        });
    }

    function unlockCallAudio() {
        if (!joined && !joining) return;
        audioContext?.resume?.().catch(() => {});
        peerAudioNodes.forEach(record => {
            if (record.audio?.paused) record.audio.play().catch(() => {});
        });
    }
    window.addEventListener('pointerdown', unlockCallAudio, { passive: true });

    async function attachRemoteAudio(peerId, stream) {
        const previous = peerAudioNodes.get(peerId);
        previous?.source?.disconnect();
        previous?.gain?.disconnect();
        previous?.audio?.remove();
        peerAudioNodes.delete(peerId);

        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        audio.muted = false;
        audio.dataset.peerId = peerId;
        audio.volume = callVolume / 100;
        audio.srcObject = stream;
        audioContainer.appendChild(audio);
        const record = { audio };
        // GainNode works independently of the system volume on mobile browsers
        // that do not honor HTMLMediaElement.volume.
        if (audioContext && audioContext.state !== 'closed') {
            try {
                record.source = audioContext.createMediaStreamSource(stream);
                record.gain = audioContext.createGain();
                record.gain.gain.value = callVolume / 100;
                record.source.connect(record.gain);
                record.gain.connect(audioContext.destination);
                audio.muted = true; // The audio graph is the only audible path.
            } catch (_error) {
                record.source?.disconnect();
                record.gain?.disconnect();
                record.source = null;
                record.gain = null;
            }
        }
        peerAudioNodes.set(peerId, record);
        try {
            await audio.play();
            if (peerAudioNodes.get(peerId)?.audio !== audio || !joined) return;
            callStatus.textContent = record.gain && audioContext?.state !== 'running'
                ? '点一下页面以播放通话声音'
                : '通话音频已连接';
        } catch (_error) {
            callStatus.textContent = '点一下页面以播放通话声音';
            if (!warnedAutoplay) {
                warnedAutoplay = true;
                addSystemMessage('🔊 浏览器暂停了通话声音，请点击房间页面任意位置恢复播放。');
            }
            window.addEventListener('pointerdown', () => {
                if (peerAudioNodes.get(peerId)?.audio !== audio || !joined) return;
                audio.play().then(() => {
                    callStatus.textContent = '通话音频已连接';
                }).catch(() => {});
            }, { capture: true, once: true });
        }
    }

    setCallVolume(callVolume);
    callVolumeSlider?.addEventListener('input', () => {
        setCallVolume(callVolumeSlider.value);
    });

    function signalPayload(payload = {}) {
        return { room: roomId, ...payload };
    }

    function closePeer(peerId) {
        const record = peers.get(peerId);
        if (record) {
            peers.delete(peerId);
            record.events.abort();
            window.clearTimeout(record.restartTimer);
            record.connection.close();
        }
        queuedCandidates.delete(peerId);
        const audioRecord = peerAudioNodes.get(peerId);
        audioRecord?.source?.disconnect();
        audioRecord?.gain?.disconnect();
        audioRecord?.audio?.remove();
        peerAudioNodes.delete(peerId);
        audioContainer
            .querySelectorAll('audio')
            .forEach(audio => {
                if (audio.dataset.peerId === peerId) audio.remove();
            });
        updateConnectionSummary();
    }

    function closeAllPeers() {
        Array.from(peers.keys()).forEach(closePeer);
        queuedCandidates.clear();
    }

    function updateConnectionSummary(memberTotal = null) {
        const records = Array.from(peers.values());
        const connected = records.filter(
            record => record.connection.connectionState === 'connected',
        ).length;
        const expected = memberTotal === null
            ? records.length
            : Math.max(0, memberTotal - 1);
        if (!expected) {
            callNetwork.textContent = '等待其他成员';
        } else if (connected >= expected) {
            callNetwork.textContent = `${connected}/${expected} 路已连接`;
        } else {
            callNetwork.textContent = `正在连接 ${connected}/${expected}`;
        }
    }

    async function flushCandidates(peerId) {
        const record = peers.get(peerId);
        const candidates = queuedCandidates.get(peerId) || [];
        if (!record?.connection.remoteDescription) return;
        queuedCandidates.delete(peerId);
        for (const candidate of candidates) {
            try {
                await record.connection.addIceCandidate(candidate);
            } catch (error) {
                console.debug('Unable to add queued ICE candidate:', error);
            }
        }
    }

    function createPeer(peerId, initiator = false) {
        const existing = peers.get(peerId);
        if (existing) {
            if (initiator) existing.initiator = true;
            return existing.connection;
        }

        const connection = new RTCPeerConnection({
            iceServers,
            iceCandidatePoolSize: 4,
        });
        const record = { connection, initiator, restartTimer: null, events: new AbortController() };
        const options = { signal: record.events.signal };
        peers.set(peerId, record);

        localStream?.getTracks().forEach(track => {
            connection.addTrack(track, localStream);
        });

        connection.addEventListener('icecandidate', event => {
            if (!joined || !socket.connected || peers.get(peerId) !== record) return;
            if (event.candidate) {
                socket.emit(
                    'webrtc_ice',
                    signalPayload({
                        target: peerId,
                        candidate: event.candidate.toJSON(),
                    }),
                );
            }
        }, options);

        connection.addEventListener('track', event => {
            if (!joined || peers.get(peerId) !== record) return;
            const stream = event.streams[0] || new MediaStream([event.track]);
            attachRemoteAudio(peerId, stream);
        }, options);

        connection.addEventListener('connectionstatechange', () => {
            const state = connection.connectionState;
            updateConnectionSummary();
            if (state === 'failed' && record.initiator && !record.restartTimer) {
                record.restartTimer = window.setTimeout(async () => {
                    record.restartTimer = null;
                    try {
                        await makeOffer(peerId, true);
                    } catch (error) {
                        console.debug('ICE restart failed:', error);
                    }
                }, 1200);
            } else if (state === 'closed') {
                closePeer(peerId);
            }
        }, options);
        connection.addEventListener('iceconnectionstatechange', () => {
            const state = connection.iceConnectionState;
            if (state === 'checking') {
                callNetwork.textContent = '正在建立音频通道';
            } else if (state === 'connected' || state === 'completed') {
                updateConnectionSummary();
            } else if (state === 'failed') {
                callNetwork.textContent = turnConfigured
                    ? '音频连接失败，正在重试'
                    : '当前网络需要 TURN 中继';
                if (!turnConfigured && !warnedNetworkNeedsTurn) {
                    warnedNetworkNeedsTurn = true;
                    addSystemMessage('⚠️ 双方网络无法直接建立语音连接，需要配置 TURN 中继后才能通话。');
                }
            } else if (state === 'disconnected') {
                callNetwork.textContent = '音频连接暂时中断';
            }
        }, options);

        return connection;
    }

    async function makeOffer(peerId, iceRestart = false) {
        if (!joined || !socket.connected) return;
        const generation = callGeneration;
        const connection = createPeer(peerId, true);
        const offer = await connection.createOffer({ iceRestart });
        if (!joined || generation !== callGeneration || peers.get(peerId)?.connection !== connection) return;
        await connection.setLocalDescription(offer);
        if (!joined || generation !== callGeneration || !socket.connected) return;
        socket.emit(
            'webrtc_offer',
            signalPayload({
                target: peerId,
                description: connection.localDescription.toJSON(),
            }),
        );
    }

    function microphoneErrorMessage(error) {
        const androidApp = /Android/i.test(navigator.userAgent || '')
            && /\bwv\b/i.test(navigator.userAgent || '');
        const permissionHelp = androidApp
            ? '请到手机设置 → 应用 → 一起看 → 权限，允许使用麦克风，并检查系统麦克风总开关。'
            : '请在浏览器的网站权限和系统设置中允许麦克风。';
        // Secure context is separate from device/permission failures. Do not
        // tell a user already on HTTPS to fix their URL for every error.
        if (window.isSecureContext === false) {
            return '❌ 当前页面不是安全连接，请通过 HTTPS 打开房间后重试。';
        }
        switch (error?.name) {
            case 'NotAllowedError':
            case 'PermissionDeniedError':
                return `❌ 麦克风访问被拒绝（NotAllowedError）。${permissionHelp}`;
            case 'NotFoundError':
            case 'DevicesNotFoundError':
                return '❌ 未找到可用的麦克风（NotFoundError）。'
                    + (androidApp ? '请更新一起看 APP 到 0.2.2 或更新版本；旧版缺少 WebView 音频设备权限。' : '请确认设备已连接并在系统中启用。');
            case 'NotReadableError':
            case 'TrackStartError':
                return '❌ 麦克风无法启动（NotReadableError）。请检查系统麦克风开关，结束其他通话或录音后重试。'
                    + (androidApp ? '旧版一起看 APP 请先更新到 0.2.2 或更新版本。' : '');
            case 'OverconstrainedError':
            case 'ConstraintNotSatisfiedError':
                return '❌ 当前麦克风不支持请求的录音参数（OverconstrainedError），请换用手机自带麦克风或其他输入设备后重试。';
            case 'AbortError':
                return '❌ 麦克风启动被中断（AbortError），请保持房间在前台，再点一次「加入语音」。';
            case 'SecurityError':
                return '❌ 系统或网页安全策略禁止录音（SecurityError）。请检查应用权限与系统限制，不要关闭 HTTPS 校验。';
            default: {
                const name = /^[A-Za-z][A-Za-z0-9]{0,48}$/.test(error?.name || '') ? error.name : 'UnknownError';
                return `❌ 无法启用麦克风（${name}）。请将这条错误、手机型号和 APP 版本反馈给维护者。`;
            }
        }
    }

    async function joinCall() {
        if (!supported || joined || joining) return;
        if (!socket.connected) {
            addSystemMessage('房间正在重连，请连接恢复后再加入语音。');
            return;
        }
        const generation = ++callGeneration;
        joining = true;
        try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass && !audioContext) audioContext = new AudioContextClass();
            unlockCallAudio();
        } catch (_error) {
            audioContext = null;
        }
        joinButton.disabled = true;
        joinButton.textContent = '正在获取麦克风…';

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                },
            });
            if (generation !== callGeneration || !socket.connected) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            localStream = stream;
            joined = true;
            muted = false;
            callDock.classList.remove('hidden');
            joinButton.classList.add('hidden');
            muteButton.textContent = '🎙 静音';
            callStatus.textContent = '正在加入通话…';
            socket.emit('call_join', signalPayload());
        } catch (error) {
            if (generation !== callGeneration) return;
            addSystemMessage(microphoneErrorMessage(error));
        } finally {
            if (generation === callGeneration) joining = false;
            if (generation === callGeneration && !joined) {
                audioContext?.close?.().catch(() => {});
                audioContext = null;
                joinButton.disabled = !supported;
                joinButton.textContent = '🎙 加入语音';
            }
        }
    }

    function leaveCall({ notify = true, keepStream = false } = {}) {
        ++callGeneration;
        joining = false;
        window.clearTimeout(reconnectTimer);
        if (notify && socket.connected) {
            socket.emit('call_leave', signalPayload());
        }
        closeAllPeers();
        if (!keepStream) {
            audioContext?.close?.().catch(() => {});
            audioContext = null;
            localStream?.getTracks().forEach(track => track.stop());
            localStream = null;
            joined = false;
            muted = false;
            callDock.classList.add('hidden');
            joinButton.classList.remove('hidden');
            joinButton.disabled = !supported;
            joinButton.textContent = '🎙 加入语音';
        }
    }

    function toggleMute() {
        if (!localStream) return;
        muted = !muted;
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !muted;
        });
        muteButton.textContent = muted ? '🔇 取消静音' : '🎙 静音';
        callStatus.textContent = muted ? '麦克风已静音' : '通话中';
        socket.emit('call_mute', signalPayload({ muted }));
    }

    socket.on('call_ready', async data => {
        if (!joined) return;
        selfId = data.self_id;
        if (muted) socket.emit('call_mute', signalPayload({ muted: true }));
        iceServers = Array.isArray(data.ice_servers) ? data.ice_servers : [];
        turnConfigured = Boolean(data.turn_configured);
        if (data.turn_configured === false && !warnedMissingTurn) {
            warnedMissingTurn = true;
            addSystemMessage(
                '⚠️ 当前语音仅使用 STUN。普通网络通常可用，但公司网络、校园网或严格 NAT 下可能无法连通；公网部署后请配置 TURN。',
            );
        }
        callStatus.textContent = '通话中';
        const members = Array.isArray(data.members) ? data.members : [];
        for (const member of members) {
            try {
                await makeOffer(member.id);
            } catch (error) {
                console.error('Unable to create WebRTC offer:', error);
            }
        }
    });

    socket.on('call_error', data => {
        addSystemMessage(`❌ ${data?.message || '无法加入语音通话。'}`);
        leaveCall({ notify: false });
    });

    socket.on('call_member_joined', data => {
        if (joined) {
            callStatus.textContent = `${data.username} 正在加入通话`;
        }
    });

    socket.on('call_member_left', data => {
        closePeer(data.id);
        if (joined && data.username) {
            callStatus.textContent = `${data.username} 已离开通话`;
        }
    });

    socket.on('call_presence', data => {
        const count = Number(data?.count) || 0;
        callCount.textContent = `${count} 人在通话`;
        updateConnectionSummary(count);
        if (joined && count > 0 && callStatus.textContent.includes('正在加入')) {
            callStatus.textContent = '通话中';
        }
    });

    socket.on('webrtc_offer', async data => {
        if (!joined || !data?.from || !data.description) return;
        try {
            const generation = callGeneration;
            const connection = createPeer(data.from, false);
            await connection.setRemoteDescription(data.description);
            if (!joined || generation !== callGeneration) return;
            await flushCandidates(data.from);
            const answer = await connection.createAnswer();
            if (!joined || generation !== callGeneration) return;
            await connection.setLocalDescription(answer);
            if (!joined || generation !== callGeneration || !socket.connected) return;
            socket.emit(
                'webrtc_answer',
                signalPayload({
                    target: data.from,
                    description: connection.localDescription.toJSON(),
                }),
            );
        } catch (error) {
            console.error('Unable to answer WebRTC call:', error);
        }
    });

    socket.on('webrtc_answer', async data => {
        const record = peers.get(data?.from);
        if (!record || !data.description) return;
        try {
            await record.connection.setRemoteDescription(data.description);
            await flushCandidates(data.from);
        } catch (error) {
            console.error('Unable to apply WebRTC answer:', error);
        }
    });

    socket.on('webrtc_ice', async data => {
        if (!joined || !data?.from || !data.candidate) return;
        const record = peers.get(data.from);
        if (!record?.connection.remoteDescription) {
            const queue = queuedCandidates.get(data.from) || [];
            queue.push(data.candidate);
            queuedCandidates.set(data.from, queue.slice(-100));
            return;
        }
        try {
            await record.connection.addIceCandidate(data.candidate);
        } catch (error) {
            console.debug('Unable to add ICE candidate:', error);
        }
    });

    joinButton.addEventListener('click', joinCall);
    muteButton.addEventListener('click', toggleMute);
    leaveButton.addEventListener('click', () => leaveCall());

    return {
        get joined() {
            return joined;
        },
        handleSocketDisconnect() {
            window.clearTimeout(reconnectTimer);
            if (joining && !joined) leaveCall({ notify: false });
            if (!joined) return;
            ++callGeneration;
            closeAllPeers();
            callStatus.textContent = '网络中断，正在恢复通话…';
            callNetwork.textContent = '信令重连中';
        },
        handleSocketReconnect() {
            if (!joined) return;
            window.clearTimeout(reconnectTimer);
            reconnectTimer = window.setTimeout(() => {
                if (socket.connected && joined) {
                    socket.emit('call_join', signalPayload());
                }
            }, 250);
        },
        destroy() {
            leaveCall();
            window.removeEventListener('pointerdown', unlockCallAudio);
        },
    };
};
