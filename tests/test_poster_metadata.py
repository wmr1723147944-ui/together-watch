import json
from pathlib import Path
import re
import unittest

import app as application
import catalog_sources
import source_search
from poster_policy import POSTER_DOMAINS, poster_url, poster_attributes


class PosterMetadataTests(unittest.TestCase):
    def test_233_background_anchor_and_srcset_metadata(self):
        url = 'https://as.cfhls.top//upload/vod/20260917-1/c0ca80c2e2db160264803b27e2415597.webp'
        body = f'<a href="/anime/48e80904f5e839e28d3d5f90.html" title="测试动漫" data-original="{url}">更新至3集</a>'
        status, rows = catalog_sources.search_rows('233dm', body, '测试')
        self.assertEqual(status, 'ok')
        self.assertEqual(rows[0]['poster_url'], url)
        self.assertEqual(poster_attributes({'style': f'background-image: url("{url}")'}, 'https://www.233dm.com'), url)
        self.assertEqual(poster_attributes({'srcset': f'{url} 1x, https://image.tmdb.org/b.jpg 2x'}, 'https://www.233dm.com'), url)
        for bad in (url.replace('as.cfhls.top', 'as.cfhls.top.evil.test'), url + '?url=http://localhost', url.replace('.webp', '.mp4')):
            self.assertIsNone(poster_url(bad, 'https://www.233dm.com'))
        csp = application.app.test_client().get('/discover').headers['Content-Security-Policy']
        self.assertIn('https://as.cfhls.top', csp.split('img-src ')[1].split(';')[0])
        self.assertNotIn('as.cfhls.top', csp.split('script-src ')[1].split(';')[0])
        self.assertNotIn('as.cfhls.top', csp.split('media-src ')[1].split(';')[0])

    def test_observed_pkavi_and_kanju_cover_formats(self):
        samples = json.loads((Path(__file__).with_name('poster-source-fixture.json')).read_text(encoding='utf8'))
        for value in samples.values():
            self.assertEqual(poster_url(value, 'https://www.kanju.ai'), value)
        value = samples['kanju']
        for bad in (value + '?token=secret', value + '#x', value.replace('https:', 'http:'),
                    value.replace('gimg0.baidu.com', 'gimg0.baidu.com.evil.test'),
                    value.replace('gimg0.baidu.com', 'sub.gimg0.baidu.com'),
                    value.replace('gimg0.baidu.com', 'user@gimg0.baidu.com'),
                    value.replace('img.baipiaozhe.com', '127.0.0.1'),
                    value.replace('img.baipiaozhe.com', 'evil.test'),
                    value.replace('img.baipiaozhe.com', 'img.baipiaozhe.com.evil.test'),
                    value.replace('.webp', '.mp4'), value.replace('/assets/images/', '/private/'),
                    value.replace('src=img.', 'src=https://img.'),
                    value.replace('src=img.', 'src=user@img.'),
                    value.replace('&n=0', '&n=0&url=http://localhost')):
            self.assertIsNone(poster_url(bad, 'https://www.kanju.ai'), bad)
        body = f'<a href="/mv/123.html"><img data-original="{samples["pkavi"]}" alt="测试"></a>'
        self.assertEqual(catalog_sources.search_rows('pkavi', body, '测试')[1][0]['poster_url'], samples['pkavi'])
        csp = application.app.test_client().get('/discover').headers['Content-Security-Policy']
        for host in ('i1.vvmp4.com', 'gimg0.baidu.com'):
            self.assertIn('https://' + host, csp.split('img-src ')[1].split(';')[0])
            for directive in ('script-src ', 'media-src ', 'connect-src '):
                self.assertNotIn(host, csp.split(directive)[1].split(';')[0])
        self.assertNotIn('https://*.gimg0.baidu.com', csp)

    def test_chinese_security_check_is_not_an_empty_catalog(self):
        html = '<title>请稍候…</title><p>正在进行安全验证。验证您不是自动程序。</p>'
        self.assertEqual(catalog_sources.search_rows('pkavi', html, '测试')[0], 'verification_required')
        self.assertEqual(catalog_sources.detail_rows('pkavi', '123', html)['status'], 'verification_required')
        self.assertFalse(catalog_sources.Metadata().challenge)

    def test_feed_covers_follow_the_same_policy_without_playback_claims(self):
        from catalog_recommendations import parse_page
        rows, _ = parse_page('ddys', 'all', 1, '''<article class="movie-card">
            <a href="/movie/test"><img src="https://img.ddys.io/movies/test.webp"></a>
            <h3>测试片目</h3><p>2022 · 电影</p></article>''')
        self.assertEqual(len(rows), 1)
        for row in rows:
            self.assertEqual(poster_url(row['poster_url'], 'https://watchtogethernow.cloud'), row['poster_url'])
            self.assertFalse(row['playback_verified'])
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
        self.assertIn('catalog-browser-light.css', page.text)

    def test_new_public_cover_cdns_are_image_only(self):
        csp = application.app.test_client().get('/discover').headers['Content-Security-Policy']
        hosts = ('www.lufys.com', 'img.ffzy888.com', 'www.mdzypic.com', 'img.lzipic.com',
                 'snzypic.vip', 'p.bfvp26.com', 'img.picbf.com', 'pps.vodfeiss.com', 'img.liangzipic.com')
        for host in hosts:
            url = 'https://' + host + '/upload/vod/a.webp'
            self.assertEqual(poster_url(url, 'https://www.fcma.cc'), url)
            self.assertIn('https://' + host, csp.split('img-src ')[1].split(';')[0])
            for directive in ('script-src ', 'media-src ', 'connect-src '):
                self.assertNotIn(host, csp.split(directive)[1].split(';')[0])
        body = '<div class="module-card-items"><div class="module-card-item"><a href="/v/9102/229"><img data-src="https://img.picbf.com/a.jpg"></a><div class="module-card-item-title"><a href="/v/9102/229">海贼王</a></div></div></div>'
        rows = source_search.parse_results(source_search.PROVIDERS['fcma'], body, '海贼王')
        self.assertEqual(rows[0]['poster_url'], 'https://img.picbf.com/a.jpg')


if __name__ == '__main__':
    unittest.main()
