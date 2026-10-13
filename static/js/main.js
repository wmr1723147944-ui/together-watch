document.addEventListener('DOMContentLoaded', () => {
    if (window.TW_LEGAL_GATE_BLOCKED) return;
    const roomId = document.getElementById('roomData')?.value;
    if (!roomId) return;

    const username = (localStorage.getItem('tw_username') || `访客_${Math.floor(Math.random() * 1000)}`)
        .trim()
        .slice(0, 32);
    localStorage.setItem('tw_username', username);
    const savedClientKey = localStorage.getItem('tw_client_key') || '';
    const clientKey = /^[A-Za-z0-9_-]{16,96}$/.test(savedClientKey)
        ? savedClientKey
        : Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => (
            byte.toString(16).padStart(2, '0')
        )).join('');
    localStorage.setItem('tw_client_key', clientKey);
    localStorage.setItem('tw_last_room', roomId);

    const videoPlayer = document.getElementById('mainVideo');
    const playbackResumePrompt = document.getElementById('playbackResumePrompt');
    const resumePlaybackBtn = document.getElementById('resumePlaybackBtn');
    const videoEmptyState = document.getElementById('videoEmptyState');
    const chatContainer = document.getElementById('chatContainer');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const urlInput = document.getElementById('videoUrlInput');
    const urlStatus = document.getElementById('urlStatus');
    const loadUrlBtn = document.getElementById('loadUrlBtn');
    const fitToggleBtn = document.getElementById('fitToggleBtn');
    const localMirrorBtn = document.getElementById('localMirrorBtn');
    const localMirrorStatus = document.getElementById('localMirrorStatus');
    const mirrorPlaybackControls = document.getElementById('mirrorPlaybackControls');
    const mirrorPlayToggle = document.getElementById('mirrorPlayToggle');
    const mirrorCurrentTime = document.getElementById('mirrorCurrentTime');
    const mirrorSeek = document.getElementById('mirrorSeek');
    const mirrorDuration = document.getElementById('mirrorDuration');
    const mirrorSpeed = document.getElementById('mirrorSpeed');
    const officialPageStage = document.getElementById('officialPageStage');
    const officialSourceTitle = document.getElementById('officialSourceTitle');
    const officialSourceDescription = document.getElementById('officialSourceDescription');
    const openOfficialPageBtn = document.getElementById('openOfficialPageBtn');
    const bookmarkletLink = document.getElementById('bookmarkletLink');
    const copyBookmarkletBtn = document.getElementById('copyBookmarkletBtn');
    const copyCompanionConfigBtn = document.getElementById('copyCompanionConfigBtn');
    const officialPlaybackState = document.getElementById('officialPlaybackState');
    const qualityControl = document.getElementById('qualityControl');
    const qualitySelect = document.getElementById('qualitySelect');
    const qualityBadge = document.getElementById('qualityBadge');
    const copyRoomBtn = document.getElementById('copyRoomBtn');
    const connectionStatus = document.getElementById('connectionStatus');
    const connectionLabel = document.getElementById('connectionLabel');
    const onlineCount = document.getElementById('onlineCount');
    const presenceMenu = document.getElementById('presenceMenu');
    const memberList = document.getElementById('memberList');
    const strictSyncToggle = document.getElementById('strictSyncToggle');
    const playbackHealth = document.getElementById('playbackHealth');
    const syncHealth = document.getElementById('syncHealth');
    const videoVolumeSlider = document.getElementById('videoVolumeSlider');
    const videoVolumeValue = document.getElementById('videoVolumeValue');
    const volumeHelp = document.getElementById('volumeHelp');
    const companionStatusBadge = document.getElementById('companionStatusBadge');
    const bookmarkletHref = window.TogetherWatchBookmarklet?.buildHref?.(window.location.origin) || '';
    if (bookmarkletLink && bookmarkletHref) bookmarkletLink.href = bookmarkletHref;

    function showUrlDiagnostic(kind, payload = {}) {
        if (!urlStatus) return;
        const tone = ['pending', 'success', 'warning', 'error'].includes(kind)
            ? kind
            : 'warning';
        const labels = {
            pending: '检查中',
            success: '可以播放',
            warning: '需要确认',
            error: '无法加载',
        };

        urlStatus.className = `control-status url-diagnostic is-${tone}`;
        urlStatus.replaceChildren();

        const heading = document.createElement('div');
        heading.className = 'url-diagnostic-heading';
        const badge = document.createElement('span');
        badge.className = 'url-diagnostic-badge';
        badge.textContent = payload.stage || labels[tone];
        const title = document.createElement('strong');
        title.textContent = payload.error || labels[tone];
        heading.append(badge, title);
        urlStatus.appendChild(heading);

        if (payload.reason) {
            const reason = document.createElement('p');
            reason.textContent = `判断：${payload.reason}`;
            urlStatus.appendChild(reason);
        }
        if (payload.suggestion) {
            const suggestion = document.createElement('p');
            suggestion.className = 'url-diagnostic-action';
            suggestion.textContent = `下一步：${payload.suggestion}`;
            urlStatus.appendChild(suggestion);
        }
        if (Array.isArray(payload.attempts) && payload.attempts.length) {
            const details = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = `查看 ${payload.attempts.length} 项来源检查`;
            const list = document.createElement('ul');
            payload.attempts.forEach(attempt => {
                const item = document.createElement('li');
                item.textContent = `${attempt.name}：${attempt.summary || '未找到媒体地址'}`;
                list.appendChild(item);
            });
            details.append(summary, list);
            urlStatus.appendChild(details);
        }
    }

    function mediaElementDiagnostic(errorCode) {
        const diagnostics = {
            1: {
                error: '播放被浏览器中止',
                stage: '浏览器播放',
                reason: '媒体请求被取消，通常是切换视频或页面操作导致，不是加密判断。',
                suggestion: '重新点击播放；若反复出现，请刷新页面。',
            },
            2: {
                error: '浏览器无法继续下载视频',
                stage: '媒体网络',
                reason: '已授权媒体下载中断或源站拒绝了当前浏览器。',
                suggestion: '请检查链接是否仍有效，或改用该视频的官方网页。',
            },
            3: {
                error: '浏览器无法解码视频',
                stage: '媒体解码',
                reason: '已拿到媒体数据，但编码不兼容、文件损坏或加密均有可能；仅凭此错误不能认定 DRM。',
                suggestion: '请让管理员核验媒体编码和授权状态，或改用官方视频网页。',
            },
            4: {
                error: '浏览器不支持这个媒体源',
                stage: '媒体格式',
                reason: '常见原因是链接返回网页、MIME 类型错误、编码不支持或地址已经失效。',
                suggestion: '请让管理员检查已登记媒体域名、格式和跨域配置，或改用官方视频网页。',
            },
        };
        return diagnostics[errorCode] || {
            error: '播放器遇到未知错误',
            stage: '浏览器播放',
            reason: '浏览器没有提供足够信息，暂时无法判断是否加密。',
            suggestion: '重新识别来源；若仍失败，请改用官方视频网页。',
        };
    }

    function hlsErrorDiagnostic(data) {
        const detail = String(data?.details || '').toLowerCase();
        const status = Number(data?.response?.code || 0);
        if (detail.includes('keysystem') || detail.includes('drm')) {
            return {
                error: '检测到 DRM/密钥系统错误',
                stage: 'HLS 加密检查',
                reason: '播放器明确在 DRM 密钥系统阶段失败。',
                suggestion: '本站不会绕过 DRM，请改用你有权分享的无 DRM 文件。',
            };
        }
        if (detail.includes('keyload') || detail.includes('key-load')) {
            return {
                error: '无法取得 HLS 解密密钥',
                stage: 'HLS 密钥请求',
                reason: '播放列表可以读取，但密钥请求失败；可能是授权、防盗链或密钥地址过期，不一定是 DRM。',
                suggestion: '重新打开官方页面并完成登录；本站不会提取或代取密钥。',
            };
        }
        if (status === 401 || status === 403) {
            return {
                error: `源网站拒绝媒体请求（HTTP ${status}）`,
                stage: 'HLS 源站访问',
                reason: '常见于登录鉴权、防盗链、Cookie 或反爬校验，不等于已经确认 DRM。',
                suggestion: '重新复制最新链接，或改用原网站的视频页面。',
            };
        }
        if (status === 404) {
            return {
                error: '媒体分片不存在（HTTP 404）',
                stage: 'HLS 分片请求',
                reason: '播放地址或临时签名大概率已经过期。',
                suggestion: '回到原网页重新获取链接。',
            };
        }
        if (data?.type === window.Hls?.ErrorTypes?.MEDIA_ERROR) {
            return {
                error: 'HLS 媒体解码失败',
                stage: '媒体解码',
                reason: '网络已拿到播放数据，但编码、封装或媒体内容无法解码；未确认是 DRM。',
                suggestion: '换用兼容的 H.264 + AAC 视频，或上传后转码。',
            };
        }
        return {
            error: status ? `HLS 网络请求失败（HTTP ${status}）` : 'HLS 网络请求失败',
            stage: 'HLS 网络',
            reason: '播放器无法继续取得播放列表或分片，尚不能判断视频是否加密。',
            suggestion: '检查代理、网络和链接有效期后重试。',
        };
    }

    if (typeof window.io !== 'function') {
        setConnectionStatus('offline', '实时服务加载失败');
        addSystemMessage('❌ 实时同步组件加载失败，请刷新页面重试。');
        return;
    }

    const socket = window.io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelayMax: 5000,
    });

    let hlsInstance = null;
    let activeSource = '';
    let activeMediaSource = null;
    let remoteGuardUntil = 0;
    let remoteSeekUntil = 0;
    let localInteractionUntil = 0;
    let sourceChangeUntil = 0;
    let lastRevision = 0;
    let lastEventAt = 0;
    let lastEventType = '';
    let lastSeekTime = 0;
    let autoplayNoticeShown = false;
    let autoplayBlocked = false;
    let playbackAttempt = 0;
    let latestPlaybackState = null;
    const remotePlaybackEvents = new Map();
    let serverClockOffset = 0;
    let smoothedRtt = null;
    let hasClockSample = false;
    let basePlaybackRate = 1;
    let internalRateChangeUntil = 0;
    let pitchPreservationEnabled = false;
    let lastSyncSeekAt = 0;
    let driftConfirmationCount = 0;
    let lastDriftDirection = 0;
    let bufferingTimer = null;
    let bufferRecoveryTimer = null;
    let bufferingReported = false;
    let bufferingStartedAt = 0;
    let stallHistory = [];
    let roomBufferingActive = false;
    let qualityMode = 'auto';
    let hlsRecoveryAttempts = 0;
    let companionConnected = false;
    let companionVolumeTimer = null;
    let localMirrorStream = null;
    let localMirrorOutputStream = null;
    let localMirrorSourceVideo = null;
    let localMirrorCanvas = null;
    let localMirrorFrameId = 0;
    let latestPlayerLayout = null;
    let externalPlaybackState = null;
    let mirrorSeekPreview = false;
    let playbackResumeTimer = null;
    let sourceStateAbort = null;
    let sourceStateTimer = null;
    let mirrorStarting = false;
    let lastMirrorDrawAt = 0;

    function clampedStoredVolume(key, fallback = 100) {
        const rawValue = localStorage.getItem(key);
        const stored = Number(rawValue);
        return rawValue !== null && Number.isFinite(stored)
            ? Math.max(0, Math.min(100, Math.round(stored)))
            : fallback;
    }

    let videoVolume = clampedStoredVolume('tw_video_volume');

    const EVENT_COOLDOWN = 250;
    const SEEK_THRESHOLD = 0.5;
    const PITCH_SAFE_SYNC_THRESHOLD = 0.45;
    const HIGH_LATENCY_SYNC_THRESHOLD = 0.65;
    const SYNC_DRIFT_CONFIRMATIONS = 2;
    const SYNC_SEEK_COOLDOWN = 3500;
    const BUFFER_REPORT_DELAY = 5000;
    const CRITICAL_BUFFER_AHEAD = 0.35;
    const PROGRESSIVE_RECOVERY_BUFFER = 2;
    const BASE_RECOVERY_BUFFER = 2.5;
    const REPEAT_RECOVERY_BUFFER = 4;
    const STALL_HISTORY_WINDOW = 60_000;

    function setConnectionStatus(state, label) {
        if (!connectionStatus) return;
        connectionStatus.classList.remove('is-connecting', 'is-online', 'is-offline');
        connectionStatus.classList.add(`is-${state}`);
        if (connectionLabel) connectionLabel.textContent = label;
    }

    function guardRemoteUpdate(duration = 900) {
        remoteGuardUntil = Math.max(remoteGuardUntil, Date.now() + duration);
    }

    function isRemoteUpdate() {
        const now = Date.now();
        if (now >= remoteSeekUntil) remoteSeekUntil = 0;
        return now < remoteGuardUntil || now < remoteSeekUntil;
    }

    const savedStrictSync = localStorage.getItem('tw_strict_sync');
    strictSyncToggle.checked = savedStrictSync === 'true';

    function trimMessages() {
        while (chatContainer.children.length > 160) {
            chatContainer.removeChild(chatContainer.firstElementChild);
        }
    }

    function addSystemMessage(message, isAction = false) {
        const item = document.createElement('div');
        item.className = `message system${isAction ? ' is-action' : ''}`;
        item.textContent = message;
        chatContainer.appendChild(item);
        trimMessages();
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function addChatMessage(user, text, isMe, sentAt) {
        const item = document.createElement('div');
        item.className = `message${isMe ? ' me' : ''}`;

        const header = document.createElement('span');
        header.className = 'username';

        const name = document.createElement('span');
        name.textContent = user;
        header.appendChild(name);

        if (sentAt) {
            const time = document.createElement('span');
            time.className = 'message-time';
            time.textContent = new Date(sentAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
            });
            header.appendChild(time);
        }

        const body = document.createElement('span');
        body.textContent = text;
        item.append(header, body);
        chatContainer.appendChild(item);
        trimMessages();
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    const callController = typeof window.createVoiceCallController === 'function'
        ? window.createVoiceCallController({
            socket,
            roomId,
            username,
            addSystemMessage,
        })
        : null;

    function estimatedServerNow() {
        return Date.now() / 1000 + serverClockOffset;
    }

    function expectedPosition(state) {
        let position = Number(state.time) || 0;
        if (state.playing && state.server_time) {
            const transitSeconds = Math.max(
                0,
                estimatedServerNow() - Number(state.server_time),
            );
            position += transitSeconds * (Number(state.speed) || 1);
        }
        return Math.max(0, position);
    }

    function enablePitchPreservation() {
        let supported = false;
        for (const property of [
            'preservesPitch',
            'mozPreservesPitch',
            'webkitPreservesPitch',
        ]) {
            if (property in videoPlayer) {
                try {
                    videoPlayer[property] = true;
                    supported = supported || videoPlayer[property] === true;
                } catch (error) {
                    console.debug(`Unable to enable ${property}:`, error);
                }
            }
        }
        pitchPreservationEnabled = supported;
        return supported;
    }

    function setInternalPlaybackRate(rate) {
        const safeRate = Math.min(4, Math.max(0.25, rate));
        enablePitchPreservation();
        if (Math.abs(videoPlayer.playbackRate - safeRate) < 0.005) return;
        internalRateChangeUntil = Date.now() + 500;
        videoPlayer.playbackRate = safeRate;
    }

    function updateSyncHealth(drift = null, message = '') {
        syncHealth.classList.remove('is-good', 'is-warning', 'is-bad');
        if (message) {
            syncHealth.textContent = message;
            syncHealth.classList.add('is-warning');
            return;
        }
        if (!Number.isFinite(drift)) {
            syncHealth.textContent = smoothedRtt === null
                ? '正在校准同步状态…'
                : `网络 ${Math.round(smoothedRtt)} ms`;
            return;
        }

        const absoluteDrift = Math.abs(drift);
        const rttLabel = smoothedRtt === null ? '' : ` · ${Math.round(smoothedRtt)} ms`;
        syncHealth.textContent = `误差 ${absoluteDrift.toFixed(2)} 秒${rttLabel} · 无变调`;
        if (absoluteDrift < 0.18 && (smoothedRtt === null || smoothedRtt < 180)) {
            syncHealth.classList.add('is-good');
        } else if (absoluteDrift < 0.8 && (smoothedRtt === null || smoothedRtt < 450)) {
            syncHealth.classList.add('is-warning');
        } else {
            syncHealth.classList.add('is-bad');
        }
    }

    function setVideoTime(position, threshold = 0) {
        if (!Number.isFinite(position) || videoPlayer.readyState < 1) return;
        let target = position;
        if (Number.isFinite(videoPlayer.duration) && videoPlayer.duration > 0) {
            target = Math.min(target, Math.max(0, videoPlayer.duration - 0.05));
        }
        if (Math.abs(videoPlayer.currentTime - target) > threshold) {
            try {
                remoteSeekUntil = Date.now() + 15000;
                videoPlayer.currentTime = target;
            } catch (error) {
                remoteSeekUntil = 0;
                console.debug('Unable to seek yet:', error);
            }
        }
    }

    function correctPlaybackDriftWithoutRateChange(expected, drift, seekThreshold) {
        setInternalPlaybackRate(basePlaybackRate);
        if (!Number.isFinite(drift)) {
            driftConfirmationCount = 0;
            lastDriftDirection = 0;
            return;
        }

        const absoluteDrift = Math.abs(drift);
        const now = Date.now();
        if (absoluteDrift > seekThreshold) {
            setVideoTime(expected);
            lastSyncSeekAt = now;
            driftConfirmationCount = 0;
            lastDriftDirection = 0;
            return;
        }

        const networkTolerance = smoothedRtt !== null && smoothedRtt > 450
            ? HIGH_LATENCY_SYNC_THRESHOLD
            : PITCH_SAFE_SYNC_THRESHOLD;
        if (absoluteDrift <= networkTolerance) {
            driftConfirmationCount = 0;
            lastDriftDirection = 0;
            return;
        }

        const direction = Math.sign(drift);
        if (direction === lastDriftDirection) {
            driftConfirmationCount += 1;
        } else {
            lastDriftDirection = direction;
            driftConfirmationCount = 1;
        }
        if (
            driftConfirmationCount >= SYNC_DRIFT_CONFIRMATIONS
            && now - lastSyncSeekAt >= SYNC_SEEK_COOLDOWN
        ) {
            setVideoTime(expected);
            lastSyncSeekAt = now;
            driftConfirmationCount = 0;
            lastDriftDirection = 0;
        }
    }

    function setPlaybackPrompt(blocked) {
        autoplayBlocked = blocked;
        playbackResumePrompt?.classList.toggle('hidden', !blocked);
        if (blocked) updateSyncHealth(null, '此设备需要点击继续播放');
    }

    function invalidatePlaybackAttempt() {
        playbackAttempt++;
        remotePlaybackEvents.clear();
        setPlaybackPrompt(false);
    }

    function rememberPlaybackState(state) {
        latestPlaybackState = { ...state };
        playbackAttempt++; // an older play() rejection cannot undo this state
        if (!state.playing) setPlaybackPrompt(false);
    }

    function consumeRemotePlaybackEvent(type) {
        const expected = remotePlaybackEvents.get(type);
        remotePlaybackEvents.delete(type);
        return Boolean(expected && Date.now() < expected.until);
    }

    function pausePlayback() {
        const id = ++playbackAttempt;
        setPlaybackPrompt(false);
        if (videoPlayer.paused) return;
        remotePlaybackEvents.set('pause', { id, until: Date.now() + 15000 });
        videoPlayer.pause();
    }

    function requestPlayback(userGesture = false) {
        if (autoplayBlocked && !userGesture) return;
        const id = ++playbackAttempt;
        const source = activeSource;
        if (videoPlayer.paused) remotePlaybackEvents.set('play', { id, until: Date.now() + 15000 });
        let result;
        try { result = videoPlayer.play(); } catch (error) { result = Promise.reject(error); }
        Promise.resolve(result).then(() => {
            if (id === playbackAttempt && source === activeSource && !videoPlayer.paused) setPlaybackPrompt(false);
        }).catch(error => {
            if (remotePlaybackEvents.get('play')?.id === id) remotePlaybackEvents.delete('play');
            if (id !== playbackAttempt || source !== activeSource || !videoPlayer.paused
                || latestPlaybackState?.playing === false) return;
            // Seeking, loading another source or a newer pause can abort play.
            // That is not an autoplay permission denial.
            if (error?.name === 'AbortError') return;
            console.debug('Unable to start this device:', error);
            if (error?.name === 'NotAllowedError') {
                setPlaybackPrompt(true);
                if (!autoplayNoticeShown) {
                    autoplayNoticeShown = true;
                    addSystemMessage('👆 此设备需要你点击视频上的「继续同步播放」，不会暂停其他成员。');
                }
            } else {
                updateSyncHealth(null, '此设备播放失败，请检查视频来源');
            }
        });
    }

    resumePlaybackBtn?.addEventListener('click', () => {
        if (!latestPlaybackState?.playing || localMirrorStream || !activeSource) {
            setPlaybackPrompt(false);
            return;
        }
        // play() must run within this click, before awaiting a network reply.
        // Unlock only this device; do not publish its stalled time to peers.
        guardRemoteUpdate(1500);
        setVideoTime(expectedPosition(latestPlaybackState), 0.65);
        requestPlayback(true);
        if (socket.connected) socket.emit('request_room_state', { room: roomId });
    });

    function isHlsSource(source) {
        return source.startsWith('/hls_proxy?') || /\.m3u8(?:$|[?#])/i.test(source);
    }

    function clearHlsInstance() {
        if (hlsInstance) {
            hlsInstance.destroy();
            hlsInstance = null;
        }
    }

    function resetQualityControl() {
        qualityMode = 'auto';
        qualitySelect.replaceChildren();
        const automatic = document.createElement('option');
        automatic.value = '-1';
        automatic.textContent = '自动';
        qualitySelect.appendChild(automatic);
        qualitySelect.value = '-1';
        qualitySelect.disabled = true;
        qualityBadge.textContent = '检测中';
    }

    function qualityLabel(level) {
        if (!level) return '未知';
        if (level.height) return `${level.height}p`;
        if (level.bitrate) return `${Math.round(level.bitrate / 1000)} kbps`;
        return '清晰度';
    }

    function populateQualityLevels() {
        if (!hlsInstance) return;
        resetQualityControl();
        hlsInstance.levels.forEach((level, index) => {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = qualityLabel(level);
            qualitySelect.appendChild(option);
        });
        qualitySelect.disabled = hlsInstance.levels.length < 2;
        qualityBadge.textContent = hlsInstance.levels.length > 1
            ? '自动选择'
            : qualityLabel(hlsInstance.levels[0]);
    }

    function sourceIdentity(source) {
        if (!source) return '';
        return [
            source.mode || '',
            source.provider_key || '',
            source.media_id || '',
            source.media_url || source.page_url || '',
        ].join('|');
    }

    function directMediaSource(url) {
        return {
            mode: 'direct_media',
            provider_key: 'direct',
            provider_name: '已授权媒体',
            media_id: null,
            title: '网络视频',
            page_url: url,
            media_url: url,
            requires_companion: false,
        };
    }

    function companionConfig() {
        return {
            server: window.location.origin,
            room: roomId,
            username,
            clientKey,
        };
    }

    function encodeCompanionConfig(config) {
        const bytes = new TextEncoder().encode(JSON.stringify(config));
        const encoded = btoa(String.fromCharCode(...bytes));
        return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    function officialUrlWithInvite(pageUrl) {
        try {
            const target = new URL(pageUrl);
            target.hash = `tw=${encodeCompanionConfig(companionConfig())}`;
            return target.href;
        } catch (_error) {
            return pageUrl;
        }
    }

    function updateCompanionStatus(connected) {
        companionConnected = Boolean(connected);
        if (!companionStatusBadge) return;
        companionStatusBadge.className = (
            `companion-status ${companionConnected ? 'is-connected' : 'is-waiting'}`
        );
        companionStatusBadge.textContent = companionConnected ? '助手已连接' : '助手未连接';
    }

    function updateVolumeHelp() {
        if (!volumeHelp) return;
        const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (isAppleMobile) {
            volumeHelp.textContent = (
                'iPhone/iPad 的视频音量由系统音量键控制；通话音量仍可单独调整。'
            );
        } else if (activeMediaSource?.mode === 'official_page') {
            volumeHelp.textContent = companionConnected
                ? '视频音量正在控制你的官方视频标签页；通话音量只影响房间语音。'
                : '先打开官方视频并连接书签助手或插件，视频音量才能从这里调整。';
        } else {
            volumeHelp.textContent = '视频音量只影响当前播放器；通话音量只影响房间语音。';
        }
    }

    function sendCompanionVolume() {
        window.clearTimeout(companionVolumeTimer);
        companionVolumeTimer = window.setTimeout(() => {
            if (!socket.connected) return;
            socket.emit('companion_command', {
                room: roomId,
                command: 'set_volume',
                value: videoVolume / 100,
            });
        }, 80);
    }

    function applyVideoVolume({ notifyCompanion = true } = {}) {
        const normalized = videoVolume / 100;
        try {
            videoPlayer.volume = normalized;
            videoPlayer.muted = videoVolume === 0;
        } catch (_error) {
            // Some mobile browsers only allow the hardware volume buttons.
        }
        if (videoVolumeSlider) videoVolumeSlider.value = String(videoVolume);
        if (videoVolumeValue) {
            videoVolumeValue.textContent = videoVolume === 0 ? '静音' : `${videoVolume}%`;
        }
        localStorage.setItem('tw_video_volume', String(videoVolume));
        if (notifyCompanion) sendCompanionVolume();
        updateVolumeHelp();
    }

    function updateOfficialPlaybackState(state = {}) {
        if (!officialPlaybackState) return;
        const seconds = Math.max(0, Number(state.time) || 0);
        const minutes = Math.floor(seconds / 60);
        const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
        const status = state.playing ? '房间正在播放' : '房间已暂停';
        officialPlaybackState.textContent = `${status} · ${minutes}:${remainder} · 由观影助手同步播放页`;
    }

    function formatMirrorTime(value, fallback = '--:--') {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds < 0) return fallback;
        const whole = Math.floor(seconds);
        const hours = Math.floor(whole / 3600);
        const minutes = Math.floor((whole % 3600) / 60);
        const remainder = String(whole % 60).padStart(2, '0');
        return hours > 0
            ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
            : `${String(minutes).padStart(2, '0')}:${remainder}`;
    }

    function updateMirrorPlaybackControls(state = externalPlaybackState) {
        if (!state || !mirrorPlaybackControls) return;
        const duration = Math.max(0, Number(state.duration) || 0);
        const current = Math.min(expectedPosition(state), duration || Infinity);
        if (!mirrorSeekPreview) {
            mirrorSeek.max = duration > 0 ? String(duration) : '1000';
            mirrorSeek.value = String(Math.min(duration || 1000, current));
            mirrorCurrentTime.textContent = formatMirrorTime(current, '00:00');
        }
        mirrorSeek.disabled = duration <= 0;
        mirrorDuration.textContent = formatMirrorTime(duration);
        mirrorPlayToggle.textContent = state.playing ? '❚❚' : '▶';
        mirrorPlayToggle.setAttribute('aria-label', state.playing ? '暂停原视频' : '播放原视频');
        const speedValue = String(Number(state.speed) || 1);
        if (Array.from(mirrorSpeed.options).some(option => option.value === speedValue)) {
            mirrorSpeed.value = speedValue;
        }
    }

    function emitMirrorVideoEvent(type, time, additionalData = {}) {
        if (!socket.connected) {
            addSystemMessage('房间正在重连，暂时无法控制原视频。');
            return;
        }
        if (!companionConnected) {
            addSystemMessage('请先在视频页面连接一起看助手，再操作视频。');
            return;
        }
        const safeTime = Math.max(0, Number(time) || 0);
        socket.emit('video_event', {
            room: roomId,
            type,
            time: safeTime,
            ...additionalData,
        });
        externalPlaybackState = {
            ...(externalPlaybackState || {}),
            time: safeTime,
            playing: type === 'play'
                ? true
                : type === 'pause'
                    ? false
                    : Boolean(externalPlaybackState?.playing),
            speed: Number(additionalData.speed) || Number(externalPlaybackState?.speed) || 1,
            server_time: estimatedServerNow(),
        };
        updateMirrorPlaybackControls();
    }

    function drawLocalMirrorFrame(frameTime = performance.now()) {
        if (!localMirrorStream || !localMirrorSourceVideo || !localMirrorCanvas) return;
        if (frameTime - lastMirrorDrawAt < 1000 / 30) {
            localMirrorFrameId = window.requestAnimationFrame(drawLocalMirrorFrame);
            return;
        }
        lastMirrorDrawAt = frameTime;
        const sourceWidth = Number(localMirrorSourceVideo.videoWidth) || 0;
        const sourceHeight = Number(localMirrorSourceVideo.videoHeight) || 0;
        if (sourceWidth > 0 && sourceHeight > 0) {
            const layout = latestPlayerLayout;
            if (!(layout?.viewport_width > 0) || !(layout?.viewport_height > 0)) {
                const waitingContext = localMirrorCanvas.getContext('2d', { alpha: false });
                if (waitingContext) {
                    waitingContext.fillStyle = '#05050d';
                    waitingContext.fillRect(0, 0, localMirrorCanvas.width, localMirrorCanvas.height);
                }
                localMirrorFrameId = window.requestAnimationFrame(drawLocalMirrorFrame);
                return;
            }
            const scaleX = sourceWidth / layout.viewport_width;
            const scaleY = sourceHeight / layout.viewport_height;
            const sourceX = Math.max(0, Math.min(sourceWidth - 1, layout.left * scaleX));
            const sourceY = Math.max(0, Math.min(sourceHeight - 1, layout.top * scaleY));
            const cropWidth = Math.max(1, Math.min(sourceWidth - sourceX, layout.width * scaleX));
            const cropHeight = Math.max(1, Math.min(sourceHeight - sourceY, layout.height * scaleY));
            const outputScale = Math.min(1, 1920 / cropWidth, 1080 / cropHeight);
            const outputWidth = Math.max(2, Math.round(cropWidth * outputScale));
            const outputHeight = Math.max(2, Math.round(cropHeight * outputScale));
            if (localMirrorCanvas.width !== outputWidth || localMirrorCanvas.height !== outputHeight) {
                localMirrorCanvas.width = outputWidth;
                localMirrorCanvas.height = outputHeight;
            }
            const context = localMirrorCanvas.getContext('2d', { alpha: false });
            context?.drawImage(
                localMirrorSourceVideo,
                sourceX,
                sourceY,
                cropWidth,
                cropHeight,
                0,
                0,
                outputWidth,
                outputHeight,
            );
        }
        localMirrorFrameId = window.requestAnimationFrame(drawLocalMirrorFrame);
    }

    function clearLocalMirror({ stopTracks = true } = {}) {
        const stream = localMirrorStream;
        localMirrorStream = null;
        window.cancelAnimationFrame(localMirrorFrameId);
        localMirrorFrameId = 0;
        lastMirrorDrawAt = 0;
        if (stopTracks) stream?.getTracks?.().forEach(track => track.stop());
        localMirrorOutputStream?.getTracks?.().forEach(track => track.stop());
        localMirrorOutputStream = null;
        if (localMirrorSourceVideo) {
            localMirrorSourceVideo.pause();
            localMirrorSourceVideo.srcObject = null;
        }
        localMirrorSourceVideo = null;
        localMirrorCanvas = null;
        if (videoPlayer.srcObject) videoPlayer.srcObject = null;
        videoPlayer.controls = true;
        mirrorPlaybackControls?.classList.add('hidden');
        localMirrorBtn.textContent = '📺 映射播放页';
        localMirrorBtn.classList.remove('btn-danger');
        localMirrorStatus.textContent = '映射仅在本机显示，不上传也不分享给其他成员';
        localMirrorStatus.classList.remove('is-active');
        applyVideoVolume({ notifyCompanion: false });
    }

    function restoreStageAfterMirror() {
        clearLocalMirror();
        if (activeMediaSource?.mode === 'official_page') {
            showOfficialPageSource(activeMediaSource);
            return;
        }
        officialPageStage.classList.add('hidden');
        videoPlayer.classList.remove('hidden');
        videoEmptyState.classList.toggle('hidden', Boolean(activeSource));
        localMirrorStatus.textContent = '映射已停止；原视频页可以继续保留在后台';
    }

    async function startLocalMirror() {
        if (mirrorStarting) return;
        if (localMirrorStream) {
            restoreStageAfterMirror();
            return;
        }
        if (activeMediaSource?.mode === 'direct_media') {
            addSystemMessage('当前直链已经在房间播放器中显示，不需要再次映射。');
            return;
        }
        if (!navigator.mediaDevices?.getDisplayMedia) {
            addSystemMessage('当前浏览器不支持标签页映射，请使用最新版 Chrome、Edge 或桌面浏览器。');
            return;
        }

        mirrorStarting = true;
        localMirrorBtn.disabled = true;

        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: 'browser' },
                audio: false,
                selfBrowserSurface: 'exclude',
                surfaceSwitching: 'include',
            });
            const videoTrack = stream.getVideoTracks()[0];
            if (!videoTrack) {
                stream.getTracks().forEach(track => track.stop());
                throw new Error('没有选择可映射的标签页');
            }
            const surface = videoTrack.getSettings?.().displaySurface;
            if (surface && surface !== 'browser') {
                stream.getTracks().forEach(track => track.stop());
                throw new Error('请选择视频的浏览器标签页，窗口或整块屏幕无法准确裁切');
            }

            localMirrorStream = stream;
            localMirrorSourceVideo = document.createElement('video');
            localMirrorSourceVideo.muted = true;
            localMirrorSourceVideo.playsInline = true;
            localMirrorSourceVideo.srcObject = stream;
            await localMirrorSourceVideo.play();
            localMirrorCanvas = document.createElement('canvas');
            localMirrorCanvas.width = 1280;
            localMirrorCanvas.height = 720;
            if (typeof localMirrorCanvas.captureStream !== 'function') {
                throw new Error('当前浏览器不支持播放器区域裁切');
            }
            localMirrorOutputStream = localMirrorCanvas.captureStream(30);
            clearHlsInstance();
            videoPlayer.pause();
            videoPlayer.removeAttribute('src');
            videoPlayer.load();
            videoPlayer.srcObject = localMirrorOutputStream;
            videoPlayer.controls = false;
            videoPlayer.muted = true;
            videoPlayer.classList.remove('hidden');
            videoEmptyState.classList.add('hidden');
            officialPageStage.classList.add('hidden');
            await videoPlayer.play();
            drawLocalMirrorFrame();
            mirrorPlaybackControls?.classList.remove('hidden');
            updateMirrorPlaybackControls();
            localMirrorBtn.textContent = '■ 停止映射';
            localMirrorBtn.classList.add('btn-danger');
            localMirrorStatus.textContent = latestPlayerLayout
                ? '已裁切到播放器区域；下方控制条会操作原视频页'
                : '已开始映射，正在等待助手定位播放器区域';
            localMirrorStatus.classList.add('is-active');
            videoTrack.addEventListener('ended', () => {
                if (localMirrorStream === stream) restoreStageAfterMirror();
            }, { once: true });
            addSystemMessage('📺 播放页已映射到房间画面。请保留原视频标签页，不要关闭。');
        } catch (error) {
            if (localMirrorStream) clearLocalMirror();
            const cancelled = error?.name === 'NotAllowedError';
            localMirrorStatus.textContent = cancelled
                ? '没有选择标签页；需要映射时可重新点击'
                : `映射失败：${error?.message || '浏览器没有提供画面'}`;
            addSystemMessage(cancelled
                ? '已取消标签页映射。'
                : '映射失败，请选择正在播放视频的浏览器标签页。');
        } finally {
            mirrorStarting = false;
            localMirrorBtn.disabled = false;
        }
    }

    function showOfficialPageSource(source, state = null) {
        if (localMirrorStream) clearLocalMirror();
        invalidatePlaybackAttempt();
        latestPlaybackState = null;
        if (!state?.external_playback) externalPlaybackState = null;
        activeMediaSource = source;
        activeSource = '';
        window.clearTimeout(bufferingTimer);
        window.clearTimeout(bufferRecoveryTimer);
        bufferingReported = false;
        roomBufferingActive = false;
        clearHlsInstance();
        resetQualityControl();
        qualityControl.classList.add('hidden');
        pausePlayback();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
        videoPlayer.classList.add('hidden');
        videoEmptyState.classList.add('hidden');
        officialPageStage.classList.remove('hidden');
        officialSourceTitle.textContent = source.title || `${source.provider_name || '原网站'}视频`;
        officialSourceDescription.textContent = (
            `视频仍由${source.provider_name || '原网站'}提供。`
            + '每位成员使用自己的正常观看权限，本站只同步播放状态。'
        );
        openOfficialPageBtn.href = officialUrlWithInvite(source.page_url);
        updateOfficialPlaybackState(state || {});
        updateVolumeHelp();
    }

    function changeMediaSource(source, emitEvent = false, state = null) {
        cancelPendingPlayback();
        remoteSeekUntil = 0;
        if (!source || !['direct_media', 'official_page'].includes(source.mode)) return;
        const sameSource = sourceIdentity(activeMediaSource) === sourceIdentity(source);
        activeMediaSource = source;

        if (source.mode === 'official_page') {
            showOfficialPageSource(source, state);
        } else {
            officialPageStage.classList.add('hidden');
            videoPlayer.classList.remove('hidden');
            changeVideoSource(source.media_url || source.page_url, false);
            updateVolumeHelp();
        }

        if (emitEvent) {
            emitVideoEvent('change_source', {
                src: source.media_url || source.page_url,
                source,
            });
        } else if (sameSource && state && source.mode === 'official_page') {
            updateOfficialPlaybackState(state);
        }
    }

    function scheduleSourceState(state) {
        sourceStateAbort?.abort();
        window.clearTimeout(sourceStateTimer);
        if (activeMediaSource?.mode === 'official_page') {
            sourceChangeUntil = 0;
            updateOfficialPlaybackState(state);
            return;
        }
        const abort = new AbortController();
        sourceStateAbort = abort;
        const apply = () => {
            if (abort.signal.aborted || videoPlayer.readyState < 1) return;
            abort.abort();
            window.clearTimeout(sourceStateTimer);
            if (Number(state.revision) < lastRevision) return;
            sourceChangeUntil = 0;
            applyPlaybackState(state, 0);
        };
        if (videoPlayer.readyState >= 1) {
            apply();
            return;
        }
        videoPlayer.addEventListener('loadedmetadata', apply, { once: true, signal: abort.signal });
        sourceStateTimer = window.setTimeout(() => {
            if (videoPlayer.readyState >= 1) apply();
        }, 3000);
    }

    function changeVideoSource(source, emitEvent = false) {
        if (!source || source === activeSource) {
            if (emitEvent && source) {
                emitVideoEvent('change_source', { src: source });
            }
            return;
        }

        if (localMirrorStream) clearLocalMirror();
        invalidatePlaybackAttempt();
        latestPlaybackState = null;
        autoplayNoticeShown = false;
        externalPlaybackState = null;
        sourceChangeUntil = Date.now() + 3000;
        activeSource = source;
        activeMediaSource = activeMediaSource?.mode === 'direct_media'
            ? activeMediaSource
            : directMediaSource(source);
        window.clearTimeout(bufferingTimer);
        window.clearTimeout(bufferRecoveryTimer);
        bufferingReported = false;
        roomBufferingActive = false;
        basePlaybackRate = 1;
        lastSyncSeekAt = 0;
        driftConfirmationCount = 0;
        lastDriftDirection = 0;
        bufferingStartedAt = 0;
        stallHistory = [];
        setInternalPlaybackRate(1);
        officialPageStage.classList.add('hidden');
        videoPlayer.classList.remove('hidden');
        videoEmptyState.classList.add('hidden');
        clearHlsInstance();
        resetQualityControl();
        hlsRecoveryAttempts = 0;

        if (isHlsSource(source)) {
            qualityControl.classList.remove('hidden');
            if (window.Hls?.isSupported()) {
                hlsInstance = new window.Hls({
                    enableWorker: true,
                    lowLatencyMode: false,
                    startLevel: -1,
                    capLevelToPlayerSize: true,
                    abrEwmaDefaultEstimate: 2_000_000,
                    maxBufferLength: 45,
                    maxMaxBufferLength: 90,
                    backBufferLength: 30,
                    maxStarvationDelay: 4,
                    maxLoadingDelay: 4,
                });
                hlsInstance.loadSource(source);
                hlsInstance.attachMedia(videoPlayer);
                hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
                    populateQualityLevels();
                });
                hlsInstance.on(window.Hls.Events.LEVEL_SWITCHED, (_event, data) => {
                    const level = hlsInstance?.levels?.[data.level];
                    const selected = qualityLabel(level);
                    qualityBadge.textContent = qualityMode === 'auto'
                        ? `自动 · ${selected}`
                        : '已锁定';
                });
                hlsInstance.on(window.Hls.Events.ERROR, (_event, data) => {
                    console.error('[HLS.js]', data);
                    if (data.fatal) {
                        hlsRecoveryAttempts += 1;
                        if (
                            data.type === window.Hls.ErrorTypes.NETWORK_ERROR
                            && hlsRecoveryAttempts <= 3
                        ) {
                            qualityBadge.textContent = '网络波动，正在恢复';
                            hlsInstance.startLoad();
                        } else if (
                            data.type === window.Hls.ErrorTypes.MEDIA_ERROR
                            && hlsRecoveryAttempts <= 2
                        ) {
                            qualityBadge.textContent = '解码恢复中';
                            hlsInstance.recoverMediaError();
                        } else {
                            const diagnostic = hlsErrorDiagnostic(data);
                            showUrlDiagnostic('error', diagnostic);
                            addSystemMessage(`❌ ${diagnostic.error}：${diagnostic.reason}`);
                        }
                    }
                });
            } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
                videoPlayer.src = source;
                videoPlayer.load();
                qualitySelect.disabled = true;
                qualityBadge.textContent = '浏览器自动';
            } else {
                addSystemMessage('❌ 当前浏览器不支持 HLS 视频。');
            }
        } else {
            qualityControl.classList.add('hidden');
            videoPlayer.src = source;
            videoPlayer.load();
        }

        if (emitEvent) {
            emitVideoEvent('change_source', {
                src: source,
                source: activeMediaSource || directMediaSource(source),
            });
        }
    }

    function applyPlaybackState(state, seekThreshold = 1.2) {
        rememberPlaybackState(state);
        window.clearTimeout(playbackResumeTimer);
        guardRemoteUpdate();
        basePlaybackRate = Number(state.speed) || 1;
        const expected = expectedPosition(state);
        const drift = videoPlayer.readyState >= 1
            ? expected - videoPlayer.currentTime
            : null;
        updateSyncHealth(drift);

        if (state.playing) {
            const resumeAt = Number(state.resume_at);
            if (Number.isFinite(resumeAt) && resumeAt > estimatedServerNow()) {
                setVideoTime(expected, 0.12);
                pausePlayback();
                const delay = Math.max(0, (resumeAt - estimatedServerNow()) * 1000);
                playbackResumeTimer = window.setTimeout(() => {
                    guardRemoteUpdate();
                    requestPlayback();
                }, delay);
                return;
            }
            correctPlaybackDriftWithoutRateChange(expected, drift, seekThreshold);
            if (videoPlayer.paused) requestPlayback();
        } else if (!videoPlayer.paused) {
            setVideoTime(expected, 0.12);
            setInternalPlaybackRate(basePlaybackRate);
            pausePlayback();
        } else {
            setVideoTime(expected, 0.12);
            setInternalPlaybackRate(basePlaybackRate);
        }
    }

    function applyRoomState(state) {
        if (!state?.media_source && !state?.video_src && !state?.external_playback) return;
        const revision = Number(state.revision) || 0;
        if (revision < lastRevision) return;
        lastRevision = Math.max(lastRevision, revision);

        const directPlayback = state.media_source?.mode === 'direct_media';
        if (directPlayback) externalPlaybackState = null;
        if (state.external_playback && !directPlayback) {
            externalPlaybackState = { ...state };
            updateOfficialPlaybackState({
                ...state,
                time: expectedPosition(state),
            });
            updateMirrorPlaybackControls(state);
        }

        const roomSource = state.media_source
            || (state.video_src ? directMediaSource(state.video_src) : null);
        if (roomSource && sourceIdentity(activeMediaSource) !== sourceIdentity(roomSource)) {
            guardRemoteUpdate(2500);
            changeMediaSource(roomSource, false, state);
            scheduleSourceState(state);
            return;
        }
        if ((state.external_playback && !directPlayback) || roomSource?.mode === 'official_page') {
            updateOfficialPlaybackState({
                ...state,
                time: expectedPosition(state),
            });
            return;
        }
        if (Date.now() < localInteractionUntil && !state.force_sync) return;
        if (videoPlayer.readyState < 1) {
            scheduleSourceState(state);
            return;
        }
        applyPlaybackState(state);
    }

    function cancelPendingPlayback() {
        window.clearTimeout(playbackResumeTimer);
        sourceStateAbort?.abort();
        window.clearTimeout(sourceStateTimer);
    }

    function emitVideoEvent(type, additionalData = {}) {
        if (localMirrorStream || !socket.connected || isRemoteUpdate()) return;
        cancelPendingPlayback();
        if (type !== 'change_source' && Date.now() < sourceChangeUntil) return;

        const now = Date.now();
        if (
            type !== 'change_source'
            && type === lastEventType
            && now - lastEventAt < EVENT_COOLDOWN
        ) {
            return;
        }

        if (type === 'seek') {
            const threshold = videoPlayer.paused ? 0.1 : SEEK_THRESHOLD;
            if (Math.abs(videoPlayer.currentTime - lastSeekTime) < threshold) return;
            lastSeekTime = videoPlayer.currentTime;
        }

        if (type !== 'change_source') {
            localInteractionUntil = now + 2500;
        }

        lastEventAt = now;
        lastEventType = type;
        invalidatePlaybackAttempt();
        socket.emit('video_event', {
            room: roomId,
            type,
            time: Number.isFinite(videoPlayer.currentTime) ? videoPlayer.currentTime : 0,
            ...additionalData,
        });
    }

    function sendSyncPing() {
        if (!socket.connected) return;
        socket.emit('sync_ping', {
            room: roomId,
            client_time: Date.now(),
        });
    }

    socket.on('connect', () => {
        lastRevision = 0;
        hasClockSample = false;
        cancelPendingPlayback();
        setConnectionStatus('online', '已连接');
        socket.emit('join', {
            username,
            room: roomId,
            client_key: clientKey,
        });
        window.setTimeout(sendSyncPing, 80);
        callController?.handleSocketReconnect();
    });

    socket.on('disconnect', () => {
        cancelPendingPlayback();
        latestPlayerLayout = null;
        setConnectionStatus('offline', '正在重连');
        updateSyncHealth(null, '网络中断，等待重连…');
        updateCompanionStatus(false);
        updateVolumeHelp();
        callController?.handleSocketDisconnect();
    });

    socket.on('connect_error', () => {
        setConnectionStatus('offline', '连接失败');
    });

    socket.on('sync_pong', data => {
        const now = Date.now();
        const sentAt = Number(data?.client_time);
        const serverTime = Number(data?.server_time);
        if (!Number.isFinite(sentAt) || !Number.isFinite(serverTime)) return;

        const rtt = Math.max(0, now - sentAt);
        const offsetSample = serverTime + rtt / 2000 - now / 1000;
        smoothedRtt = smoothedRtt === null
            ? rtt
            : smoothedRtt * 0.72 + rtt * 0.28;
        if (!hasClockSample) {
            serverClockOffset = offsetSample;
            hasClockSample = true;
        } else {
            serverClockOffset = serverClockOffset * 0.72 + offsetSample * 0.28;
        }

        const quality = smoothedRtt < 180
            ? '稳定'
            : smoothedRtt < 450
                ? '一般'
                : '较差';
        setConnectionStatus('online', `${quality} · ${Math.round(smoothedRtt)}ms`);
        if (!activeSource) updateSyncHealth(null);
    });

    socket.on('app_error', data => {
        addSystemMessage(`⚠️ ${data?.message || '操作失败，请稍后再试。'}`);
    });

    socket.on('status', data => {
        if (data?.msg) addSystemMessage(data.msg);
    });

    socket.on('companion_presence', data => {
        if (!data?.connected) latestPlayerLayout = null;
        updateCompanionStatus(Boolean(data?.connected));
        updateVolumeHelp();
        if (data?.connected) sendCompanionVolume();
    });

    socket.on('companion_player_layout', data => {
        const layout = data?.layout;
        if (!layout || !(Number(layout.width) > 0) || !(Number(layout.height) > 0)) {
            latestPlayerLayout = null;
            if (localMirrorStream) localMirrorStatus.textContent = '正在等待助手重新定位播放器区域';
            return;
        }
        latestPlayerLayout = {
            viewport_width: Number(layout.viewport_width) || 0,
            viewport_height: Number(layout.viewport_height) || 0,
            left: Number(layout.left) || 0,
            top: Number(layout.top) || 0,
            width: Number(layout.width) || 0,
            height: Number(layout.height) || 0,
        };
        if (localMirrorStream) {
            localMirrorStatus.textContent = '已裁切到播放器区域；下方控制条会操作原视频页';
            localMirrorStatus.classList.add('is-active');
        }
    });

    socket.on('presence', data => {
        const users = Array.isArray(data?.users) ? data.users : [];
        const members = Array.isArray(data?.members)
            ? data.members
            : users.map(user => ({ username: user, in_call: false }));
        onlineCount.textContent = String(Number(data?.count) || members.length);
        memberList.replaceChildren();

        let selfMarked = false;
        members.forEach(member => {
            const user = member.username || '成员';
            const item = document.createElement('li');
            item.className = 'member-item';

            const avatar = document.createElement('span');
            avatar.className = 'member-avatar';
            avatar.textContent = Array.from(user || '?')[0] || '?';

            const name = document.createElement('span');
            name.className = 'member-name';
            name.textContent = user;
            item.append(avatar, name);

            if (!selfMarked && user === username) {
                const badge = document.createElement('span');
                badge.className = 'member-you';
                badge.textContent = '你';
                item.appendChild(badge);
                selfMarked = true;
            }
            if (member.in_call) {
                const callBadge = document.createElement('span');
                callBadge.className = 'member-call-state';
                callBadge.textContent = '通话中';
                item.appendChild(callBadge);
            }
            memberList.appendChild(item);
        });

        if (!members.length) {
            const empty = document.createElement('li');
            empty.className = 'member-item';
            empty.textContent = '暂时没有在线成员';
            memberList.appendChild(empty);
        }
    });

    document.addEventListener('click', event => {
        if (presenceMenu?.open && !presenceMenu.contains(event.target)) {
            presenceMenu.removeAttribute('open');
        }
    });

    socket.on('chat_message', data => {
        addChatMessage(
            data.username,
            data.message,
            data.username === username,
            data.sent_at,
        );
    });

    socket.on('room_state', applyRoomState);
    socket.on('playback_ack', applyRoomState);

    socket.on('buffering_state', data => {
        const revision = Number(data?.revision) || 0;
        if (revision && revision < lastRevision) return;
        lastRevision = Math.max(lastRevision, revision);
        window.clearTimeout(playbackResumeTimer);
        guardRemoteUpdate(1800);
        const bufferingUsers = Array.isArray(data?.buffering_users)
            ? data.buffering_users
            : [];
        if (activeMediaSource?.mode === 'official_page') {
            updateOfficialPlaybackState({
                time: Number(data?.time) || 0,
                playing: !data?.active && Boolean(data?.playing),
            });
            updateSyncHealth(
                null,
                data?.active
                    ? `等待 ${bufferingUsers.join('、') || '成员'} 缓冲`
                    : '官方页面已恢复同步',
            );
            return;
        }

        rememberPlaybackState({ ...data, playing: !data?.active && Boolean(data?.playing) });
        if (data?.active) {
            setVideoTime(Number(data.time) || videoPlayer.currentTime);
            pausePlayback();
            updateSyncHealth(
                null,
                bufferingUsers.length
                    ? `等待 ${bufferingUsers.join('、')} 缓冲`
                    : '等待成员缓冲',
            );
            if (!roomBufferingActive) {
                addSystemMessage(
                    `⏳ ${data.username || '有成员'} 网络缓冲，全房已暂停。`,
                    true,
                );
            }
            roomBufferingActive = true;
            return;
        }

        roomBufferingActive = false;
        basePlaybackRate = Number(data?.speed) || basePlaybackRate;
        setInternalPlaybackRate(basePlaybackRate);
        setVideoTime(Number(data?.time) || 0);
        updateSyncHealth(0, '缓冲完成，即将同步继续');
        if (data?.playing) {
            const resumeAt = Number(data.resume_at) || estimatedServerNow();
            const delay = Math.max(0, (resumeAt - estimatedServerNow()) * 1000);
            playbackResumeTimer = window.setTimeout(() => {
                guardRemoteUpdate();
                requestPlayback();
                updateSyncHealth(0);
            }, delay);
        }
    });

    socket.on('sync_video', data => {
        const revision = Number(data?.revision) || 0;
        if (revision && revision <= lastRevision) return;
        lastRevision = Math.max(lastRevision, revision);
        cancelPendingPlayback();
        guardRemoteUpdate();
        const usesOfficialPage = (
            activeMediaSource?.mode === 'official_page'
            || (activeMediaSource?.mode !== 'direct_media' && Boolean(externalPlaybackState?.external_playback))
            || Boolean(localMirrorStream)
        );
        if (!usesOfficialPage && data.type !== 'change_source') {
            rememberPlaybackState({ ...data, playing: typeof data.playing === 'boolean'
                ? data.playing : data.type === 'play' ? true : data.type === 'pause' ? false : !videoPlayer.paused,
                speed: Number(data.speed) || basePlaybackRate });
        }
        const updateExternalEventState = (playing, speed = data.speed) => {
            externalPlaybackState = {
                ...(externalPlaybackState || {}),
                time: Number(data.time) || 0,
                playing: Boolean(playing),
                speed: Number(speed) || Number(externalPlaybackState?.speed) || 1,
                server_time: Number(data.server_time) || estimatedServerNow(),
                external_playback: true,
            };
            updateMirrorPlaybackControls();
        };

        switch (data.type) {
            case 'play':
                addSystemMessage(`▶ ${data.username} 开始播放`, true);
                if (usesOfficialPage) {
                    updateExternalEventState(true);
                    updateOfficialPlaybackState({
                        time: expectedPosition({
                            time: data.time,
                            playing: true,
                            speed: basePlaybackRate,
                            server_time: data.server_time,
                        }),
                        playing: true,
                    });
                    break;
                }
                setVideoTime(
                    expectedPosition({
                        time: data.time,
                        playing: true,
                        speed: basePlaybackRate,
                        server_time: data.server_time,
                    }),
                    0.65,
                );
                requestPlayback();
                break;
            case 'pause':
                addSystemMessage(`⏸ ${data.username} 暂停了视频`, true);
                if (usesOfficialPage) {
                    updateExternalEventState(false);
                    updateOfficialPlaybackState({ time: data.time, playing: false });
                    break;
                }
                setVideoTime(Number(data.time) || 0);
                pausePlayback();
                break;
            case 'seek':
                addSystemMessage(`⏩ ${data.username} 调整了进度`, true);
                if (usesOfficialPage) {
                    updateExternalEventState(
                        typeof data.playing === 'boolean'
                            ? data.playing
                            : Boolean(externalPlaybackState?.playing),
                    );
                    updateOfficialPlaybackState({
                        time: data.time,
                        playing: typeof data.playing === 'boolean' ? data.playing : false,
                    });
                    break;
                }
                setVideoTime(Number(data.time) || 0);
                if (typeof data.playing === 'boolean') {
                    if (data.playing) requestPlayback();
                    else pausePlayback();
                }
                break;
            case 'change_source':
                changeMediaSource(
                    data.source || directMediaSource(data.src),
                    false,
                    data,
                );
                if (data.preserve_position && activeMediaSource?.mode === 'direct_media') {
                    scheduleSourceState({
                        video_src: data.src,
                        media_source: data.source || directMediaSource(data.src),
                        time: Number(data.time) || 0,
                        playing: Boolean(data.playing),
                        speed: Number(data.speed) || 1,
                        server_time: data.server_time,
                        revision,
                    });
                }
                addSystemMessage(`🎬 ${data.username} 切换了视频`);
                break;
            case 'speed':
                basePlaybackRate = Number(data.speed) || 1;
                if (usesOfficialPage) {
                    updateExternalEventState(
                        typeof data.playing === 'boolean'
                            ? data.playing
                            : Boolean(externalPlaybackState?.playing),
                        basePlaybackRate,
                    );
                    addSystemMessage(`⏩ ${data.username} 调整倍速为 ${data.speed}x`, true);
                    break;
                }
                setInternalPlaybackRate(basePlaybackRate);
                addSystemMessage(`⏩ ${data.username} 调整倍速为 ${data.speed}x`, true);
                break;
            default:
                break;
        }
    });

    videoPlayer.addEventListener('loadedmetadata', () => {
        sourceChangeUntil = 0;
        enablePitchPreservation();
        updatePlaybackHealth();
    });

    videoPlayer.addEventListener('timeupdate', () => {
        if (!videoPlayer.paused && !videoPlayer.seeking) {
            lastSeekTime = videoPlayer.currentTime;
        }
    });

    function scheduleBufferingReport() {
        if (
            !strictSyncToggle.checked
            || document.visibilityState === 'hidden'
            || !activeSource
            || videoPlayer.paused
            || videoPlayer.seeking
            || bufferingReported
        ) {
            return;
        }
        window.clearTimeout(bufferingTimer);
        const sourceGraceRemaining = Math.max(0, sourceChangeUntil - Date.now());
        const reportDelay = Math.max(
            BUFFER_REPORT_DELAY,
            sourceGraceRemaining + 100,
        );
        bufferingTimer = window.setTimeout(() => {
            if (Date.now() < sourceChangeUntil) {
                scheduleBufferingReport();
                return;
            }
            if (
                strictSyncToggle.checked
                && document.visibilityState !== 'hidden'
                && !videoPlayer.paused
                && !videoPlayer.seeking
                && Date.now() >= sourceChangeUntil
                && videoPlayer.readyState < 3
                && bufferedSecondsAhead() < CRITICAL_BUFFER_AHEAD
                && !bufferingReported
            ) {
                bufferingReported = true;
                bufferingStartedAt = Date.now();
                stallHistory.push(bufferingStartedAt);
                pruneStallHistory();
                socket.emit('buffering_event', {
                    room: roomId,
                    active: true,
                    time: videoPlayer.currentTime,
                });
            }
        }, reportDelay);
    }

    function bufferedSecondsAhead() {
        const position = videoPlayer.currentTime;
        for (let index = 0; index < videoPlayer.buffered.length; index += 1) {
            const start = videoPlayer.buffered.start(index);
            const end = videoPlayer.buffered.end(index);
            if (position >= start - 0.08 && position <= end + 0.08) {
                return Math.max(0, end - position);
            }
        }
        return 0;
    }

    function pruneStallHistory() {
        const cutoff = Date.now() - STALL_HISTORY_WINDOW;
        stallHistory = stallHistory.filter(timestamp => timestamp >= cutoff);
        return stallHistory.length;
    }

    function recoveryBufferTarget(remaining) {
        if (!isHlsSource(activeSource)) {
            return Math.min(PROGRESSIVE_RECOVERY_BUFFER, remaining);
        }
        const recentStalls = pruneStallHistory();
        const target = recentStalls >= 2
            ? REPEAT_RECOVERY_BUFFER
            : BASE_RECOVERY_BUFFER;
        return Math.min(target, remaining);
    }

    function updatePlaybackHealth() {
        if (!playbackHealth) return;
        playbackHealth.classList.remove('is-good', 'is-warning', 'is-bad');
        if (!activeSource || videoPlayer.readyState < 1) {
            playbackHealth.textContent = '缓冲检测中';
            playbackHealth.title = '载入视频后显示缓冲余量、卡顿和掉帧';
            return;
        }

        const bufferAhead = bufferedSecondsAhead();
        const recentStalls = pruneStallHistory();
        const quality = typeof videoPlayer.getVideoPlaybackQuality === 'function'
            ? videoPlayer.getVideoPlaybackQuality()
            : null;
        const droppedFrames = Number(quality?.droppedVideoFrames || 0);
        const totalFrames = Number(quality?.totalVideoFrames || 0);
        const estimatedBandwidth = Number(hlsInstance?.bandwidthEstimate || 0);
        const parts = [`缓冲 ${bufferAhead.toFixed(1)}s`];
        if (recentStalls) parts.push(`卡顿 ${recentStalls}`);
        if (droppedFrames) parts.push(`掉帧 ${droppedFrames}`);
        playbackHealth.textContent = parts.join(' · ');

        if (bufferingReported || roomBufferingActive) {
            playbackHealth.classList.add('is-bad');
        } else if (
            (!videoPlayer.paused && bufferAhead < 1)
            || recentStalls >= 2
            || (totalFrames > 0 && droppedFrames / totalFrames > 0.03)
        ) {
            playbackHealth.classList.add('is-warning');
        } else {
            playbackHealth.classList.add('is-good');
        }

        const details = [
            `当前缓冲：${bufferAhead.toFixed(2)} 秒`,
            `最近一分钟真实卡顿：${recentStalls} 次`,
            `视频掉帧：${droppedFrames}/${totalFrames || 0}`,
        ];
        if (estimatedBandwidth > 0) {
            details.push(`HLS 估算带宽：${(estimatedBandwidth / 1_000_000).toFixed(1)} Mbps`);
        }
        playbackHealth.title = details.join('；');
    }

    function scheduleBufferRecovery() {
        window.clearTimeout(bufferRecoveryTimer);
        if (!bufferingReported) {
            window.clearTimeout(bufferingTimer);
            return;
        }

        const remaining = Number.isFinite(videoPlayer.duration)
            ? Math.max(0, videoPlayer.duration - videoPlayer.currentTime)
            : BASE_RECOVERY_BUFFER;
        const targetBuffer = recoveryBufferTarget(remaining);
        const recovered = (
            videoPlayer.ended
            || bufferedSecondsAhead() >= targetBuffer
        );
        if (recovered) {
            clearBufferingReport(true);
            return;
        }
        bufferRecoveryTimer = window.setTimeout(scheduleBufferRecovery, 300);
    }

    function clearBufferingReport(force = false) {
        window.clearTimeout(bufferingTimer);
        if (!bufferingReported) return;
        if (!force) {
            scheduleBufferRecovery();
            return;
        }
        window.clearTimeout(bufferRecoveryTimer);
        bufferingReported = false;
        bufferingStartedAt = 0;
        socket.emit('buffering_event', {
            room: roomId,
            active: false,
            time: videoPlayer.currentTime,
        });
    }

    // Native browser controls are trusted input. A new click/drag must not be
    // swallowed by the time guard from an earlier room update.
    for (const name of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
        videoPlayer.addEventListener(name, event => {
            if (!event.isTrusted) return;
            remoteGuardUntil = 0;
            remoteSeekUntil = 0;
        }, { passive: true });
    }
    videoPlayer.addEventListener('play', () => {
        const wasBlocked = autoplayBlocked;
        setPlaybackPrompt(false);
        if (consumeRemotePlaybackEvent('play') || videoPlayer.paused) return;
        if (wasBlocked && latestPlaybackState?.playing) {
            guardRemoteUpdate();
            if (socket.connected) socket.emit('request_room_state', { room: roomId });
            return;
        }
        emitVideoEvent('play');
    });
    videoPlayer.addEventListener('pause', () => {
        if (consumeRemotePlaybackEvent('pause') || !videoPlayer.paused || videoPlayer.ended
            || document.visibilityState === 'hidden') return;
        if (!videoPlayer.seeking) emitVideoEvent('pause');
    });
    videoPlayer.addEventListener('seeking', () => {
        if (!isRemoteUpdate()) localInteractionUntil = Date.now() + 3000;
    });
    videoPlayer.addEventListener('seeked', () => {
        if (remoteSeekUntil) {
            remoteSeekUntil = 0;
            lastSeekTime = videoPlayer.currentTime;
            guardRemoteUpdate(400);
        }
        emitVideoEvent('seek');
    });
    videoPlayer.addEventListener('ratechange', () => {
        if (Date.now() < internalRateChangeUntil) return;
        basePlaybackRate = videoPlayer.playbackRate;
        emitVideoEvent('speed', { speed: videoPlayer.playbackRate });
    });
    videoPlayer.addEventListener('waiting', scheduleBufferingReport);
    videoPlayer.addEventListener('stalled', scheduleBufferingReport);
    videoPlayer.addEventListener('playing', scheduleBufferRecovery);
    videoPlayer.addEventListener('canplay', scheduleBufferRecovery);
    videoPlayer.addEventListener('canplaythrough', scheduleBufferRecovery);

    strictSyncToggle.addEventListener('change', () => {
        localStorage.setItem('tw_strict_sync', strictSyncToggle.checked ? 'true' : 'false');
        if (!strictSyncToggle.checked) {
            clearBufferingReport(true);
            updateSyncHealth(null, '强一致模式已关闭');
        } else {
            updateSyncHealth(null);
        }
    });

    videoPlayer.addEventListener('error', () => {
        const errorCode = videoPlayer.error?.code;
        const diagnostic = mediaElementDiagnostic(errorCode);
        if (activeSource && !activeSource.startsWith('/static/uploads/')) {
            showUrlDiagnostic('error', diagnostic);
        }
        addSystemMessage(`❌ ${diagnostic.error}：${diagnostic.reason}`);
        sourceChangeUntil = 0;
        clearBufferingReport(true);
    });

    async function fetchJsonWithTimeout(url, options, timeoutMs) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
            });
            const data = await response.json().catch(() => ({}));
            return { response, data };
        } catch (error) {
            if (error.name === 'AbortError') {
                const timeoutError = new Error(`等待超过 ${Math.round(timeoutMs / 1000)} 秒`);
                timeoutError.code = 'client_timeout';
                throw timeoutError;
            }
            throw error;
        } finally {
            window.clearTimeout(timer);
        }
    }

    async function handleVideoUrl(rawUrl) {
        let parsedUrl;
        try {
            parsedUrl = new URL(rawUrl);
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
        } catch (_error) {
            showUrlDiagnostic('error', {
                error: '链接格式不完整',
                stage: '链接检查',
                reason: '输入内容不是完整的 HTTP(S) 地址。',
                suggestion: '请粘贴以 http:// 或 https:// 开头的完整链接。',
            });
            return;
        }

        loadUrlBtn.disabled = true;
        loadUrlBtn.textContent = '识别中…';
        showUrlDiagnostic('pending', {
            error: '正在识别视频来源…',
            stage: '来源识别',
            reason: '只判断网站、视频ID和播放方式，不提取网页中的真实媒体地址。',
        });

        try {
            const { response, data } = await fetchJsonWithTimeout(
                '/resolve_source',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: parsedUrl.href }),
                },
                5000,
            );
            if (!response.ok || !data.ok || !data.source) {
                showUrlDiagnostic('error', {
                    ...data,
                    error: data.error || '无法识别这个视频来源',
                });
                return;
            }

            changeMediaSource(data.source, true);
            const isOfficialPage = data.source.mode === 'official_page';
            showUrlDiagnostic(isOfficialPage ? 'warning' : 'success', {
                ...data.diagnostic,
                error: isOfficialPage
                    ? `已识别：${data.source.provider_name}官方页面`
                    : '已识别管理员登记的授权媒体',
                suggestion: isOfficialPage
                    ? '为避免打断聊天室，页面不会自动跳转；准备好后点击画面中的“打开视频并连接”。'
                    : '视频将由每位成员的浏览器直接加载，本站不会中转流量。',
            });
        } catch (error) {
            if (error.code === 'client_timeout') {
                showUrlDiagnostic('error', {
                    error: '来源识别请求超时',
                    stage: '本站服务',
                    reason: `${error.message}，来源识别本身不需要访问视频网站。`,
                    suggestion: '请确认本站服务仍在运行，然后重试。',
                });
            } else {
                showUrlDiagnostic('error', {
                    error: '本站诊断请求失败',
                    stage: '本站服务',
                    reason: error.message || '浏览器没有收到诊断结果。',
                    suggestion: '确认本站服务仍在运行，然后刷新页面重试。',
                });
            }
        } finally {
            loadUrlBtn.disabled = false;
            loadUrlBtn.textContent = '使用这个链接';
        }
    }

    loadUrlBtn.addEventListener('click', () => {
        const value = urlInput.value.trim();
        if (value) handleVideoUrl(value);
    });

    urlInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            loadUrlBtn.click();
        }
    });

    function copyPlainText(text, done, failureMessage) {
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => {
                addSystemMessage(failureMessage);
            });
            return;
        }
        const helper = document.createElement('textarea');
        helper.value = text;
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        if (document.execCommand('copy')) done();
        else addSystemMessage(failureMessage);
        helper.remove();
    }

    bookmarkletLink?.addEventListener('click', event => {
        event.preventDefault();
        addSystemMessage('请把“一起看助手”按钮拖到浏览器书签栏；进入视频播放页后再点击该书签。');
    });
    bookmarkletLink?.addEventListener('dragstart', event => {
        if (!bookmarkletHref || !event.dataTransfer) return;
        event.dataTransfer.setData('text/uri-list', bookmarkletHref);
        event.dataTransfer.setData('text/plain', bookmarkletHref);
        event.dataTransfer.effectAllowed = 'copyLink';
    });
    copyBookmarkletBtn?.addEventListener('click', () => {
        if (!bookmarkletHref) {
            addSystemMessage('书签助手代码生成失败，请刷新房间页面。');
            return;
        }
        copyPlainText(
            bookmarkletHref,
            () => {
                copyBookmarkletBtn.textContent = '助手代码已复制';
                window.setTimeout(() => {
                    copyBookmarkletBtn.textContent = '复制助手代码';
                }, 1500);
                addSystemMessage('已复制。请新建一个书签，把代码粘贴到书签的网址栏。');
            },
            '复制失败，请使用拖拽方式添加书签助手。',
        );
    });

    copyCompanionConfigBtn?.addEventListener('click', () => {
        const config = JSON.stringify(companionConfig());
        const done = () => {
            copyCompanionConfigBtn.textContent = '配置已复制';
            window.setTimeout(() => {
                copyCompanionConfigBtn.textContent = '复制插件连接配置';
            }, 1500);
        };
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(config).then(done).catch(() => {
                addSystemMessage('复制失败，请手动在浏览器插件中填写服务器和房间号。');
            });
        }
    });

    videoVolumeSlider?.addEventListener('input', () => {
        videoVolume = Math.max(0, Math.min(100, Number(videoVolumeSlider.value) || 0));
        applyVideoVolume();
    });
    applyVideoVolume({ notifyCompanion: false });

    fitToggleBtn.addEventListener('click', () => {
        if (activeMediaSource?.mode === 'official_page' && !localMirrorStream) {
            addSystemMessage('官方页面伴随模式的画面布局由原网站控制。');
            return;
        }
        const isCover = videoPlayer.classList.toggle('video-cover');
        fitToggleBtn.textContent = isCover ? '▣ 完整画面' : '↔ 铺满画面';
    });
    localMirrorBtn?.addEventListener('click', startLocalMirror);
    mirrorPlayToggle?.addEventListener('click', () => {
        const state = externalPlaybackState || {};
        const current = state.time !== undefined
            ? expectedPosition(state)
            : Number(mirrorSeek?.value) || 0;
        emitMirrorVideoEvent(state.playing ? 'pause' : 'play', current);
    });
    mirrorSeek?.addEventListener('input', () => {
        mirrorSeekPreview = true;
        mirrorCurrentTime.textContent = formatMirrorTime(mirrorSeek.value, '00:00');
    });
    mirrorSeek?.addEventListener('change', () => {
        const targetTime = Math.max(0, Number(mirrorSeek.value) || 0);
        mirrorSeekPreview = false;
        emitMirrorVideoEvent('seek', targetTime);
    });
    mirrorSeek?.addEventListener('blur', () => {
        mirrorSeekPreview = false;
    });
    mirrorSpeed?.addEventListener('change', () => {
        const speed = Math.max(0.25, Math.min(4, Number(mirrorSpeed.value) || 1));
        const current = externalPlaybackState
            ? expectedPosition(externalPlaybackState)
            : Number(mirrorSeek?.value) || 0;
        emitMirrorVideoEvent('speed', current, { speed });
    });
    window.setInterval(() => {
        if (localMirrorStream && externalPlaybackState && !mirrorSeekPreview) {
            updateMirrorPlaybackControls();
        }
    }, 500);

    qualitySelect.addEventListener('change', () => {
        if (!hlsInstance) return;
        const selectedLevel = Number(qualitySelect.value);
        qualityMode = selectedLevel === -1 ? 'auto' : 'manual';
        hlsInstance.loadLevel = selectedLevel;
        if (selectedLevel === -1) {
            qualityBadge.textContent = '自动选择';
        } else {
            qualityBadge.textContent = '已锁定';
        }
    });

    function copyInviteLink() {
        const inviteUrl = new URL('/', window.location.origin);
        inviteUrl.searchParams.set('room', roomId);
        const finish = () => {
            const oldText = copyRoomBtn.textContent;
            copyRoomBtn.textContent = '已复制';
            window.setTimeout(() => {
                copyRoomBtn.textContent = oldText;
            }, 1500);
        };

        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(inviteUrl.href).then(finish).catch(() => {
                addSystemMessage('复制失败，请手动复制浏览器地址。');
            });
            return;
        }

        const helper = document.createElement('textarea');
        helper.value = inviteUrl.href;
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        if (document.execCommand('copy')) finish();
        helper.remove();
    }

    copyRoomBtn.addEventListener('click', copyInviteLink);

    function sendMessage() {
        const message = chatInput.value.trim();
        if (!message || !socket.connected) return;
        socket.emit('chat_message', { room: roomId, message });
        chatInput.value = '';
    }

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            sendMessage();
        }
    });

    window.setInterval(() => {
        if (socket.connected && activeSource) {
            socket.emit('request_room_state', { room: roomId });
        }
    }, 10000);

    window.setInterval(sendSyncPing, 3000);
    window.setInterval(updatePlaybackHealth, 1000);
    updatePlaybackHealth();

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            clearBufferingReport(true);
            return;
        }
        if (document.visibilityState === 'visible' && socket.connected) {
            socket.emit('request_room_state', { room: roomId });
            sendSyncPing();
        }
    });

    window.addEventListener('beforeunload', () => {
        if (localMirrorStream) clearLocalMirror();
        callController?.destroy();
        socket.emit('leave', { room: roomId });
    });
});
