import os
import time
import unittest
from unittest.mock import patch

import app as application
import source_search as search


class RetiredHuarwTests(unittest.TestCase):
    def setUp(self):
        application.rate_buckets.clear()
        self.client = application.app.test_client()

    def test_source_removed_from_current_pages_and_api(self):
        with patch.dict(os.environ, {'DISCOVERY_DISABLED_SEARCH_SOURCES': '', 'DISCOVERY_SEARCH_ENABLED': '1'}):
            result = self.client.get('/api/discover/sources')
            self.assertEqual(result.json['version'], '20261029-retire-huarw')
            ids = {source['id'] for source in result.json['sources']}
            self.assertNotIn('huarw', ids)
            self.assertTrue({'kanju', '233dm', 'pkavi', 'cupfox', 'yhdmoe', 'blender'} <= ids)
            for url in ('/', '/discover', '/discover?picker=1', '/room/retired-huarw'):
                html = self.client.get(url).text
                self.assertNotIn('data-live-source="huarw"', html)
                self.assertNotIn('data-feed-source="huarw"', html)
                self.assertNotIn('华人影院', html)
                self.assertNotIn('href="https://huarw.com', html)
            for url in ('/', '/discover'):
                html = self.client.get(url).text
                enabled = html.split('data-enabled-sources="', 1)[1].split('"', 1)[0].split(',')
                self.assertEqual(set(enabled), ids)
                self.assertIn('watch-history.js?v=20261029-retire-huarw', html)

    def test_stale_links_cannot_fetch_search_detail_feed_or_create_rooms(self):
        selection = {'source': 'huarw', 'item': '123', 'episode': '123-1'}
        with patch.object(application, 'search_provider', side_effect=AssertionError('retired search called')), \
                patch.object(application, 'load_detail', side_effect=AssertionError('retired detail called')), \
                patch.object(search, '_fetch_path', side_effect=AssertionError('upstream request')), \
                patch.dict(application.room_programs, {}, clear=True):
            self.assertEqual(self.client.post('/api/discover/search', json={'source': 'huarw', 'q': '测试'}).status_code, 400)
            self.assertEqual(self.client.post('/api/discover/detail', json={'source': 'huarw', 'page_url': 'https://huarw.com/movie/123'}).status_code, 400)
            self.assertEqual(self.client.get('/api/discover/feed?source=huarw&category=all&page=1').status_code, 400)
            self.assertEqual(self.client.get('/discover/play/huarw/123/123-1').status_code, 404)
            self.assertEqual(self.client.get('/discover/site/huarw').status_code, 404)
            self.assertEqual(self.client.post('/api/watch-rooms', json={'selection': selection}).status_code, 400)
            self.assertEqual(application.room_programs, {})
            # Other sources still create rooms; an old native history link must
            # not switch that room back to the withdrawn source.
            active = self.client.post('/api/watch-rooms', json={'selection': {'source': 'cupfox', 'item': '123', 'episode': 'ep1'}})
            self.assertEqual(active.status_code, 201)
            room = active.json
            url = '/api/watch-rooms/' + room['room'] + '/program'
            self.assertEqual(self.client.put(url, json={'selection': selection}, headers={'Authorization': 'Bearer ' + room['owner']}).status_code, 400)
            self.assertEqual(self.client.get(url).json['program']['source'], 'cupfox')
            self.assertEqual(self.client.get(url).json['revision'], 1)

    def test_old_identity_and_room_records_are_not_deleted_or_retargeted(self):
        page = search.selection_page('huarw', '123', '123-1')
        self.assertEqual(page, 'https://huarw.com/play/123-1')
        room = 'a' * 24
        program = dict(source='huarw', item='123', episode='123-1', page=page, exact_episode=True)
        with patch.dict(application.room_programs, {room: {'owner': 'old-owner', 'program': program, 'revision': 2}}, clear=True), \
                patch.dict(application.room_activity, {room: time.time()}, clear=True):
            result = self.client.get('/api/watch-rooms/' + room + '/program')
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json, {'program': program, 'revision': 2})


if __name__ == '__main__':
    unittest.main()
