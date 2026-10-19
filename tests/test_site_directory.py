import os
import unittest
from unittest.mock import patch
from urllib.parse import urlparse

import app as application
from site_directory import DIRECTORY, site_entries, site_entry
from source_search import PROVIDERS


class SiteDirectoryTests(unittest.TestCase):
    def setUp(self):
        self.client = application.app.test_client()

    def test_every_article_address_accounted_for_without_duplicate_lmm(self):
        self.assertEqual(len(DIRECTORY['sites']), 19)
        self.assertEqual(len(DIRECTORY['excluded']), 20)
        originals = [s.get('original_url', s['url']) for s in DIRECTORY['sites']] + [s['url'] for s in DIRECTORY['excluded']]
        self.assertEqual(len(set(originals)), 39)
        self.assertEqual(len({s['id'] for s in DIRECTORY['sites']}), 19)
        self.assertTrue(any('路漫漫 / 黑猫动漫' == s['name'] for s in DIRECTORY['excluded']))
        for site in site_entries():
            url = urlparse(site['url'])
            self.assertEqual(url.scheme, 'https')
            self.assertIsNone(url.username)
            self.assertIsNone(url.port)
            self.assertIn(url.hostname, site['hosts'])
            self.assertTrue(site['status_label'])
            self.assertEqual(site['status_scope'], 'review_snapshot')
            self.assertEqual(site['reviewed_at'], DIRECTORY['reviewed'])
            self.assertNotIn('media_url', site)
            self.assertNotIn('has_4k_evidence', site)
            self.assertTrue(site['note'])

    def test_homepage_directory_never_becomes_automatic_search_or_room_source(self):
        before = set(PROVIDERS)
        with patch.object(application.requests, 'get', side_effect=AssertionError('navigation must stay offline')):
            response = self.client.get('/api/discover/sites')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json['mode'], 'original_site_navigation')
            self.assertEqual(response.json['version'], '20261019-site-directory-r2')
            self.assertEqual(len(response.json['sites']), 19)
            html = self.client.get('/discover').text
        self.assertEqual(set(PROVIDERS), before)
        self.assertIn('未加入上方自动搜片', html)
        self.assertIn('能直接打开就直接使用，无需额外验证', html)
        self.assertIn('历史核对记录', html)
        self.assertIn('核对时遇到验证', html)
        self.assertIn('核对时受地区限制', html)
        self.assertNotIn('需原站验证', html)
        self.assertNotIn('验证由你完成', html)
        self.assertNotIn('data-live-source="aafun"', html)
        for key in ['aafun', 'noxx', '233dm']:
            self.assertIn(f'/discover/site/{key}', html)
        # Removed addresses have explanations, not clickable launch entries.
        self.assertIn('Libvio', html)
        self.assertNotIn('href="https://www.libvio.vip/', html)

    def test_narrow_handoffs_escape_and_do_not_redirect_or_proxy(self):
        for site in site_entries():
            response = self.client.get(site['launch_path'])
            self.assertEqual(response.status_code, 200)
            self.assertNotIn('Location', response.headers)
            self.assertEqual(response.headers['Referrer-Policy'], 'no-referrer')
            self.assertIn(site['url'], response.text)
            self.assertNotIn('<iframe', response.text)
            self.assertIn('rel="noopener noreferrer"', response.text)
        self.assertEqual(self.client.get('/discover/site/unknown').status_code, 404)
        self.assertEqual(self.client.get('/discover/site/libvio').status_code, 404)
        self.assertIsNone(site_entry('../admin'))

    def test_verification_record_is_not_an_access_gate(self):
        for key in ['aafun', 'noxx']:
            with self.subTest(site=key):
                site = site_entry(key)
                self.assertEqual(site['status'], 'verification')
                self.assertEqual(site['status_label'], '核对时遇到验证')
                response = self.client.get(site['launch_path'])
                self.assertEqual(response.status_code, 200)
                self.assertIn(f'href="{site["url"]}"', response.text)
                self.assertIn(DIRECTORY['reviewed'] + ' 核对记录', response.text)
                self.assertIn('本站不会因为历史标签而增加验证步骤', response.text)
                self.assertNotIn('<form', response.text)
                self.assertNotIn('disabled', response.text)

    def test_administrator_removal_applies_to_html_api_and_handoff(self):
        with patch.dict(os.environ, {'DISCOVERY_DISABLED_SOURCES': 'site-aafun,site-noxx'}):
            html = self.client.get('/discover').text
            self.assertNotIn('data-directory-site="aafun"', html)
            self.assertNotIn('data-directory-site="noxx"', html)
            entries = self.client.get('/api/discover/sites').json['sites']
            self.assertEqual(len(entries), 17)
            self.assertEqual(self.client.get('/discover/site/aafun').status_code, 404)
            self.assertEqual(self.client.get('/discover/site/233dm').status_code, 200)


if __name__ == '__main__':
    unittest.main()
