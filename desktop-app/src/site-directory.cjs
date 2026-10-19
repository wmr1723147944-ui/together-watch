'use strict';
const fs = require('node:fs');
const path = require('node:path');
// One source of truth for server + desktop. Packaging copies the reviewed data.
const source = path.resolve(__dirname, '../../static/data/site-directory.json');
const catalog = JSON.parse(fs.readFileSync(fs.existsSync(source) ? source : path.join(__dirname, '../ui/site-directory.json'), 'utf8'));
const sites = catalog.sites;
function siteById(id) { return sites.find(site => site.id === id) || null; }
function siteForUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port
            ? sites.find(site => site.hosts.includes(url.hostname)) || null : null;
    } catch { return null; }
}
function siteHandoff(value, server) {
    try {
        const url = new URL(value);
        if (url.origin !== server || url.username || url.password || url.search) return null;
        const match = /^\/discover\/site\/([a-z0-9-]+)$/.exec(url.pathname);
        return match ? siteById(match[1]) : null;
    } catch { return null; }
}
function siteNavigation(site, value, approved = new Set()) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port
            && (site.hosts.includes(url.hostname) || approved.has(url.origin));
    } catch { return false; }
}
module.exports = {catalog, sites, siteById, siteForUrl, siteHandoff, siteNavigation};
