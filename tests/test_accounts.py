import json
import sqlite3
import tempfile
import time
import unittest
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import app as application
import accounts


PASSWORD = 'personal-test-password-123'


def row(episode='ep1', **changes):
    return dict(source='kanju', item='av-test', episode=episode, title='账号测试剧', label='第一集',
                time=25, duration=100, updated=int(time.time()*1000), poster='https://image.tmdb.org/t/p/w500/test.jpg', **changes)


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = patch.dict(application.app.config, TESTING=True, ACCOUNT_DATABASE=str(Path(self.tmp.name)/'accounts.sqlite3'),
                                 ACCOUNT_REGISTRATION_ENABLED=True, SESSION_COOKIE_SECURE=False)
        self.config.start()
        self.addCleanup(self.config.stop)
        application.rate_buckets.clear()
        self.client = application.app.test_client()
        self.csrf = self.client.get('/api/account/session').json['csrf']
        self.user = None

    def post(self, path, data, **headers):
        return self.client.post('/api/account/'+path, json=data,
                                headers={'X-CSRF-Token': self.csrf, 'X-Account-ID': self.user['id'] if self.user else '', **headers})

    def register(self, username='tester_one'):
        response = self.post('register', dict(username=username, display_name='测试用户', password=PASSWORD, consent=True))
        self.assertEqual(response.status_code, 201, response.text)
        self.user, self.csrf = response.json['user'], response.json['csrf']
        return response

    def history(self):
        return self.client.get('/api/account/history', headers={'X-Account-ID': self.user['id']})

    def test_signup_hash_cookie_and_restart_persistence(self):
        response = self.register('TeStEr_One')
        self.assertEqual(self.user['username'], 'tester_one')
        self.assertIn('HttpOnly', response.headers['Set-Cookie'])
        self.assertIn('SameSite=Lax', response.headers['Set-Cookie'])
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        with closing(sqlite3.connect(application.app.config['ACCOUNT_DATABASE'])) as db:
            encoded = db.execute('SELECT password_hash FROM users').fetchone()[0]
            self.assertTrue(encoded.startswith('scrypt:32768:8:1$'))
            self.assertNotIn(PASSWORD, encoded)
        self.assertEqual(self.post('history', dict(revision=0, upserts=[row()])).status_code, 200)
        self.assertEqual(self.history().json['rows'][0]['time'], 25)
        second = application.app.test_client()
        token = second.get('/api/account/session').json['csrf']
        response = second.post('/api/account/login', json=dict(username='tester_one', password=PASSWORD), headers={'X-CSRF-Token': token})
        self.assertEqual(response.status_code, 200)
        other = second.get('/api/account/history', headers={'X-Account-ID': response.json['user']['id']})
        self.assertEqual(other.json['rows'][0]['title'], '账号测试剧')

    def test_csrf_origin_methods_and_secure_production_cookie(self):
        self.assertEqual(self.client.post('/api/account/register', json={}).status_code, 403)
        self.assertEqual(self.post('register', {}, **{'X-CSRF-Token':'é'}).status_code, 403)
        self.assertEqual(self.post('register', {}, Origin='https://evil.example').status_code, 403)
        self.assertEqual(self.post('register', {}, **{'Sec-Fetch-Site': 'cross-site'}).status_code, 403)
        self.assertEqual(self.client.get('/api/account/session', headers={'Origin':'https://evil.example'}).status_code, 403)
        self.assertEqual(self.client.post('/api/account/login', data='plain').status_code, 415)
        self.assertEqual(self.client.get('/api/account/logout').status_code, 405)
        with patch.dict(application.app.config, SESSION_COOKIE_SECURE=True):
            response = application.app.test_client().get('/api/account/session', base_url='https://localhost')
            self.assertIn('Secure;', response.headers['Set-Cookie'])
        self.assertEqual(self.client.get('/api/account/history').status_code, 401)

    def test_signup_validation_and_duplicate(self):
        for username, password, consent in [('x',PASSWORD,True), ('../admin',PASSWORD,True), ('user1','short',True),('user1',PASSWORD,False)]:
            self.assertEqual(self.post('register', dict(username=username,password=password,consent=consent)).status_code,400)
        application.rate_buckets.clear()
        self.register()
        duplicate=self.post('register', dict(username='TESTER_ONE',password=PASSWORD,consent=True))
        self.assertEqual(duplicate.status_code,409)
        with patch.dict(application.app.config, ACCOUNT_REGISTRATION_ENABLED=False):
            self.assertEqual(self.post('register',dict(username='another',password=PASSWORD,consent=True)).status_code,403)

    def test_account_isolation_stale_account_header_and_logout_revocation(self):
        self.register()
        self.post('history',dict(revision=0,upserts=[row()]))
        alice = dict(self.user)
        old_cookie=self.client.get_cookie('session').value
        self.assertEqual(self.post('history',dict(revision=1,clear=True),**{'X-Account-ID':'foreign'}).status_code,409)
        logged_out=self.post('logout',{})
        self.csrf=logged_out.json['csrf'];self.user=None
        replay=application.app.test_client();replay.set_cookie('session',old_cookie)
        self.assertIsNone(replay.get('/api/account/session').json['user'])
        self.register('tester_two')
        self.assertEqual(self.history().json['rows'],[])
        self.assertEqual(self.client.get('/api/account/history',headers={'X-Account-ID':alice['id']}).status_code,409)
        self.assertEqual(self.post('history',dict(revision=0,user_id=alice['id'],upserts=[row('ep2')])).status_code,200)
        self.assertEqual(self.history().json['rows'][0]['episode'],'ep2')

    def test_history_conflicts_deletions_disable_and_no_sensitive_fields(self):
        self.register()
        item=row();item.update(cookie='secret',owner='secret',media_url='https://private/?token=secret')
        response=self.post('history',dict(revision=0,upserts=[item]))
        self.assertEqual(response.status_code,200)
        self.assertNotIn('secret',response.text)
        key='kanju:av-test:ep1'
        self.assertEqual(self.post('history',dict(revision=1,deletes=[key])).status_code,200)
        stale=self.post('history',dict(revision=1,upserts=[item]))
        self.assertEqual(stale.status_code,409);self.assertEqual(stale.json['history']['rows'],[])
        self.assertIn(key,stale.json['history']['deleted'])
        paused=self.post('history',dict(revision=2,enabled=False,upserts=[item]))
        self.assertFalse(paused.json['enabled']);self.assertEqual(paused.json['rows'],[])
        self.assertEqual(self.post('history',dict(revision=3,enabled=True,upserts=[item])).status_code,200)
        cleared=self.post('history',dict(revision=4,clear=True))
        self.assertEqual(cleared.json['rows'],[])

    def test_history_bounds_sanitization_and_no_older_rewind(self):
        self.register()
        for item in [dict(row(),time=float('inf')),dict(row(),time=True),dict(row(),source='unknown'),dict(row(),item='../private'),dict(row(),updated=1e30)]:
            self.assertEqual(self.post('history',dict(revision=0,upserts=[item])).status_code,400)
        self.assertEqual(self.post('history',dict(revision=True)).status_code,400)
        self.assertEqual(self.post('history',dict(revision=0,upserts=[row()]*101)).status_code,400)
        response=self.post('history',dict(revision=0,upserts=[dict(row('ep'+str(i)),poster='https://evil.example/track.png') for i in range(100)]))
        self.assertEqual(len(response.json['rows']),100);self.assertTrue(all(r['poster']=='' for r in response.json['rows']))
        self.post('history',dict(revision=1,upserts=[row('next')]))
        self.assertEqual(len(self.history().json['rows']),100)
        self.post('history',dict(revision=2,upserts=[dict(row('next'),updated=1,time=10)]))
        self.assertEqual(next(r for r in self.history().json['rows'] if r['episode']=='next')['time'],25)

    def test_password_change_invalidates_other_sessions_and_delete_cascades(self):
        self.register()
        old=self.client.get_cookie('session').value
        self.assertEqual(self.post('password',dict(current_password='wrong',password=PASSWORD+'new')).status_code,400)
        changed=self.post('password',dict(current_password=PASSWORD,password=PASSWORD+'new'))
        self.assertEqual(changed.status_code,200);self.csrf=changed.json['csrf']
        replay=application.app.test_client();replay.set_cookie('session',old)
        self.assertIsNone(replay.get('/api/account/session').json['user'])
        self.post('history',dict(revision=0,upserts=[row()]))
        self.assertEqual(self.post('delete',dict(confirm='DELETE',password=PASSWORD)).status_code,400)
        self.assertEqual(self.post('delete',dict(confirm='DELETE',password=PASSWORD+'new')).status_code,200)
        with closing(sqlite3.connect(application.app.config['ACCOUNT_DATABASE'])) as db:
            for table in ('users','history','history_deleted','logins'):
                self.assertEqual(db.execute('SELECT count(*) FROM '+table).fetchone()[0],0)

    def test_rate_limit_and_json_size(self):
        for _ in range(5):self.post('register',{})
        self.assertEqual(self.post('register',{}).status_code,429)
        application.rate_buckets.clear()
        self.register()
        oversized=self.post('history',dict(revision=0,padding='x'*262145))
        self.assertEqual(oversized.status_code,413)
        for _ in range(15):
            self.assertEqual(self.post('login',dict(username='no_account',password=PASSWORD)).status_code,401)
        self.assertEqual(self.post('login',dict(username='no_account',password=PASSWORD)).status_code,429)

    def test_account_templates_and_persistent_volume(self):
        for url in ['/', '/discover', '/mobile-room/accounts-test']:
            html=self.client.get(url).text
            self.assertIn('id="accountDialog"',html)
            self.assertIn('js/account.js',html)
            self.assertIn('data-account-open',html)
        root=Path(__file__).resolve().parents[1]
        self.assertIn('account_data:/app/data',(root/'compose.yaml').read_text(encoding='utf-8'))
        self.assertIn('ACCOUNT_DATABASE: /app/data/accounts.sqlite3',(root/'compose.yaml').read_text(encoding='utf-8'))
        self.assertEqual(self.client.get('/health').json['account_history_version'],'20261029-v1')

    def test_two_devices_cannot_overwrite_same_revision_and_sessions_expire(self):
        self.register()
        other=application.app.test_client()
        token=other.get('/api/account/session').json['csrf']
        login=other.post('/api/account/login',json=dict(username=self.user['username'],password=PASSWORD),headers={'X-CSRF-Token':token}).json
        def write(client,token,episode):
            return client.post('/api/account/history',json=dict(revision=0,upserts=[row(episode)]),
                               headers={'X-CSRF-Token':token,'X-Account-ID':self.user['id']}).status_code
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures=[executor.submit(write,self.client,self.csrf,'ep1'),executor.submit(write,other,login['csrf'],'ep2')]
            self.assertEqual(sorted(f.result() for f in futures),[200,409])
        with closing(sqlite3.connect(application.app.config['ACCOUNT_DATABASE'])) as db:
            db.execute('UPDATE logins SET expires=0');db.commit()
        self.assertIsNone(self.client.get('/api/account/session').json['user'])
        self.assertEqual(self.history().status_code,401)


if __name__=='__main__':unittest.main()
