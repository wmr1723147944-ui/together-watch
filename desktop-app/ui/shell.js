'use strict';
const $ = id => document.getElementById(id);
let room = '', finderMode = 'catalog';
const LEGAL_VERSION = '2026-07-28';
let entryMode = 'join', submitting = false;
const samples = { sintel: 'https://media.w3.org/2010/05/sintel/trailer.mp4', bunny: 'https://media.w3.org/2010/05/bunny/trailer.mp4' };
for (const button of document.querySelectorAll('[data-sample]')) button.onclick = () => { $('source').value = samples[button.dataset.sample]; };
$('nickname').value = localStorage.getItem('nickname') || '观影成员';
$('consent').checked = localStorage.getItem('tw_desktop_consent') === LEGAL_VERSION;
$('room').oninput = () => { $('source').disabled = !!$('room').value.trim(); };
$('roomLabel').onclick = () => window.desktop.action('copy-room');
function closeEntry() { $('setup').close(); $('setup').hidden=true; }
function finder() { room=''; closeEntry(); document.body.classList.toggle('catalog-home',finderMode==='catalog'); $('tools').hidden = true; $('finderTools').hidden = finderMode==='catalog'; $('placeholder').hidden = true; $('home').hidden=false; $('settings').hidden=false; }
function joined(id) { closeEntry(); document.body.classList.remove('catalog-home'); room = id; $('roomLabel').textContent = `复制房间号 · ${room}`; $('tools').hidden = false; $('finderTools').hidden = true; $('placeholder').hidden = false; $('home').hidden = true; $('settings').hidden = true; }
function showEntry() {
    $('setup').hidden=false;
    if (!$('setup').open) $('setup').showModal();
    (entryMode==='watch'?$('nickname'):$('room')).focus();
}
$('cancelEntry').onclick = () => { if(!submitting) window.desktop.action('back'); };
$('setup').addEventListener('cancel',event=>{event.preventDefault();if(!submitting)window.desktop.action('back');});
$('startForm').addEventListener('invalid',event=>{const details=event.target.closest('details');if(details)details.open=true;},true);
$('home').onclick = () => window.desktop.action('home');
$('previous').onclick = () => window.desktop.action('back');
$('more').onclick = () => window.desktop.action({type:'tools',expanded:$('roomMore').hidden});
$('leave').onclick = () => window.desktop.action('leave');
$('finder-catalog').onclick = () => window.desktop.action('discover');
$('change-film').onclick = () => window.desktop.action('discover');
$('finder-kanju').onclick = () => window.desktop.action('kanju');
$('finder-pick').onclick = () => window.desktop.action('pick-current');
for (const action of ['finder-back','finder-reload','finder-browser']) $(action).onclick = () => window.desktop.action(action);
async function enterRoom() {
    if(submitting)return;
    if(entryMode==='join' && !$('room').value.trim() && !$('source').value.trim()) {
        $('error').textContent='请粘贴朋友发来的邀请。自己选片请关闭此窗口。';return;
    }
    submitting=true; $('error').textContent = ''; $('start').disabled = true; $('cancelEntry').disabled=true;
    try {
        const result = await window.desktop.start({ nickname: $('nickname').value, room: $('room').value, source: $('source').value, consent: $('consent').checked });
        if (!result.ok) { $('error').textContent = result.error; showEntry(); return; }
        localStorage.setItem('nickname', $('nickname').value);
        localStorage.setItem('tw_desktop_consent',LEGAL_VERSION);
        if (result.browsing) { finder(); return; }
        joined(result.room);
    } catch { $('error').textContent = '暂时无法打开，请检查网络后再试'; showEntry(); }
    finally { submitting=false; $('start').disabled = false; $('cancelEntry').disabled=false; }
}
$('startForm').onsubmit = event => {event.preventDefault();enterRoom();};
for (const action of ['reload','invite','detect','fullscreen','settings','discover','return-video','cinema','scan-media','original','kanju','pick-current']) $(action).onclick = () => window.desktop.action(action);
$('discover').onclick = () => window.desktop.action('episodes');
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
    if (data.message) { $('status').textContent = data.message; $('status').title = data.message; }
    if (data.finder) finder();
    if (data.joined) joined(data.joined);
    if (data.finderMode) { finderMode=data.finderMode; $('pick-current').hidden = finderMode === 'catalog'; $('finder-pick').hidden = finderMode === 'catalog'; if($('tools').hidden)finder(); }
    if (data.source) $('currentSource').value = data.source;
    if (typeof data.host === 'boolean') { $('discover').disabled = !data.host; $('discover').title = data.host ? '保留房间，选择其他影片或集数' : '由房主换片，你会自动跟随'; }
    if (typeof data.browsing === 'boolean') { $('return-video').hidden=!data.browsing; $('fullscreen').hidden=data.browsing; }
    if (typeof data.advanced === 'boolean') {
        $('roomMore').hidden=!data.advanced; $('tools').classList.toggle('expanded',data.advanced);
        $('more').setAttribute('aria-expanded',String(data.advanced)); $('more').textContent=data.advanced?'收起选项':'更多 ···';
    }
    if (typeof data.cinema === 'boolean') $('cinema').textContent=data.cinema?'显示完整网页':'只显示视频区域';
    if (Array.isArray(data.candidates)) {
        const previous = $('mediaChoices').value;
        $('mediaChoices').replaceChildren(new Option(data.candidates.length ? `识别到 ${data.candidates.length} 项，请选择` : '尚未识别到可转移的视频', ''));
        for (const item of data.candidates) $('mediaChoices').add(new Option(item.label, item.id));
        if (data.candidates.some(item => item.id === previous)) $('mediaChoices').value = previous;
        else if (data.candidates.length === 1) $('mediaChoices').value = data.candidates[0].id;
        $('play-media').disabled = !$('mediaChoices').value;
    }
    if (typeof data.builtin === 'boolean') $('modeLabel').textContent = data.builtin ? '内置播放' : '网页播放';
    if (data.setup) { document.body.classList.remove('catalog-home'); $('setup').hidden = false; $('tools').hidden = true; $('finderTools').hidden = true; $('placeholder').hidden = true;
        room=''; $('home').hidden=false; $('settings').hidden=false;
        $('room').value=''; $('source').disabled=false; $('source').value=data.pendingSource||''; $('error').textContent='';
        entryMode=data.pendingSource?'watch':'join'; $('setup').dataset.mode=entryMode;
        $('roomField').hidden=entryMode==='watch'; $('manualEntry').hidden=entryMode==='watch'; $('manualEntry').open=false;
        $('profileFields').open=entryMode==='watch' || !$('consent').checked;
        $('entryTitle').textContent=entryMode==='watch'?'开始一起看':'加入朋友房间';
        $('entryHint').textContent=entryMode==='watch'?'首次使用确认一下即可。以后选好影片直接进入房间。':'粘贴邀请，自动打开朋友正在看的影片。';
        $('start').textContent=entryMode==='watch'?'开始观看':'加入房间';
        if(entryMode==='watch' && $('consent').checked && $('nickname').value.trim()) {closeEntry();enterRoom();}
        else showEntry(); }
});
