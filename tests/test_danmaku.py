import json
import os
import unittest
from unittest.mock import patch, MagicMock

import app as application
import danmaku_service as service


class DanmakuTests(unittest.TestCase):
    def setUp(self):
        application.rate_buckets.clear()
        service._cache.clear()
        self.sockets = []
        self.client = application.app.test_client()
        self.created = self.client.post('/api/watch-rooms', json={'selection':{'source':'sample','item':'sintel','episode':'video'}}).json
        self.room = self.created['room']

    def tearDown(self):
        for client in self.sockets:
            client.disconnect()

    def connect(self, room=None, role="member"):
        client=application.socketio.test_client(application.app)
        self.sockets.append(client)
        client.emit('join', {'room':room or self.room,'username':'真实成员','role':role})
        return client

    def test_friend_messages_use_membership_and_episode_revision(self):
        first=self.connect(role='companion');second=self.connect();outsider=self.connect('other-test-room')
        first.emit('video_event',dict(room=self.room,type='seek',time=60,program_revision=1))
        for client in (first,second,outsider):client.get_received()
        payload=dict(room=self.room,message='<b>大家好</b>',time=60,program_revision=1,username='冒名')
        self.assertTrue(first.emit('danmaku_message',payload,callback=True)['ok'])
        pushed=[e['args'][0] for e in second.get_received() if e['name']=='danmaku_message']
        self.assertEqual(pushed[0]['username'],'真实成员')
        self.assertFalse([e for e in outsider.get_received() if e['name']=='danmaku_message'])
        self.assertFalse(outsider.emit('danmaku_message',payload,callback=True)['ok'])
        self.assertFalse(first.emit('danmaku_message',{**payload,'program_revision':0},callback=True)['ok'])
        self.assertFalse(first.emit('danmaku_message',{**payload,'time':float('nan')},callback=True)['ok'])
        self.assertFalse(first.emit('danmaku_message',{**payload,'time':500},callback=True)['ok'])
        self.assertEqual(len(second.emit('request_danmaku',dict(room=self.room,program_revision=1),callback=True)['items']),1)

    def test_rate_limit_and_episode_change_clear(self):
        first=self.connect(role='companion');first.emit('video_event',dict(room=self.room,type='seek',time=60,program_revision=1))
        p=dict(room=self.room,message='hello',time=60,program_revision=1)
        for _ in range(5):self.assertTrue(first.emit('danmaku_message',p,callback=True)['ok'])
        self.assertFalse(first.emit('danmaku_message',p,callback=True)['ok'])
        self.client.put('/api/watch-rooms/'+self.room+'/program',json={'selection':{'source':'sample','item':'bunny','episode':'video'}},headers={'Authorization':'Bearer '+self.created['owner']})
        self.assertNotIn(self.room,application.room_danmaku)
        self.assertFalse(first.emit('request_danmaku',dict(room=self.room,program_revision=1),callback=True)['ok'])

    def test_missing_credentials_are_explicit_and_no_external_request(self):
        with patch.dict(os.environ,{'DANDANPLAY_APP_ID':'','DANDANPLAY_APP_SECRET':''}),patch.object(service.requests,'get') as get:
            self.assertFalse(self.client.get('/api/danmaku/status').json['available'])
            self.assertEqual(self.client.get('/api/danmaku/search?q=测试').status_code,503)
            self.assertEqual(self.client.get('/api/danmaku/comments/123').status_code,503)
            get.assert_not_called()

    def test_public_payload_is_normalized_and_private_provider_fields_are_not_forwarded(self):
        with patch.object(service,'_get',return_value={'animes':[{'animeTitle':'测试','episodes':[{'episodeId':123,'episodeTitle':'第1集','secret':'x'}]}]}):
            self.assertEqual(service.search('测试'),[{'id':'123','title':'测试','episode':'第1集'}])
        with patch.object(service,'_get',return_value={'comments':[{'p':'12.5,1,16777215,user','m':'hello','user':'private'},{'p':'nan,1','m':'bad'}]}):
            self.assertEqual(service.comments('123'),[{'id':'public-0','time':12.5,'text':'hello','kind':'public'}])
        with self.assertRaises(service.DanmakuError):service.comments('../../admin')

    def test_signed_api_uses_fixed_host_no_redirect_and_cache(self):
        response=MagicMock();response.status_code=200;response.iter_content.return_value=[json.dumps({'comments':[]}).encode()]
        response.__enter__.return_value=response
        with patch.dict(os.environ,{'DANDANPLAY_APP_ID':'test-app','DANDANPLAY_APP_SECRET':'do-not-expose'}),patch.object(service.requests,'get',return_value=response) as get:
            service.comments('123');service.comments('123');get.assert_called_once()
            args,kwargs=get.call_args;self.assertEqual(args[0],'https://api.dandanplay.net/api/v2/comment/123')
            self.assertFalse(kwargs['allow_redirects']);self.assertIn('X-Signature',kwargs['headers'])
            self.assertNotIn('do-not-expose',str(kwargs));self.assertNotIn('AppSecret',str(kwargs))

    def test_client_templates_load_features_without_exposing_provider_secret(self):
        page=self.client.get('/mobile-room/history-danmaku-test').text
        for item in ['room-experience.js','watch-history.js','danmaku-core.js','messageMode']:self.assertIn(item,page)
        self.assertNotIn('APP_SECRET',page)
        self.assertIn('watchHistoryDialog',self.client.get('/discover').text)

    def test_official_cdn_redirect_strips_credentials_and_blocks_foreign_targets(self):
        redirect=MagicMock();redirect.status_code=302;redirect.__enter__.return_value=redirect
        final=MagicMock();final.status_code=200;final.__enter__.return_value=final;final.iter_content.return_value=[b'{"comments":[]}']
        with patch.dict(os.environ,{'DANDANPLAY_APP_ID':'test-app','DANDANPLAY_APP_SECRET':'secret'}):
            redirect.headers={'Location':'https://cas.dandanplay.net/api/comment/123?from=0'}
            with patch.object(service.requests,'get',side_effect=[redirect,final]) as get:
                service.comments('123');self.assertEqual(get.call_count,2)
                self.assertNotIn('X-AppId',get.call_args.kwargs['headers'])
                self.assertNotIn('X-Signature',get.call_args.kwargs['headers'])
            service._cache.clear();redirect.headers={'Location':'https://127.0.0.1/private'}
            with patch.object(service.requests,'get',return_value=redirect) as get:
                with self.assertRaises(service.DanmakuError):service.comments('123')
                get.assert_called_once()


if __name__=='__main__':unittest.main()
