'use strict';
const $ = id => document.getElementById(id);
let room = '';
const samples = { sintel: 'https://media.w3.org/2010/05/sintel/trailer.mp4', bunny: 'https://media.w3.org/2010/05/bunny/trailer.mp4' };
for (const button of document.querySelectorAll('[data-sample]')) button.onclick = () => { $('source').value = samples[button.dataset.sample]; };
$('nickname').value = localStorage.getItem('nickname') || '观影成员';
$('startForm').onsubmit = async event => {
    event.preventDefault(); $('error').textContent = ''; $('start').disabled = true;
    try {
        const result = await window.desktop.start({ nickname: $('nickname').value, room: $('room').value, source: $('source').value, consent: $('consent').checked });
        if (!result.ok) { $('error').textContent = result.error; return; }
        room = result.room; localStorage.setItem('nickname', $('nickname').value);
        $('roomLabel').textContent = `房间 ${room}`; $('currentSource').value = $('source').value;
        $('setup').hidden = true; $('tools').hidden = false; $('placeholder').hidden = false;
    } catch { $('error').textContent = '暂时无法打开，请检查网络后再试'; }
    finally { $('start').disabled = false; }
};
for (const action of ['back','reload','invite','detect','fullscreen','settings','discover','return-video','cinema']) $(action).onclick = () => window.desktop.action(action);
for (const action of ['terms','privacy']) $(action).onclick = event => { event.preventDefault(); window.desktop.action(action); };
$('sourceForm').onsubmit = async event => { event.preventDefault(); const result = await window.desktop.action({ type: 'source', source: $('currentSource').value }); if (result?.error) $('status').textContent = result.error; };
window.desktop.onStatus(data => {
    if (data.message) $('status').textContent = data.message;
    if (data.source) $('currentSource').value = data.source;
    if (data.setup) { $('setup').hidden = false; $('tools').hidden = true; $('placeholder').hidden = true; }
});
