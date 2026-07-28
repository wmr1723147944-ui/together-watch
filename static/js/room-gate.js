document.addEventListener('DOMContentLoaded', () => {
    const roomId = document.getElementById('roomData')?.value || '';
    const legalVersion = document.getElementById('legalNoticeVersion')?.value || '';
    if (
        roomId
        && legalVersion
        && localStorage.getItem('tw_legal_notice_version') !== legalVersion
    ) {
        window.TW_LEGAL_GATE_BLOCKED = true;
        const query = new URLSearchParams({
            room: roomId,
            notice: 'required',
        });
        window.location.replace(`/?${query.toString()}`);
    }
});
