'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../src/site-directory.cjs');
const {SERVER, programSelection} = require('../src/policy.cjs');

test('directory shares reviewed metadata, excludes parked and dead sites', () => {
    assert.equal(d.sites.length, 19);
    for (const site of d.sites) {
        assert.equal(d.siteForUrl(site.url), site);
        assert.equal(d.siteHandoff(SERVER + '/discover/site/' + site.id, SERVER), site);
        assert.ok(d.siteNavigation(site, site.url));
        assert.equal(programSelection(site.url), null, 'portal must not create an invitation');
    }
    for (const id of ['libvio','crackle','myflixer','nunflix']) assert.equal(d.siteById(id), null);
    assert.equal(d.siteForUrl('https://www.cupfox.in/'), null, 'similarly named sites are not aliases');
});
test('first-party handoff rejects forged routes and caller-supplied targets', () => {
    const route = '/discover/site/aafun';
    for (const url of ['https://evil.test'+route, SERVER+route+'?url=https://evil.test',
        SERVER+'/discover/site/unknown', SERVER+route+'/extra', 'https://user@watchtogethernow.cloud'+route]) {
        assert.equal(d.siteHandoff(url,SERVER), null, url);
    }
});
test('verification is normal original-site browsing, not a wildcard trust grant', () => {
    const site = d.siteById('aafun');
    assert.ok(d.siteNavigation(site, 'https://www.aafun.cc/_guard/check?x=1'));
    for (const url of ['javascript:alert(1)','file:///C:/x','http://www.aafun.cc/',
        'https://user:pass@www.aafun.cc/','https://www.aafun.cc:8443/',
        'https://www.aafun.cc.evil.test/', 'https://evil.test/?next=https://www.aafun.cc/',
        'https://127.0.0.1/', 'https://aafun.cc/']) assert.equal(d.siteNavigation(site,url), false, url);
    const approved = new Set(['https://example.org']);
    assert.ok(d.siteNavigation(site, 'https://example.org/page', approved));
    assert.equal(d.siteNavigation(site,'https://example.org.evil.test/',approved), false);
    assert.equal(d.siteNavigation(site,'https://example.org/page'), false, 'approval is per-view only');
});
