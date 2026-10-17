import os
import unittest
from unittest.mock import patch
import app as application
import source_search as search


BODY = '''<title>测试片</title><meta name="description" content="简介 &lt;img&gt;">
<span class="play-btn" ep_slug="ep15">第15集</span>
<span class="play-btn" ep_slug="ep2">第02集</span>
<span class="play-btn" ep_slug="ep1">第01集</span>
<span class="play-btn" ep_slug="ep1">重复</span>
<span class="play-btn" ep_slug="javascript:alert(1)">恶意</span>
<script>secret_media_url='https://bad.test/movie.mp4'</script>'''


class DetailTests(unittest.TestCase):
    def setUp(self):
        search._cache.clear()
        application.rate_buckets.clear()
        self.client = application.app.test_client()

    def test_episode_order_no_duplicates_no_media_or_html(self):
        with patch.object(search, '_fetch_path', return_value=BODY) as fetch:
            result = search.load_detail('cupfox', 'https://www.cupfox.in/vod-detail/123.html')
            self.assertEqual(fetch.call_args.args, (search.PROVIDERS['cupfox'], '/vod-detail/123.html'))
            self.assertEqual([e['id'] for e in result['episodes']], ['ep1', 'ep2', 'ep15'])
            self.assertEqual(result['episodes'][0]['launch_path'], '/discover/play/cupfox/123/ep1')
            self.assertNotIn('secret_media_url', str(result))
            self.assertFalse(result['playback_verified'])
            result['episodes'].clear()
            self.assertEqual(len(search.load_detail('cupfox', result['page_url'])['episodes']), 3)
            self.assertEqual(fetch.call_count, 1)

    def test_only_same_item_public_episode_links_are_collected(self):
        body = '''<a href="/play/123-1">第1集</a><a href="/play/123-2">第2集</a>
        <a href="/play/456-1">其他推荐</a><a href="https://user@huarw.com/play/123-3">bad</a>
        <a href="https://evil.test/play/123-3">bad</a><a href="/play/123-3?redirect=evil">bad</a>'''
        with patch.object(search, '_fetch_path', return_value=body):
            result = search.load_detail('huarw', 'https://huarw.com/movie/123')
        self.assertEqual([e['id'] for e in result['episodes']], ['123-1', '123-2'])

    def test_detail_validation_disable_and_room_isolation(self):
        with patch.object(search, '_fetch_path', return_value=BODY), patch.dict(application.room_states, {}, clear=True):
            payload = {'source': 'cupfox', 'page_url': 'https://www.cupfox.in/vod-detail/123.html'}
            result = self.client.post('/api/discover/detail', json=payload)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.headers['Cache-Control'], 'no-store')
            self.assertEqual(application.room_states, {})
            self.assertEqual(self.client.post('/api/discover/detail', json=payload, headers={'Origin': 'https://evil.test'}).status_code, 403)
            for bad in ([], {**payload, 'cookie': 'private'}, {**payload, 'page_url': 'http://127.0.0.1'}, {**payload, 'source': []}):
                self.assertEqual(self.client.post('/api/discover/detail', json=bad).status_code, 400)
            with patch.dict(os.environ, {'DISCOVERY_DISABLED_SEARCH_SOURCES': 'cupfox'}):
                self.assertEqual(self.client.post('/api/discover/detail', json=payload).status_code, 400)
                self.assertEqual(self.client.get('/discover/play/cupfox/123/ep1').status_code, 404)

    def test_missing_episodes_and_network_errors_are_not_fake_playable_results(self):
        for body, expected in [('<h1>请登录</h1>', 'no_episodes')]:
            with patch.object(search, '_fetch_path', return_value=body):
                self.assertEqual(search.load_detail('cupfox', 'https://www.cupfox.in/vod-detail/124.html')['status'], expected)
        with patch.object(search, '_fetch_path', side_effect=OSError('private_error')):
            result = search.load_detail('cupfox', 'https://www.cupfox.in/vod-detail/125.html')
        self.assertEqual(result['status'], 'unavailable')
        self.assertEqual(result['episodes'], [])
        self.assertNotIn('private_error', str(result))

    def test_browser_launch_fallback_is_explicit_not_an_iframe_or_redirect(self):
        result = self.client.get('/discover/play/cupfox/123/ep1')
        self.assertEqual(result.status_code, 200)
        self.assertIn('Windows 0.2', result.text)
        self.assertNotIn('<iframe', result.text)
        self.assertNotIn('Location', result.headers)
        self.assertEqual(self.client.get('/discover/play/cupfox/123/garbage').status_code, 404)
        self.assertIsNone(search.selection_page('huarw', '123', '456-1'))
        self.assertIsNone(search.selection_page('cupfox', '123', 'ep1?url=evil'))


if __name__ == '__main__':
    unittest.main()
