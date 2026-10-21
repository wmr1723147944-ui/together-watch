import json
from pathlib import Path
import re
import unittest

import app as application
import catalog_sources
import source_search
from poster_policy import POSTER_DOMAINS, poster_url


class PosterMetadataTests(unittest.TestCase):
    def test_recommendations_have_safe_real_catalogue_covers_but_no_playback_claims(self):
        from catalog_recommendations import recommendations
        rows = recommendations()
        self.assertGreaterEqual(len(rows), 8)
        self.assertEqual(len({row['title'] for row in rows}), len(rows))
        for row in rows:
            self.assertEqual(poster_url(row['poster'], 'https://watchtogethernow.cloud'), row['poster'])
            self.assertNotIn('play_url', row)
            self.assertNotIn('score', row)
            self.assertNotIn('media_url', row)

    def test_url_policy_and_frontend_domain_parity(self):
        base = 'https://img.ddys.io/movies/'
        self.assertEqual(poster_url('reset.webp', base), base + 'reset.webp')
        self.assertEqual(poster_url('//img1.doubanio.com/view/photo/s_ratio_poster/public/a.jpg', base),
                         'https://img1.doubanio.com/view/photo/s_ratio_poster/public/a.jpg')
        for value in ('http://img.ddys.io/a.webp', 'javascript:alert(1)', 'https://127.0.0.1/a.jpg',
                      'https://img.ddys.io.evil.test/a.jpg', 'https://evil.test/a.jpg',
                      'https://user@img.ddys.io/a.jpg', 'https://img.ddys.io:444/a.jpg',
                      'https://img.ddys.io/a.svg', 'https://img.ddys.io/a.mp4',
                      'https://img.ddys.io/a.jpg?token=secret', 'https://img.ddys.io/a.jpg#secret',
                      'https://img.ddys.io/a.jpg?url=https://private', 'https://img.ddys.io/loading.gif',
                      'https://img.ddys.io/a.jpg\n', None):
            self.assertIsNone(poster_url(value, base), value)
        js = (Path(__file__).parents[1] / 'static/js/catalog-adapters.js').read_text(encoding='utf8')
        domains = re.search(r'const posterDomains = \[(.*?)\];', js, re.S).group(1)
        self.assertEqual(set(re.findall(r"'([^']+)'", domains)), set(POSTER_DOMAINS))

    def test_html_lazy_images_stay_with_their_own_card(self):
        body = '''<div class="movie-list-body">
        <div class="movie-list-item"><a href="/vod-detail/1.html"><img src="/loading.gif" data-src="https://img1.doubanio.com/a.jpg"></a><div class="movie-title">测试甲</div></div>
        <div class="movie-list-item"><a href="/vod-detail/2.html">测试乙</a><div class="movie-title">测试乙</div></div></div>'''
        rows = source_search.parse_results(source_search.PROVIDERS['cupfox'], body, '测试')
        self.assertEqual(rows[0]['poster_url'], 'https://img1.doubanio.com/a.jpg')
        self.assertIsNone(rows[1]['poster_url'])

    def test_json_posters_and_thumbnail_paths(self):
        body = json.dumps({'success': True, 'data': [dict(title='开端', slug='reset', url='/movie/reset', poster='https://img.ddys.io/movies/reset.webp')]})
        self.assertEqual(source_search.parse_results(source_search.PROVIDERS['ddys'], body, '开端')[0]['poster_url'],
                         'https://img.ddys.io/movies/reset.webp')
        body = json.dumps({'data': [dict(name='Sintel', url='https://video.blender.org/videos/watch/0eb052d0-fd51-43e6-aa33-ecdbf77a5d40',
            channel=dict(name='blender_open_movies',host='video.blender.org'), thumbnailPath='/lazy-static/thumbnails/a.jpg')]})
        self.assertEqual(source_search.parse_results(source_search.PROVIDERS['blender'], body, 'Sintel')[0]['poster_url'],
                         'https://video.blender.org/lazy-static/thumbnails/a.jpg')

    def test_catalog_separate_poster_and_title_links(self):
        body = '<a href="/mv/12.html"><img data-original="https://image.tmdb.org/t/p/w500/a.jpg"></a><a href="/mv/12.html" title="测试">测试</a>'
        status, rows = catalog_sources.search_rows('pkavi', body, '测试')
        self.assertEqual(status, 'ok')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['poster_url'], 'https://image.tmdb.org/t/p/w500/a.jpg')

    def test_image_csp_does_not_relax_scripts_or_playback(self):
        page = application.app.test_client().get('/discover')
        csp = page.headers['Content-Security-Policy']
        self.assertIn('https://img.ddys.io', csp.split('img-src ')[1].split(';')[0])
        self.assertEqual(csp.split('script-src ')[1].split(';')[0], "'self'")
        self.assertNotIn('img.ddys.io', csp.split('media-src ')[1].split(';')[0])
        self.assertNotIn('img.ddys.io', csp.split('connect-src ')[1].split(';')[0])
        self.assertIn('catalog-cinema.css', page.text)


if __name__ == '__main__':
    unittest.main()
