import time
import unittest
from unittest.mock import patch

import app as application
from room_program import normalize_program

SINTEL = dict(source="sample", item="sintel", episode="video")
BUNNY = dict(source="sample", item="bunny", episode="video")


class WatchRoomTests(unittest.TestCase):
    def setUp(self):
        application.rate_buckets.clear()
        application.room_programs.clear()
        self.client = application.app.test_client()
        self.sockets = []

    def tearDown(self):
        for client in self.sockets:
            client.disconnect()
        application.room_programs.clear()

    def create(self):
        response = self.client.post('/api/watch-rooms', json={'selection': SINTEL})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        return response.json

    def test_invitation_reads_selection_without_owner_or_media_credentials(self):
        created = self.create()
        response = self.client.get('/api/watch-rooms/' + created['room'] + '/program')
        self.assertEqual(response.json['program']['page'], 'https://media.w3.org/2010/05/sintel/trailer.mp4')
        self.assertNotIn(created['owner'], response.text)
        self.assertEqual(response.json['revision'], 1)
        socket = application.socketio.test_client(application.app)
        self.sockets.append(socket)
        socket.emit('join', {'room':created['room'], 'username':'guest'})
        events = socket.get_received()
        selection = next(e['args'][0] for e in events if e['name'] == 'room_program')
        self.assertEqual(selection, response.json)
        self.assertNotIn('owner', str(events))

    def test_only_owner_can_change_and_cannot_change_other_room(self):
        a, b = self.create(), self.create()
        route = '/api/watch-rooms/' + a['room'] + '/program'
        for owner in ['', b['owner']]:
            self.assertEqual(self.client.put(route, json={'selection': BUNNY}, headers={'Authorization':'Bearer ' + owner}).status_code, 403)
        response = self.client.put(route, json={'selection': BUNNY}, headers={'Authorization':'Bearer ' + a['owner']})
        self.assertEqual(response.json['revision'], 2)
        self.assertEqual(response.json['program']['item'], 'bunny')

    def test_no_arbitrary_url_token_or_disabled_provider(self):
        for selection in [dict(source='url',item='https://127.0.0.1/',episode='x'),
                          dict(source='sample',item='sintel?token=secret',episode='video'),
                          {**SINTEL,'cookie':'secret'}, dict(source='kanju',item='../admin',episode='page')]:
            self.assertEqual(self.client.post('/api/watch-rooms', json={'selection':selection}).status_code, 400)
        self.assertEqual(self.client.post('/api/watch-rooms',json={'selection':SINTEL},headers={'Origin':'https://evil.test'}).status_code,403)
        self.assertIsNone(normalize_program(dict(source='cupfox',item='123',episode='ep1'), set()))
        self.assertFalse(normalize_program(dict(source='kanju',item='public-id_1',episode='page'),set())['exact_episode'])

    def test_stale_player_cannot_overwrite_new_episode_timeline(self):
        created = self.create()
        room = created['room']
        socket = application.socketio.test_client(application.app)
        self.sockets.append(socket)
        socket.emit('join', dict(room=room,username='host',role='companion'))
        socket.emit('video_event', dict(room=room,type='seek',time=40,program_revision=1))
        self.assertEqual(application.room_states[room]['time'],40)
        self.client.put('/api/watch-rooms/' + room + '/program', json={'selection':BUNNY},headers={'Authorization':'Bearer '+created['owner']})
        socket.emit('video_event',dict(room=room,type='seek',time=40,program_revision=1))
        socket.emit('playback_snapshot',dict(room=room,time=40,playing=True,program_revision=1))
        self.assertNotIn(room,application.room_states)
        socket.emit('video_event',dict(room=room,type='seek',time=3,program_revision=2))
        self.assertEqual(application.room_states[room]['time'],3)
        socket.emit('video_event',dict(room=room,type='seek',time=900))
        self.assertEqual(application.room_states[room]['time'],3)

    def test_expired_invite_not_silently_recreated(self):
        created = self.create()
        application.room_activity[created['room']] = time.time() - application.ROOM_TTL_SECONDS - 1
        self.assertEqual(self.client.get('/api/watch-rooms/'+created['room']+'/program').status_code,404)
        self.assertNotIn(created['room'], application.room_programs)

    def test_kanju_entry_is_not_claimed_as_search_results(self):
        html = self.client.get('/discover').text
        self.assertIn('https://www.kanju.ai/',html)
        self.assertNotIn('data-live-source="kanju"',html)


if __name__ == '__main__':
    unittest.main()
