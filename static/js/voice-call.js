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
        });
    }

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
        peerAudioNodes.set(peerId, { audio });
        try {
            await audio.play();
            callStatus.textContent = '通话中 · 已收到对方声音';
        } catch (_error) {
            callStatus.textContent = '点一下页面以播放通话声音';
            if (!warnedAutoplay) {
                warnedAutoplay = true;
                addSystemMessage('🔊 浏览器暂停了通话声音，请点击房间页面任意位置恢复播放。');
            }
            window.addEventListener('pointerdown', () => {
                audio.play().then(() => {
                    callStatus.textContent = '通话中 · 已收到对方声音';
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
            record.connection.onicecandidate = null;
            record.connection.ontrack = null;
            record.connection.close();
            peers.delete(peerId);
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
        const record = { connection, initiator, restartTimer: null };
        peers.set(peerId, record);

        localStream?.getTracks().forEach(track => {
            connection.addTrack(track, localStream);
        });

        connection.addEventListener('icecandidate', event => {
            if (event.candidate) {
                socket.emit(
                    'webrtc_ice',
                    signalPayload({
                        target: peerId,
                        candidate: event.candidate.toJSON(),
                    }),
                );
            }
        });

        connection.addEventListener('track', event => {
            const stream = event.streams[0] || new MediaStream([event.track]);
            attachRemoteAudio(peerId, stream);
        });

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
        });
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
        });

        return connection;
    }

    async function makeOffer(peerId, iceRestart = false) {
        const connection = createPeer(peerId, true);
        const offer = await connection.createOffer({ iceRestart });
        await connection.setLocalDescription(offer);
        socket.emit(
            'webrtc_offer',
            signalPayload({
                target: peerId,
                description: connection.localDescription.toJSON(),
            }),
        );
    }

    async function joinCall() {
        if (!supported || joined || joining) return;
        joining = true;
        joinButton.disabled = true;
        joinButton.textContent = '正在获取麦克风…';

        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                },
            });
            joined = true;
            muted = false;
            callDock.classList.remove('hidden');
            joinButton.classList.add('hidden');
            muteButton.textContent = '🎙 静音';
            callStatus.textContent = '正在加入通话…';
            socket.emit('call_join', signalPayload());
        } catch (error) {
            const denied = error?.name === 'NotAllowedError';
            addSystemMessage(
                denied
                    ? '❌ 麦克风权限被拒绝，请在浏览器地址栏中允许后重试。'
                    : '❌ 无法启用麦克风，请确认使用 HTTPS 并检查音频设备。',
            );
        } finally {
            joining = false;
            if (!joined) {
                joinButton.disabled = false;
                joinButton.textContent = '🎙 加入语音';
            }
        }
    }

    function leaveCall({ notify = true, keepStream = false } = {}) {
        if (notify && socket.connected) {
            socket.emit('call_leave', signalPayload());
        }
        closeAllPeers();
        if (!keepStream) {
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
            const connection = createPeer(data.from, false);
            await connection.setRemoteDescription(data.description);
            await flushCandidates(data.from);
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
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
        if (!data?.from || !data.candidate) return;
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
            if (!joined) return;
            closeAllPeers();
            callStatus.textContent = '网络中断，正在恢复通话…';
            callNetwork.textContent = '信令重连中';
        },
        handleSocketReconnect() {
            if (!joined) return;
            window.setTimeout(() => {
                if (socket.connected && joined) {
                    socket.emit('call_join', signalPayload());
                }
            }, 250);
        },
        destroy() {
            leaveCall();
        },
    };
};
