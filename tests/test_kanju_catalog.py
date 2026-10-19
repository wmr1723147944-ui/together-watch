import os
import unittest
from unittest.mock import patch

import app as application
import source_search as search
from room_program import normalize_program


class KanjuCatalogTests(unittest.TestCase):
    def setUp(self):
        self.client = application.app.test_client()
        application.rate_buckets.clear()

    def test_server_never_fetches_or_signs_original_api(self):
        with patch.object(search, '_fetch') as fetch, patch.object(search, '_fetch_path') as fetch_path:
            response = self.client.post('/api/discover/search', json=dict(source='kanju', q='测试'))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json['status'], 'client_required')
            response = self.client.post('/api/discover/detail', json=dict(source='kanju', page_url='https://www.kanju.ai/player/variant%3Atest'))
            self.assertEqual(response.json['status'], 'client_required')
            self.assertEqual(response.json['item_id'], 'variant:test')
            fetch.assert_not_called()
            fetch_path.assert_not_called()

    def test_public_episode_survives_room_invitation_and_update(self):
        value = dict(source='kanju', item='variant:test-123', episode='ep-episode:one')
        target = 'https://www.kanju.ai/player/variant%3Atest-123?episode=episode%3Aone'
        created = self.client.post('/api/watch-rooms', json=dict(selection=value))
        self.assertEqual(created.status_code, 201)
        invited = self.client.get('/api/watch-rooms/' + created.json['room'] + '/program').json
        self.assertEqual(invited['program']['page'], target)
        self.assertTrue(invited['program']['exact_episode'])
        self.assertNotIn('owner', invited)
        self.assertEqual(self.client.get(search.selection_path(**dict(source='kanju', item=value['item'], episode=value['episode']))).status_code, 200)
        self.assertFalse(normalize_program(dict(source='kanju', item='variant:test', episode='page'), set())['exact_episode'])

    def test_rejects_credentials_foreign_pages_and_disabled_source(self):
        for episode in ['ep-a.b.c', 'ep-https://evil.test', 'ep-a?token=x', 'ep-', 'ep-../x', 'ep-x/y']:
            self.assertIsNone(search.selection_page('kanju', 'test', episode))
        for page in ['https://evil.test/player/test', 'https://user@www.kanju.ai/player/test',
                     'https://www.kanju.ai/player/test?token=x', 'https://www.kanju.ai/player/%2Fadmin']:
            self.assertIsNone(search.detail_url(search.PROVIDERS['kanju'], page))
        with patch.dict(os.environ, {'DISCOVERY_DISABLED_SEARCH_SOURCES': 'kanju'}):
            self.assertEqual(self.client.post('/api/discover/search', json=dict(source='kanju', q='测试')).status_code, 400)
            self.assertEqual(self.client.get('/discover/play/kanju/test/ep-one').status_code, 404)
        self.assertIsNone(normalize_program(dict(source='kanju', item='test', episode='ep-one'), set()))


if __name__ == '__main__':
    unittest.main()
