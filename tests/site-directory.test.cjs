const test = require('node:test');
const assert = require('node:assert/strict');
const {initSiteDirectory} = require('../static/js/source-discovery.js');
function setup() {
    const elements = new Map();
    for (const id of ['recommendedSites','siteDirectoryQuery','siteDirectoryCategory','siteDirectoryStatus',
        'siteDirectoryCount','siteDirectoryEmpty','discoveryCopyFallback','discoveryCopyValue']) {
        elements.set(id, {value:id.endsWith('Category') || id.endsWith('Status') ? 'all' : '', hidden:true,
            listeners:{}, addEventListener(name,fn) {this.listeners[name]=fn;}, focus(){}, select(){this.selected=true;}});
    }
    const cards = [
        {dataset:{directoryText:'风铃动漫 www.aafun.cc',directoryCategory:'动漫',directoryStatus:'verification'}},
        {dataset:{directoryText:'Plex watch.plex.tv',directoryCategory:'海外',directoryStatus:'entry'}},
    ];
    const copy = {dataset:{siteCopy:'https://www.aafun.cc/'},listeners:{},addEventListener(n,f){this.listeners[n]=f;}};
    elements.get('recommendedSites').querySelectorAll = s => s === '[data-directory-site]' ? cards : [copy];
    initSiteDirectory({getElementById:id=>elements.get(id)});
    return {elements,cards,copy};
}
test('site filters are separate from film search, combine name/category/status and show empty state', () => {
    const {elements,cards} = setup();
    const query = elements.get('siteDirectoryQuery'), category = elements.get('siteDirectoryCategory'), status = elements.get('siteDirectoryStatus');
    assert.ok(cards.every(c=>!c.hidden));
    query.value='ｐｌｅｘ'; query.listeners.input();
    assert.deepEqual(cards.map(c=>c.hidden),[true,false]);
    category.value='动漫'; category.listeners.change();
    assert.ok(cards.every(c=>c.hidden));
    assert.equal(elements.get('siteDirectoryEmpty').hidden,false);
    query.value=''; query.listeners.input(); status.value='verification'; status.listeners.change();
    assert.deepEqual(cards.map(c=>c.hidden),[false,true]);
    assert.match(elements.get('siteDirectoryCount').textContent,/1 \/ 2/);
});
test('manual site URL copy fallback is available if clipboard permission fails', async () => {
    const {elements,copy} = setup();
    assert.equal(copy.hidden,false);
    await copy.listeners.click();
    assert.equal(elements.get('discoveryCopyFallback').hidden,false);
    assert.equal(elements.get('discoveryCopyValue').value,'https://www.aafun.cc/');
    assert.equal(elements.get('discoveryCopyValue').selected,true);
});
