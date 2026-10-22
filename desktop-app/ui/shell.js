'use strict';
const $ = id => document.getElementById(id);
let room = '', finderMode = 'catalog';
const samples = { sintel: 'https://media.w3.org/2010/05/sintel/trailer.mp4', bunny: 'https://media.w3.org/2010/05/bunny/trailer.mp4' };
for (const button of document.querySelectorAll('[data-sample]')) button.onclick = () => { $('source').value = samples[button.dataset.sample]; };
$('nickname').value = localStorage.getItem('nickname') || '观影成员';
$('room').oninput = () => { $('start').textContent = $('room').value.trim() ? '加入邀请，自动跟随 →' : '先找片，选好再建房 →'; $('source').disabled = !!$('room').value.trim(); };
$('roomLabel').onclick = () => window.desktop.action('copy-room');
function finder() { document.body.classList.toggle('catalog-home',finderMode==='catalog'); $('setup').hidden = true; $('tools').hidden = true; $('finderTools').hidden = finderMode==='catalog'; $('placeholder').hidden = true; }
function joined(id) { document.body.classList.remove('catalog-home'); room = id; $('roomLabel').textContent = `房间 ${room}`; $('setup').hidden = true; $('tools').hidden = false; $('finderTools').hidden = true; $('placeholder').hidden = false; }
$('home').onclick = () => window.desktop.action('home');
$('previous').onclick = () => window.desktop.action('back');
$('finder-catalog').onclick = () => window.desktop.action('discover');
$('finder-kanju').onclick = () => window.desktop.action('kanju');
$('finder-pick').onclick = () => window.desktop.action('pick-current');
for (const action of ['finder-back','finder-reload','finder-browser']) $(action).onclick = () => window.desktop.action(action);
$('startForm').onsubmit = async event => {
    event.preventDefault(); $('error').textContent = ''; $('start').disabled = true;
    try {
        const result = await window.desktop.start({ nickname: $('nickname').value, room: $('room').value, source: $('source').value, consent: $('consent').checked });
        if (!result.ok) { $('error').textContent = result.error; return; }
        localStorage.setItem('nickname', $('nickname').value);
        if (result.browsing) { finder(); return; }
        joined(result.room);
    } catch { $('error').textContent = '暂时无法打开，请检查网络后再试'; }
    finally { $('start').disabled = false; }
};
for (const action of ['back','reload','invite','detect','fullscreen','settings','discover','return-video','cinema','scan-media','original','kanju','pick-current']) $(action).onclick = () => window.desktop.action(action);
$('mediaChoices').onchange = () => { $('play-media').disabled = !$('mediaChoices').value; };
$('play-media').onclick = async () => {
    $('play-media').disabled = true;
    try {
        const result = await window.desktop.action({ type: 'play-media', id: $('mediaChoices').value });
        if (result?.error) $('status').textContent = result.error;
    } catch { $('status').textContent = '内置播放未能打开，请重新识别或返回原网页。'; }
    finally { $('play-media').disabled = !$('mediaChoices').value; }
};
for (const action of ['terms','privacy']) $(action).onclick = event => { event.preventDefault(); window.desktop.action(action); };
$('sourceForm').onsubmit = async event => { event.preventDefault(); const result = await window.desktop.action({ type: 'source', source: $('currentSource').value }); if (result?.error) $('status').textContent = result.error; };
window.desktop.onStatus(data => {
    if (data.message) $('status').textContent = data.message;
    if (data.finder) finder();
    if (data.joined) joined(data.joined);
    if (data.finderMode) { finderMode=data.finderMode; $('pick-current').hidden = finderMode === 'catalog'; $('finder-pick').hidden = finderMode === 'catalog'; if($('tools').hidden)finder(); }
    if (data.source) $('currentSource').value = data.source;
    if (Array.isArray(data.candidates)) {
        const previous = $('mediaChoices').value;
        $('mediaChoices').replaceChildren(new Option(data.candidates.length ? `识别到 ${data.candidates.length} 项，请选择` : '尚未识别到可转移的视频', ''));
        for (const item of data.candidates) $('mediaChoices').add(new Option(item.label, item.id));
        if (data.candidates.some(item => item.id === previous)) $('mediaChoices').value = previous;
        else if (data.candidates.length === 1) $('mediaChoices').value = data.candidates[0].id;
        $('play-media').disabled = !$('mediaChoices').value;
    }
    if (typeof data.builtin === 'boolean') $('modeLabel').textContent = data.builtin ? '内置播放' : '原网页';
    if (data.setup) { document.body.classList.remove('catalog-home'); $('setup').hidden = false; $('tools').hidden = true; $('finderTools').hidden = true; $('placeholder').hidden = true;
        $('room').value=''; $('source').disabled=false; $('source').value=data.pendingSource||''; $('error').textContent='';
        $('start').textContent=data.pendingSource?'确认并创建房间 →':'加入邀请 / 继续 →';
        (data.pendingSource?$('nickname'):$('room')).focus(); }
});
