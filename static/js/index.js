document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    const usernameInput = document.getElementById('username');
    const roomInput = document.getElementById('roomId');
    const createButton = document.getElementById('createRoomBtn');
    const joinButton = document.getElementById('joinRoomBtn');
    const formError = document.getElementById('formError');
    const complianceConsent = document.getElementById('complianceConsent');
    const legalVersion = form.dataset.legalVersion || '';
    const entry = document.getElementById('roomEntry');
    function showEntry() {
        if (typeof entry?.showModal === 'function' && !entry.open) entry.showModal();
    }
    document.getElementById('roomEntryClose')?.addEventListener('click', () => entry.close());
    document.querySelectorAll?.('a[href="/#roomEntry"]').forEach(link => link.addEventListener('click', event => {
        event.preventDefault(); showEntry();
    }));
    window.addEventListener?.('hashchange', () => { if (window.location.hash === '#roomEntry') showEntry(); });
    if (window.location.hash === '#roomEntry') showEntry();
    const roomPattern = /^[\p{L}\p{N}_-]{4,64}$/u;

    const savedUsername = localStorage.getItem('tw_username');
    if (savedUsername) {
        usernameInput.value = savedUsername;
    }
    if (
        complianceConsent
        && legalVersion
        && localStorage.getItem('tw_legal_notice_version') === legalVersion
    ) {
        complianceConsent.checked = true;
    }

    function generateRoomId() {
        const bytes = new Uint8Array(12);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    function roomIdFromInput(value) {
        const trimmed = value.trim().replace(/^房间(?:号)?[：:\s]+/, '').trim();
        if (!trimmed) return '';
        if (/^[a-f\d]{24}$/i.test(trimmed)) return trimmed.toLowerCase();
        try {
            const link = trimmed.match(/https?:\/\/[^\s<>]+/i);
            const parsed = new URL(link ? link[0].replace(/[)\]}>，。；！？]+$/, '') : trimmed);
            if (parsed.origin !== window.location.origin || parsed.username || parsed.password) return '';
            const queryRoom = parsed.searchParams.get('room');
            if (queryRoom && parsed.pathname === '/' && parsed.searchParams.getAll('room').length === 1) return queryRoom.trim();
            const match = parsed.pathname.match(/^\/(?:mobile-room|room)\/([^/?#]+)\/?$/);
            if (match) return decodeURIComponent(match[1]).trim();
        } catch (_error) {
            // A plain room id is expected in most cases.
        }
        return trimmed;
    }

    function validatedUsername() {
        formError.textContent = '';
        if (!complianceConsent?.checked) {
            formError.textContent = '请先阅读并同意用户协议和隐私政策。';
            complianceConsent?.focus();
            return '';
        }
        const username = usernameInput.value.trim();
        if (!username) {
            formError.textContent = '先给自己取一个昵称吧。';
            usernameInput.focus();
            return '';
        }
        localStorage.setItem('tw_username', username.slice(0, 32));
        if (legalVersion) {
            localStorage.setItem('tw_legal_notice_version', legalVersion);
        }
        return username.slice(0, 32);
    }

    function enterRoom(roomId) {
        if (!roomPattern.test(roomId)) {
            formError.textContent = '请粘贴有效邀请链接，或输入4–64位房间号。';
            roomInput.focus();
            return false;
        }
        window.location.href = `/room/${encodeURIComponent(roomId)}`;
        return true;
    }

    createButton.addEventListener('click', () => {
        if (!validatedUsername()) return;
        if (roomInput.value.trim()) {
            // An invitation must never be silently replaced with a random room.
            enterRoom(roomIdFromInput(roomInput.value));
            return;
        }
        enterRoom(generateRoomId());
    });

    form.addEventListener('submit', event => {
        event.preventDefault();
        if (!validatedUsername()) return;
        enterRoom(roomIdFromInput(roomInput.value));
    });

    const invitedRoom = new URLSearchParams(window.location.search).get('room');
    const noticeRequired = new URLSearchParams(window.location.search).get('notice') === 'required';
    if (invitedRoom && roomPattern.test(invitedRoom)) {
        showEntry();
        roomInput.value = invitedRoom;
        joinButton.textContent = '加入朋友的房间';
        if (noticeRequired) {
            formError.textContent = '加入房间前，请先阅读并同意用户协议和隐私政策。';
        }
        if (usernameInput.value) {
            joinButton.focus();
        } else {
            usernameInput.focus();
        }
    }
});
