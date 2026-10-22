import os
import unittest
from unittest.mock import patch
import app as application
import catalog_sources as adapters
import source_search as search
from room_program import normalize_program

ITEM='251f681f349a5832bcb61768'
CASES=[('233dm',ITEM,f'https://www.233dm.com/anime/{ITEM}.html',f'https://www.233dm.com/anime/{ITEM}/play/3/1.html'),
       ('pkavi','514960','https://www.pkavi.com/mv/514960.html','https://www.pkavi.com/py/514960-3-1.html')]

class CatalogAdaptersTests(unittest.TestCase):
    def setUp(self):
        search._cache.clear(); application.rate_buckets.clear()
        self.client=application.app.test_client()

    def test_search_and_detail_public_metadata_to_exact_invitation(self):
        for source,item,page,play in CASES:
            with self.subTest(source=source):
                body=f'<title>搜索</title><a href="{page}" title="测试动漫">封面</a><a href="{page}">测试动漫</a><a href="https://evil.test/mv/1.html">测试动漫</a>'
                with patch.object(search,'_fetch',return_value=body):
                    response=self.client.post('/api/discover/search',json=dict(source=source,q='测试'))
                self.assertEqual(response.status_code,200)
                self.assertEqual([r['page_url'] for r in response.json['results']],[page])
                body=f'<title>测试动漫</title><meta name="description" content="测试简介"><a href="{play}">立即播放</a><a href="{play}">第1集</a><a href="{play}?token=secret">不要</a><a href="magnet:?x">不要</a>'
                with patch.object(search,'_fetch_path',return_value=body):
                    response=self.client.post('/api/discover/detail',json=dict(source=source,page_url=page))
                result=response.json
                self.assertEqual(result['status'],'ok'); self.assertEqual(len(result['episodes']),1)
                ep=result['episodes'][0]
                self.assertEqual(ep['title'],'第1集'); self.assertEqual(ep['id'],'3-1')
                self.assertEqual(self.client.get(ep['launch_path']).status_code,200)
                selection=dict(source=source,item=item,episode=ep['id'])
                created=self.client.post('/api/watch-rooms',json=dict(selection=selection))
                self.assertEqual(created.status_code,201)
                invited=self.client.get('/api/watch-rooms/'+created.json['room']+'/program').json
                self.assertEqual(invited['program']['page'],play); self.assertTrue(invited['program']['exact_episode'])
                self.assertNotIn('owner',invited); self.assertNotIn('secret',str(invited))

    def test_real_challenge_is_distinct_from_empty_and_never_solved(self):
        for source,item,page,_ in CASES:
            challenge='<title>系统安全验证</title><input name="verify"><script>solve()</script>'
            with patch.object(search,'_fetch',return_value=challenge) as fetch:
                result=search.search_provider(source,'测试')
                self.assertEqual(result['status'],'verification_required'); self.assertEqual(result['results'],[])
                fetch.assert_called_once()
            with patch.object(search,'_fetch_path',return_value=challenge):
                self.assertEqual(search.load_detail(source,page)['status'],'verification_required')
            self.assertEqual(adapters.search_rows(source,'<p>没有找到</p>','测试'),('ok',[]))
            self.assertEqual(adapters.search_rows(source,'<title>新版未知布局</title>','测试'),('unavailable',[]))
            blocked='<title>Attention Required! | Cloudflare</title><h1>Sorry, you have been blocked</h1>'
            self.assertEqual(adapters.search_rows(source,blocked,'测试'),('access_blocked',[]))
            self.assertEqual(adapters.detail_rows(source,item,blocked)['status'],'access_blocked')
            search._cache.clear()
            with patch.object(search,'_fetch',return_value=blocked):
                self.assertEqual(search.search_provider(source,'测试')['status'],'access_blocked')

    def test_url_contract_disabled_sources_and_input_bounds(self):
        for source,item,page,play in CASES:
            self.assertEqual(search.selection_page(source,item,'3-1'),play)
            for bad in [page+'?token=x',page+'#hash',page.replace('https:','http:'),page.replace('https://','https://user@'),page.replace('.com','.com.evil.test')]:
                self.assertIsNone(search.detail_url(search.PROVIDERS[source],bad))
            for bad in ['0-1','1-0','-1-2','1-2?token=x','1/2','1-999999',None,[]]:
                self.assertIsNone(search.selection_path(source,item,bad))
            self.assertIsNone(normalize_program(dict(source=source,item=item,episode='1-1'),set()))
            with patch.dict(os.environ,{'DISCOVERY_DISABLED_SEARCH_SOURCES':source}):
                self.assertEqual(self.client.get(f'/discover/play/{source}/{item}/1-1').status_code,404)
                self.assertEqual(self.client.post('/api/discover/search',json=dict(source=source,q='测试')).status_code,400)

if __name__=='__main__': unittest.main()
