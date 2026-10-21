import unittest
from unittest.mock import patch

import app as application
import catalog_recommendations as feed
import source_search as search


def card(slug='first', title='测试片目', year='2022', poster='https://img.ddys.io/movies/first.webp'):
    return f'''<article class="movie-card"><a href="/movie/{slug}"><img src="{poster}"></a>
        <div><h3><a href="/movie/{slug}">{title}</a></h3><p>{year} · 电影</p></div></article>'''


class CatalogFeedTests(unittest.TestCase):
    def setUp(self):
        feed._cache.clear()
        feed._inflight.clear()
        application.rate_buckets.clear()
        self.client = application.app.test_client()

    def test_paths_are_code_owned_and_pagination_bounded(self):
        self.assertEqual(feed.page_path('ddys', 'all', 2), '/page/2')
        self.assertEqual(feed.page_path('ddys', 'series', 3), '/series/page/3')
        self.assertIn('sort=hot&page=2', feed.page_path('yhdmoe', 'animation', 2))
        self.assertEqual(feed.page_path('cupfox', 'movie', 1), '/type/movie/')
        for args in [('ddys', 'all', True), ('ddys', 'all', 0), ('ddys', 'all', 1001),
                     ('ddys', '../', 1), ('cupfox', 'all', 2), ('yhdmoe', 'movie', 1),
                     ('https://localhost', 'all', 1)]:
            with self.assertRaises(ValueError, msg=args):
                feed.page_path(*args)

    def test_ddys_cards_keep_titles_years_posters_and_valid_next_page(self):
        body = card() + card('second', '另一部', '2025', 'https://evil.test/a.jpg') + card()
        rows, more = feed.parse_page('ddys', 'all', 1, body + '<a href="/page/2">下一页</a>')
        self.assertEqual(len(rows), 2)
        self.assertEqual([(r['title'], r['year'], r['genre']) for r in rows], [('测试片目', '2022', '电影'), ('另一部', '2025', '电影')])
        self.assertIsNone(rows[1]['poster_url'])
        self.assertTrue(more)
        for bad in ['https://evil.test/page/2', '/movie/page/2', '/page/3', '/page/2?url=http://localhost', 'http://ddys.io/page/2']:
            self.assertFalse(feed.parse_page('ddys', 'all', 1, body + f'<a href="{bad}">Next</a>')[1], bad)

    def test_cupfox_does_not_infer_years_from_ids_or_invent_pagination(self):
        body = '''<div class="movie-list-body"><div class="movie-list-item">
          <a href="/vod-detail/20221234.html"><img src="/loading.gif" data-src="/simg/20221234.jpg"></a>
          <a href="/vod-detail/20221234.html"><div class="movie-title">片目乙</div></a></div></div>
          <a href="/page/2">下一页</a>'''
        rows, more = feed.parse_page('cupfox', 'all', 1, body)
        self.assertEqual(rows[0]['title'], '片目乙')
        self.assertIsNone(rows[0]['year'])
        self.assertEqual(rows[0]['poster_url'], 'https://www.cupfox.in/simg/20221234.jpg')
        self.assertFalse(more)

    def test_yhdmoe_images_outside_anchor_and_unreleased_entries(self):
        body = '''<div id="catalog_list"><div class="card"><img src="/static/img/poster_s/123.jpg">
          <h6 class="age-anime-title"><a href="./watch/123">动画甲</a></h6>
          <div><span>年份</span><span>2024</span><span>播放状态</span><span>完结</span></div></div>
          <div class="card"><h6><a href="./watch/456">未上映</a></h6><span>播放状态</span><span>未播放</span></div></div>'''
        rows, more = feed.parse_page('yhdmoe', 'animation', 1, body + '<a href="' + feed.page_path('yhdmoe', 'animation', 2) + '">Next</a>')
        self.assertTrue(more)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['year'], '2024')
        self.assertEqual(rows[0]['poster_url'], 'https://yhdmoe.com/static/img/poster_s/123.jpg')

    def test_empty_challenge_and_changed_layout_are_distinct(self):
        self.assertEqual(feed.parse_page('cupfox', 'all', 1, '<div class="movie-list-body"></div>'), ([], False))
        for body in ['<title>Security Check</title><div class="movie-list-body"></div>',
                     '<html>Unknown markup</html>', '<div class="movie-card">No title</div>']:
            with self.assertRaises(search.SearchFailure):
                feed.parse_page('ddys', 'all', 1, body)
        body = '<script>' + card('fake') + '</script><template>' + card('template') + '</template>' + card()
        rows, _ = feed.parse_page('ddys', 'all', 1, body)
        self.assertEqual(len(rows), 1)
        with self.assertRaises(search.SearchFailure):
            feed.parse_page('ddys', 'all', 1, ''.join(card('movie-' + str(i)) for i in range(61)))

    def test_cache_copy_expiry_failures_and_slots(self):
        with patch.object(search, '_fetch_path', return_value=card()) as fetch:
            first = feed.load_page('ddys', 'all', 1)
            self.assertEqual(first['status'], 'ok')
            first['results'].clear()
            second = feed.load_page('ddys', 'all', 1)
            self.assertTrue(second['cached'])
            self.assertEqual(len(second['results']), 1)
            self.assertEqual(fetch.call_count, 1)
            self.assertFalse(fetch.call_args.kwargs['expect_json'])
            with patch.object(feed.time, 'monotonic', return_value=10**12):
                feed.load_page('ddys', 'all', 1)
            self.assertEqual(fetch.call_count, 2)
        feed._cache.clear()
        with patch.object(search, '_fetch_path', side_effect=OSError('internal secret')) as fetch:
            result = feed.load_page('ddys', 'all', 2)
            self.assertEqual(result['status'], 'unavailable')
            self.assertNotIn('secret', str(result))
            self.assertTrue(feed.load_page('ddys', 'all', 2)['cached'])
            self.assertEqual(fetch.call_count, 1)
        self.assertFalse(feed._inflight)
        self.assertTrue(search._slots.acquire(blocking=False))
        search._slots.release()

    def test_busy_does_not_fetch_or_cache_a_fake_empty_page(self):
        feed._inflight.add(('ddys', 'all', 1))
        with patch.object(search, '_fetch_path') as fetch:
            self.assertEqual(feed.load_page('ddys', 'all', 1)['status'], 'busy')
            fetch.assert_not_called()
            self.assertFalse(feed._cache)

    def test_api_validates_allowlist_origin_and_all_parameters_before_network(self):
        valid = '/api/discover/feed?source=ddys&category=all&page=1'
        with patch.object(feed, 'load_page', return_value={'status': 'ok', 'results': []}) as load:
            response = self.client.get(valid)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            load.assert_called_once_with('ddys', 'all', 1)
            load.reset_mock()
            for url in [valid + '&page=2', valid + '&url=https://evil.test', valid.replace('page=1', 'page=1001'),
                        valid.replace('page=1', 'page=-1'), valid.replace('ddys', 'kanju'),
                        valid.replace('category=all', 'category=unknown')]:
                self.assertEqual(self.client.get(url).status_code, 400, url)
            for headers in [{'Origin': 'https://evil.test'}, {'Sec-Fetch-Site': 'cross-site'}]:
                self.assertEqual(self.client.get(valid, headers=headers).status_code, 403)
            with patch.object(application, 'enabled_search_sources', return_value=[]):
                self.assertEqual(self.client.get(valid).status_code, 400)
            load.assert_not_called()

    def test_home_is_rendered_without_requesting_remote_catalogues(self):
        with patch.object(search, '_fetch_path', side_effect=AssertionError('offline render')):
            for path in ['/', '/discover']:
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertIn('id="catalogFeedMore"', response.text)
                self.assertIn('data-feed-source="ddys"', response.text)


if __name__ == '__main__':
    unittest.main()
