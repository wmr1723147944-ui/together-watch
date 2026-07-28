document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    const usernameInput = document.getElementById('username');
    const roomInput = document.getElementById('roomId');
    const generateButton = document.getElementById('generateRoomBtn');
    const formError = document.getElementById('formError');
    const roomPattern = /^[\p{L}\p{N}_-]{4,64}$/u;

    const savedUsername = localStorage.getItem('tw_username');
    if (savedUsername) {
        usernameInput.value = savedUsername;
    }

    function generateRoomId() {
        const bytes = new Uint8Array(12);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    generateButton.addEventListener('click', () => {
        roomInput.value = generateRoomId();
        formError.textContent = '';
        roomInput.focus();
        roomInput.select();
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        formError.textContent = '';

        const username = usernameInput.value.trim();
        const roomId = roomInput.value.trim();
        if (!username) {
            formError.textContent = '先给自己取一个昵称吧。';
            usernameInput.focus();
            return;
        }
        if (!roomPattern.test(roomId)) {
            formError.textContent = '房间号需为 4–64 位，只能包含文字、数字、下划线或短横线。';
            roomInput.focus();
            return;
        }

        localStorage.setItem('tw_username', username.slice(0, 32));
        window.location.href = `/room/${encodeURIComponent(roomId)}`;
    });
});
