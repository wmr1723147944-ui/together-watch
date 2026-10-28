'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../ui/player.js'),'utf8');
function setup() {
    const listeners = {}, timers = new Set(), streams = [],documentListeners={},windowListeners={},classes=new Set();
    const video = { currentTime:0,duration:120,readyState:0,style:{},paused:true,
        addEventListener(name, fn) { listeners[name] = fn; },
        pause() { this.paused = true; }, load() {}, removeAttribute() { this.src = ''; },
        getAttribute() { return this.src; }, canPlayType() { return ''; } };
    const notice = {textContent:'',hidden:false}, levels = {options:[],
        replaceChildren(option) { this.options = [option]; },add(option) { this.options.push(option); } };
    const elements = {video,notice,levels,fit:{},episodes:{disabled:true},'player-fullscreen':{}};
    class Hls {
        static Events = {ERROR:'error',MANIFEST_PARSED:'manifest'};
        static isSupported() { return true; }
        constructor(options) { this.options=options; this.events={}; this.levels=[]; streams.push(this); }
        on(name, fn) { this.events[name]=fn; }
        loadSource(url) { this.url=url; } attachMedia() {} stopLoad() { this.stopped=true; } destroy() { this.destroyed=true; }
    }
    let episodeCalls=0;
    const window = {Hls,twPlayer:{episodes:async()=>{episodeCalls++;}},addEventListener(k,f){windowListeners[k]=f;}}, document = {getElementById: id=>elements[id],addEventListener(k,f){documentListeners[k]=f;}, body:{classList:{
        add(...names){names.forEach(n=>classes.add(n));},remove(...names){names.forEach(n=>classes.delete(n));},toggle(n,enabled){if(enabled)classes.add(n);else classes.delete(n);}}}};
    vm.runInNewContext(source,{window,document,Hls,Option:function(text,value){this.text=text;this.value=value;},setTimeout:fn=>{timers.add(fn);return fn;},clearTimeout:fn=>timers.delete(fn)});
    return {api:window.__twBuiltin,video,notice,levels,streams,listeners,timers,elements,classes,documentListeners,windowListeners,episodeCalls:()=>episodeCalls};
}

test('fullscreen pointer controls expire after focus, keyboard navigation remains usable',()=>{
    const t=setup();t.api.fullscreen(true,false);assert.ok(t.classes.has('show-controls'));
    t.documentListeners.pointerdown();t.documentListeners.focusin();
    [...t.timers].forEach(fn=>fn());assert.equal(t.classes.has('show-controls'),false);assert.equal(t.classes.has('keyboard-controls'),false);
    t.documentListeners.keydown({key:'Tab'});assert.ok(t.classes.has('keyboard-controls'));
    t.documentListeners.mousemove();assert.equal(t.classes.has('keyboard-controls'),false);
    t.windowListeners.blur();assert.equal(t.classes.has('show-controls'),false);
});

test('builtin episode control is available only for a selectable programme',async()=>{
    const t=setup();t.api.load({url:'https://example.com/a.mp4',kind:'mp4',episodes:true});
    assert.equal(t.elements.episodes.disabled,false);await t.elements.episodes.onclick();assert.equal(t.episodeCalls(),1);
    t.api.load({url:'https://example.com/b.mp4',kind:'mp4'});await t.elements.episodes.onclick();assert.equal(t.episodeCalls(),1);
});
test('loading a candidate preserves time without autoplay and releases previous media', () => {
    const t=setup(); t.api.load({url:'https://example.com/a.mp4',kind:'mp4',position:42});
    t.listeners.loadedmetadata(); assert.equal(t.video.currentTime,42); assert.equal(t.video.paused,true);
    t.video.readyState=4;t.listeners.canplay();assert.equal(t.timers.size,0);
    t.api.load({url:'https://example.com/a.m3u8',kind:'hls'});
    const stream=t.streams[0];t.api.load({url:'https://example.com/b.mp4',kind:'mp4'});assert.equal(stream.destroyed,true);
});
test('HLS uses anonymous requests and only lists actual available levels', () => {
    const t=setup();t.api.load({url:'https://example.com/a.m3u8',kind:'hls'});
    const stream=t.streams[0],xhr={withCredentials:true};stream.options.xhrSetup(xhr);
    assert.equal(xhr.withCredentials,false);assert.equal(stream.options.emeEnabled,false);
    stream.levels=[{height:720},{height:1080}];stream.events.manifest();
    assert.deepEqual(t.levels.options.map(o=>o.text),['自动','720p','1080p']);
    t.levels.value='1';t.levels.onchange();assert.equal(stream.currentLevel,1);
});
test('fatal 403 and DRM failures stay visible even if a late canplay event arrives', () => {
    const t=setup();t.api.load({url:'https://example.com/a.m3u8',kind:'hls'});
    t.streams[0].events.error(null,{fatal:true,response:{code:403}});
    assert.match(t.api.state().error,/拒绝/);t.listeners.canplay();assert.equal(t.notice.hidden,false);
    assert.equal(t.streams[0].stopped,true);assert.match(t.notice.textContent,/原网页/);
    t.api.load({url:'https://example.com/a.mp4',kind:'mp4'});t.listeners.encrypted();assert.match(t.api.state().error,/DRM/);
});
test('startup timeout is bounded and callbacks from an old source cannot fail the new source', () => {
    const t=setup();t.api.load({url:'https://example.com/a.m3u8',kind:'hls'});
    const old=t.streams[0];t.api.load({url:'https://example.com/b.mp4',kind:'mp4'});
    old.events.error(null,{fatal:true,response:{code:404}});assert.equal(t.api.state().error,'');
    [...t.timers][0]();assert.match(t.api.state().error,/20 秒/);assert.equal(t.video.paused,true);
});
