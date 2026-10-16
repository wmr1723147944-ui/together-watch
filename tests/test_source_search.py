import json
import os
import socket
import threading
import unittest
from unittest.mock import MagicMock, patch

import app as application
import source_search as search


CUPFOX = '''<div class="movie-list-body">
<div class="movie-list-item"><a href="/vod-detail/202236115.html"><img src="x"></a>
<a href="/vod-detail/202236115.html"><div class="movie-title">开端</div></a></div>
<div class="movie-list-item"><a href="/vod-detail/202555935.html"><div class="movie-title">开端</div></a></div>
<div class="movie-list-item"><a href="/vod-detail/123.html"><div class="movie-title">其他推荐</div></a></div>
</div>'''
HUARW = '''<div class="public-list-box search-box flex">
<a href="/movie/85334"><img src="x"><span class="public-list-prb">全15集</span></a>
<div><h3><a href="/movie/85334">开端</a></h3>
<a href="/search/year/2022">2022</a><a href="/movie/85334">播放正片</a></div></div>'''
UUID = "0eb052d0-fd51-43e6-aa33-ecdbf77a5d40"


class SearchTests(unittest.TestCase):
    def setUp(self):
        search._cache.clear()
        search._inflight.clear()
        application.rate_buckets.clear()
        self.client = application.app.test_client()

    def test_html_parses_titles_year_and_episodes_without_recommendations_or_merging_versions(self):
        rows = search.parse_results(search.PROVIDERS["cupfox"], CUPFOX, "开端")
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]["page_url"], rows[1]["page_url"])
        self.assertIsNone(rows[0]["year"])  # Do not infer year from URL digits.
        rows = search.parse_results(search.PROVIDERS["huarw"], HUARW, "开端")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["year"], "2022")
        self.assertEqual(rows[0]["episode_label"], "全15集")
        self.assertEqual(rows[0]["title"], "开端")
        for key in ("playback_verified", "synchronization_verified"):
            self.assertFalse(rows[0][key])
        self.assertNotIn("media_url", rows[0])

    def test_untrusted_results_cannot_supply_arbitrary_urls(self):
        p = search.PROVIDERS["cupfox"]
        for url in ("javascript:alert(1)", "//evil.test/vod-detail/1.html", "https://www.cupfox.in.evil.test/vod-detail/1.html",
                    "https://user@www.cupfox.in/vod-detail/1.html", "https://www.cupfox.in:8443/vod-detail/1.html",
                    "/vod-detail/1.html?redirect=http://127.0.0.1", "/vod-detail/1.html#x", "/vod-play/1.html", "\\\\evil.test/x"):
            self.assertIsNone(search.detail_url(p, url), url)
        self.assertEqual(search.detail_url(p, "/vod-detail/1.html"), "https://www.cupfox.in/vod-detail/1.html")
        malicious = CUPFOX.replace('/vod-detail/202236115.html', 'https://evil.test/vod-detail/1.html')
        self.assertEqual(len(search.parse_results(p, malicious, "开端")), 1)

    def test_empty_is_not_the_same_as_changed_layout_or_captcha(self):
        self.assertEqual(search.parse_results(search.PROVIDERS["cupfox"], '<div class="movie-list-body"></div>', 'x'), [])
        self.assertEqual(search.parse_results(search.PROVIDERS["huarw"], '<p>没有找到结果</p>', 'x'), [])
        for body in ('<h1>请登录 / 验证码</h1>', '<div class="movie-list-body"><div class="movie-list-item">new layout</div></div>'):
            with self.assertRaises(search.SearchFailure):
                search.parse_results(search.PROVIDERS["cupfox"], body, 'x')

    def test_blender_filters_foreign_channels_and_trailers_and_maps_alias(self):
        row = {"name": "Sintel", "url": "https://video.blender.org/videos/watch/" + UUID, "duration": 888,
               "channel": {"name": "blender_open_movies", "host": "video.blender.org"}}
        body = json.dumps({"data": [row, {**row, "name": "Making Of Sintel"}, {**row, "name": "SINGULARITY"},
                                    {**row, "channel": {"name": "blender_open_movies", "host": "evil.test"}},
                                    {**row, "url": "https://evil.test/"}, None]})
        with patch.object(search, "_fetch", return_value=body) as fetch:
            result = search.search_provider('blender', '辛特尔')
            self.assertEqual(fetch.call_args.args[1], 'Sintel')
        self.assertEqual(result['results'][0]['duration_seconds'], 888)
        self.assertEqual(len(result['results']), 1)

    def test_cache_and_failure_expiry_are_bounded_and_return_copies(self):
        with patch.object(search, '_fetch', return_value=CUPFOX) as fetch:
            first = search.search_provider('cupfox', '开端')
            first['results'].clear()
            second = search.search_provider('cupfox', '开端')
            self.assertTrue(second['cached'])
            self.assertEqual(len(second['results']), 2)
            self.assertEqual(fetch.call_count, 1)
            with patch.object(search.time, 'monotonic', return_value=10**12):
                search.search_provider('cupfox', '开端')
            self.assertEqual(fetch.call_count, 2)
        search._cache.clear()
        with patch.object(search, '_fetch', side_effect=OSError('secret internal error')) as fetch:
            first = search.search_provider('huarw', 'x')
            self.assertEqual(first['status'], 'unavailable')
            self.assertNotIn('secret', json.dumps(first))
            self.assertTrue(search.search_provider('huarw', 'x')['cached'])
            self.assertEqual(fetch.call_count, 1)
        search._cache.clear()
        with patch.object(search, '_fetch', return_value='<p>没有找到</p>'), patch.object(search, 'MAX_CACHE_KEYS', 2):
            for query in ('a', 'b', 'c'):
                search.search_provider('huarw', query)
        self.assertEqual(len(search._cache), 2)

    def test_concurrent_duplicate_and_capacity_fail_fast_then_release(self):
        started, resume = threading.Event(), threading.Event()
        def fetch(*_):
            started.set()
            resume.wait(2)
            return CUPFOX
        with patch.object(search, '_fetch', side_effect=fetch), patch.object(search, '_slots', threading.BoundedSemaphore(1)):
            worker = threading.Thread(target=search.search_provider, args=('cupfox', '开端'))
            worker.start()
            self.assertTrue(started.wait(1))
            try:
                self.assertEqual(search.search_provider('cupfox', '开端')['status'], 'busy')
                self.assertEqual(search.search_provider('huarw', '其他')['status'], 'busy')
            finally:
                resume.set()
                worker.join(3)
            self.assertFalse(worker.is_alive())
            self.assertFalse(search._inflight)
            self.assertTrue(search._slots.acquire(blocking=False))
            search._slots.release()

    def test_fetch_pins_public_address_preserves_tls_and_does_not_forward_cookies(self):
        dns = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('1.1.1.1', 443))]
        pool, response = MagicMock(), MagicMock()
        pool.urlopen.return_value = response
        response.status = 200
        response.headers = {'Content-Type': 'text/html'}
        response.read1.side_effect = [CUPFOX.encode(), b'']
        with patch.object(search.socket, 'getaddrinfo', return_value=dns) as resolve, patch.object(search.urllib3, 'HTTPSConnectionPool', return_value=pool) as constructor:
            self.assertIn('开端', search._fetch(search.PROVIDERS['cupfox'], '开端&url=http://127.0.0.1'))
        self.assertEqual(resolve.call_count, 1)
        self.assertEqual(constructor.call_args.args[0], '1.1.1.1')
        self.assertEqual(constructor.call_args.kwargs['assert_hostname'], 'www.cupfox.in')
        self.assertEqual(constructor.call_args.kwargs['server_hostname'], 'www.cupfox.in')
        self.assertEqual(constructor.call_args.kwargs['cert_reqs'], 'CERT_REQUIRED')
        opts = pool.urlopen.call_args.kwargs
        self.assertFalse(opts['redirect'])
        self.assertFalse(opts['retries'])
        self.assertEqual(set(opts['headers']), {'Host', 'User-Agent', 'Accept', 'Accept-Encoding'})
        self.assertIn('%26url%3D', pool.urlopen.call_args.args[1])
        response.close.assert_called_once()
        pool.close.assert_called_once()

    def test_fetch_blocks_private_dns_redirects_large_and_non_metadata_responses(self):
        for ip in ('127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '198.18.0.1'):
            with patch.object(search.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', (ip, 443))]), patch.object(search.urllib3, 'HTTPSConnectionPool') as pool:
                with self.assertRaises(search.SearchFailure):
                    search._fetch(search.PROVIDERS['cupfox'], 'x')
                pool.assert_not_called()
        for status, headers in ((302, {'Location': 'http://127.0.0.1'}), (200, {'Content-Type': 'video/mp4'}),
                                (200, {'Content-Type': 'text/html', 'Content-Length': str(search.MAX_BYTES + 1)}),
                                (200, {'Content-Type': 'text/html', 'Content-Encoding': 'gzip'})):
            pool, response = MagicMock(), MagicMock()
            response.status, response.headers = status, headers
            pool.urlopen.return_value = response
            with patch.object(search.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('1.1.1.1', 443))]), patch.object(search.urllib3, 'HTTPSConnectionPool', return_value=pool):
                with self.assertRaises(search.SearchFailure):
                    search._fetch(search.PROVIDERS['cupfox'], 'x')
            response.read1.assert_not_called()
            response.close.assert_called_once()

    def test_routes_validate_selection_and_do_not_change_playback_or_forward_user_data(self):
        before_media, before_pages = application.AUTHORIZED_MEDIA_HOSTS, application.AUTHORIZED_PAGE_HOSTS
        with patch.object(search, '_fetch', return_value=CUPFOX) as fetch, patch.dict(application.room_states, {}, clear=True):
            result = self.client.post('/api/discover/search', json={'source': 'cupfox', 'q': '开端'}, headers={'Cookie': 'secret=secret'})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(len(result.json['results']), 2)
            self.assertEqual(result.headers['Cache-Control'], 'no-store')
            self.assertEqual(fetch.call_args.args, (search.PROVIDERS['cupfox'], '开端'))
            self.assertEqual(application.room_states, {})
            self.assertEqual(application.AUTHORIZED_MEDIA_HOSTS, before_media)
            self.assertEqual(application.AUTHORIZED_PAGE_HOSTS, before_pages)
        for payload in ([], {'source': 'http://localhost', 'q': 'x'}, {'source': 'cupfox', 'q': []},
                        {'source': 'cupfox', 'q': '\0'}, {'source': 'cupfox', 'q': 'x'*301},
                        {'source': 'cupfox', 'q': 'x', 'room_id': 'secret'}):
            self.assertEqual(self.client.post('/api/discover/search', json=payload).status_code, 400)
        self.assertEqual(self.client.get('/api/discover/search?q=x').status_code, 405)
        self.assertEqual(self.client.post('/api/discover/search', json={'source':'cupfox', 'q':'x'}, headers={'Origin': 'https://evil.test'}).status_code, 403)

    def test_admin_disable_also_blocks_cached_results_and_rate_limit(self):
        with patch.dict(os.environ, {'DISCOVERY_DISABLED_SEARCH_SOURCES': 'cupfox,huarw'}):
            self.assertEqual([s['id'] for s in self.client.get('/api/discover/sources').json['sources']], ['blender'])
            self.assertEqual(self.client.post('/api/discover/search', json={'source':'cupfox', 'q':'x'}).status_code, 400)
            self.assertNotIn('data-live-source="cupfox"', self.client.get('/discover').text)
        with patch.dict(os.environ, {'DISCOVERY_SEARCH_ENABLED': '0'}):
            self.assertEqual(self.client.get('/api/discover/sources').json['sources'], [])
            self.assertEqual(self.client.post('/api/discover/search', json={'source':'blender', 'q':'x'}).status_code, 400)
        application.rate_buckets.clear()
        with patch.object(application, 'search_provider', return_value={'status': 'ok', 'results': []}):
            for _ in range(60):
                self.assertEqual(self.client.post('/api/discover/search', json={'source':'blender', 'q':'x'}).status_code, 200)
            self.assertEqual(self.client.post('/api/discover/search', json={'source':'blender', 'q':'x'}).status_code, 429)

    def test_search_landing_pages_remain_non_playable(self):
        from source_discovery import is_search_page
        self.assertTrue(is_search_page('https://huarw.com/search?wd=x'))
        self.assertTrue(is_search_page('https://www.cupfox.in/search?q=x'))
        self.assertFalse(is_search_page('https://huarw.com/movie/85334'))

    def test_stream_size_and_deadline_limits_close_connection(self):
        for chunks, clock in (([b'x' * 5], [0, 0]), ([b'x'], [0, 10])):
            pool, response = MagicMock(), MagicMock()
            pool.urlopen.return_value = response
            response.status, response.headers = 200, {'Content-Type': 'text/html'}
            response.read1.side_effect = chunks
            with patch.object(search.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('1.1.1.1', 443))]), \
                    patch.object(search.urllib3, 'HTTPSConnectionPool', return_value=pool), \
                    patch.object(search, 'MAX_BYTES', 4), patch.object(search.time, 'monotonic', side_effect=clock):
                with self.assertRaises(search.SearchFailure):
                    search._fetch(search.PROVIDERS['cupfox'], 'x')
            response.close.assert_called_once()
            pool.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
