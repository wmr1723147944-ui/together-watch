import os
import unittest
from unittest.mock import patch

import app as application
import source_search as search
from source_discovery import is_search_page


class AnimeSourcesTests(unittest.TestCase):
    def setUp(self):
        search._cache.clear()

    def test_sakura_search_scopes_cards_to_search_list(self):
        body = '''<div id="search_list"><div class="card py-2">
        <a href="./watch/20180062"><h6 class="age-anime-title">斗罗大陆</h6></a>
        <script>secret</script></div></div>
        <div class="card"><a href="/watch/999"><h6 class="age-anime-title">斗罗大陆推荐</h6></a></div>'''
        rows = search.parse_results(search.PROVIDERS['yhdmoe'], body, '斗罗大陆')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['page_url'], 'https://yhdmoe.com/watch/20180062')
        self.assertIsNone(rows[0]['year'])
        self.assertFalse(rows[0]['playback_verified'])

    def test_fengche_search_only_accepts_fixed_public_paths(self):
        body = '''<div class="module-card-items"><div class="module-card-item">
        <a href="/v/9102/229"><div class="module-item-note">更新至1180集</div></a>
        <div class="module-card-item-title"><a href="/v/9102/229"><strong>海贼王</strong></a></div>
        </div></div>'''
        rows = search.parse_results(search.PROVIDERS['fcma'], body, '海贼王')
        self.assertEqual(rows[0]['episode_label'], '更新至1180集')
        self.assertEqual(rows[0]['page_url'], 'https://www.fcma.cc/v/9102/229')
        with self.assertRaises(search.SearchFailure):
            search.parse_results(search.PROVIDERS['fcma'], '<h1>Access denied</h1>', '海贼王')
        with patch.object(search, '_fetch_path', return_value=body) as fetch:
            search.search_provider('fcma', '海贼王')
        self.assertTrue(fetch.call_args.args[1].startswith('/public/auto/search1.html?keyword='))

    def test_sakura_preserves_fractional_episodes_and_sorts(self):
        body = '''<a class="my-episode" href="#play_ep_EP12" play_ep="EP12">第12集</a>
        <a class="my-episode" href="#play_ep_EP10.5" play_ep="EP10.5">第10.5集</a>
        <a class="my-episode" href="#play_ep_EP1" play_ep="EP1"><span>第1集</span></a>
        <a class="my-episode" href="https://evil.test" play_ep="EP2">bad</a>'''
        with patch.object(search, '_fetch_path', return_value=body):
            result = search.load_detail('yhdmoe', 'https://yhdmoe.com/watch/123')
        self.assertEqual([e['id'] for e in result['episodes']], ['EP1', 'EP10.5', 'EP12'])
        self.assertEqual(search.selection_page('yhdmoe', '123', 'EP10.5'), 'https://yhdmoe.com/watch/123#play_ep_EP10.5')

    def test_fengche_keeps_lines_and_opaque_episode_ids_without_cross_title_links(self):
        body = '''<div class="module-list" id="panel1">
        <a class="module-play-list-link" href="/p/9102/229/1048459"><span>第01集</span></a>
        </div><div class="module-list" id="panel1">
        <a class="module-play-list-link" href="/p/9102/229/504"><span>第01集</span></a>
        <a class="module-play-list-link" href="/p/9102/999/88">wrong category</a>
        <a class="module-play-list-link" href="https://evil.test/p/9102/229/89">foreign</a>
        <a class="module-play-list-link" href="/p/123/229/90">other title</a>
        <a class="module-play-list-link" href="/p/9102/229/91?x=1">query</a></div>'''
        with patch.object(search, '_fetch_path', return_value=body):
            result = search.load_detail('fcma', 'https://www.fcma.cc/v/9102/229')
        self.assertEqual(result['item_id'], '9102-229')
        self.assertEqual([(e['id'], e['line']) for e in result['episodes']], [('1048459', '线路 1'), ('504', '线路 2')])
        self.assertEqual(search.selection_page('fcma', '9102-229', '1048459'), 'https://www.fcma.cc/p/9102/229/1048459')

    def test_long_series_have_explicit_limit_not_silent_300_episode_truncation(self):
        body = ''.join(f'<a class="my-episode" href="#play_ep_EP{i}" play_ep="EP{i}">第{i}集</a>' for i in range(1, 1201))
        with patch.object(search, '_fetch_path', return_value=body):
            result = search.load_detail('yhdmoe', 'https://yhdmoe.com/watch/456')
        self.assertEqual(len(result['episodes']), 1200)
        self.assertFalse(result['truncated'])
        with patch.object(search, 'MAX_EPISODES', 2), patch.object(search, '_fetch_path', return_value=body):
            result = search.load_detail('yhdmoe', 'https://yhdmoe.com/watch/457')
        self.assertEqual(len(result['episodes']), 2)
        self.assertTrue(result['truncated'])

    def test_malicious_urls_and_search_pages_are_not_playback(self):
        for source, path in [('yhdmoe', '/watch/123'), ('fcma', '/v/123/229')]:
            for bad in ['https://evil.test' + path, path + '?url=evil', path + '#x']:
                self.assertIsNone(search.detail_url(search.PROVIDERS[source], bad))
        for episode in ['EP1/evil', 'EP1?x', 'javascript:alert(1)', 'EP1#x']:
            self.assertIsNone(search.selection_path('yhdmoe', '123', episode))
        self.assertIsNone(search.selection_path('fcma', '123/229', '1'))
        self.assertTrue(is_search_page('https://yhdmoe.com/search?q=x'))
        self.assertTrue(is_search_page('https://www.fcma.cc/search/index.html?keyword=x'))

    def test_fengche_is_retired_from_all_public_entry_points(self):
        application.rate_buckets.clear()
        client = application.app.test_client()
        with patch.dict(os.environ, {'DISCOVERY_DISABLED_SEARCH_SOURCES': ''}), \
                patch.object(application, 'search_provider') as upstream_search, \
                patch.object(application, 'load_detail') as upstream_detail, \
                patch('catalog_recommendations.load_page') as upstream_feed:
            sources = {p['id'] for p in client.get('/api/discover/sources').json['sources']}
            self.assertNotIn('fcma', sources)
            self.assertNotIn('ddys', sources)
            self.assertTrue({'pkavi', 'kanju', 'cupfox', 'yhdmoe'} <= sources)
            for path in ('/', '/discover', '/room/test-retired-anime'):
                page = client.get(path)
                self.assertEqual(page.status_code, 200)
                self.assertNotIn('data-live-source="fcma"', page.text)
                self.assertNotIn('data-feed-source="fcma"', page.text)
                self.assertNotIn('风车动漫', page.text)
            response = client.post('/api/discover/search', json={'source': 'fcma', 'q': '测试'})
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json['error'], '该搜索来源未启用')
            self.assertEqual(client.post('/api/discover/detail', json={'source': 'fcma', 'page_url': 'https://www.fcma.cc/v/9102/229'}).status_code, 400)
            self.assertEqual(client.get('/api/discover/feed?source=fcma&category=all&page=1').status_code, 400)
            self.assertEqual(client.get('/discover/play/fcma/9102-229/1048459').status_code, 404)
            self.assertEqual(client.post('/api/watch-rooms', json={'selection': {'source': 'fcma', 'item': '9102-229', 'episode': '1048459'}}).status_code, 400)
            upstream_search.assert_not_called()
            upstream_detail.assert_not_called()
            upstream_feed.assert_not_called()


if __name__ == '__main__':
    unittest.main()
