"""First-party accounts. Never shares credentials/history with media providers."""
import hashlib
import json
import math
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path

from flask import Blueprint, current_app, g, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from poster_policy import poster_url

SOURCES = {'kanju', 'huarw', 'cupfox', 'blender', 'yhdmoe', '233dm', 'pkavi'}
HASH_SLOTS = threading.BoundedSemaphore(2)
SCHEMA_LOCK = threading.Lock()
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL, created INTEGER NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS logins (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS logins_user ON logins(user_id);
CREATE TABLE IF NOT EXISTS history (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 key TEXT NOT NULL, payload TEXT NOT NULL, updated INTEGER NOT NULL,
 PRIMARY KEY (user_id,key));
CREATE TABLE IF NOT EXISTS history_deleted (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 key TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (user_id,key));
CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
"""


@contextmanager
def database():
    path = Path(current_app.config['ACCOUNT_DATABASE'])
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
    except FileExistsError:
        pass
    db = sqlite3.connect(path, timeout=8)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA foreign_keys=ON')
        with SCHEMA_LOCK:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript(SCHEMA)
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def user_for(db):
    token = session.get('account_token')
    if not isinstance(token, str):
        return None
    return db.execute('SELECT u.* FROM users u JOIN logins s ON s.user_id=u.id '
                      'WHERE s.token_hash=? AND s.expires>?', (digest(token), int(time.time()))).fetchone()


def public_user(user):
    return dict(id=user['id'], username=user['username'], display_name=user['display_name'])


def csrf():
    if not session.get('account_csrf'):
        session['account_csrf'] = secrets.token_urlsafe(32)
    return session['account_csrf']


def issue_login(db, user):
    old = session.get('account_token')
    if isinstance(old, str):
        db.execute('DELETE FROM logins WHERE token_hash=?', (digest(old),))
    session.clear()
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    db.execute('DELETE FROM logins WHERE expires<=?', (now,))
    # Bound active sessions without storing browsers, IP addresses or device IDs.
    db.execute('DELETE FROM logins WHERE user_id=? AND token_hash NOT IN '
               '(SELECT token_hash FROM logins WHERE user_id=? ORDER BY created DESC LIMIT 9)', (user['id'], user['id']))
    db.execute('INSERT INTO logins VALUES (?,?,?,?)', (digest(token), user['id'], now+30*86400, now))
    session['account_token'] = token
    session.permanent = True
    return dict(user=public_user(user), csrf=csrf())


def snapshot(db, user_id):
    import json
    user = db.execute('SELECT enabled,revision FROM users WHERE id=?', (user_id,)).fetchone()
    return dict(enabled=bool(user['enabled']), revision=user['revision'],
                rows=[json.loads(r['payload']) for r in db.execute(
                    'SELECT payload FROM history WHERE user_id=? ORDER BY updated DESC LIMIT 100', (user_id,))],
                deleted=[r['key'] for r in db.execute('SELECT key FROM history_deleted WHERE user_id=?', (user_id,))])


def history_key(row):
    if not isinstance(row, dict) or row.get('source') not in SOURCES or row.get('exact_episode') is False or row.get('episode') == 'page':
        raise ValueError('历史记录的来源或集数无效')
    for name in ('item', 'episode'):
        value = row.get(name)
        if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,240}', value) or '..' in value:
            raise ValueError('历史记录的条目或集数无效')
    return ':'.join(row[k] for k in ('source', 'item', 'episode'))


def clean_history(row):
    history_key(row)
    result = {k: row[k] for k in ('source', 'item', 'episode')}
    for name, low, high in [('time', 5, 604800), ('duration', 0, 604800), ('updated', 0, int(time.time()*1000)+300000)]:
        value = row.get(name, 0)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError('历史记录的时间无效')
        result[name] = value
    result.update(title=str(row.get('title', '观看记录'))[:160], label=str(row.get('label', '上次观看的集数'))[:80],
                  poster=poster_url(row.get('poster'), 'https://watchtogethernow.cloud') or '')
    return result


def register_accounts(app, rate_limit):
    bp = Blueprint('account', __name__, url_prefix='/api/account')
    app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)
    # Startup/deployment check: fail visibly if the persistent volume is not writable.
    with app.app_context(), database():
        pass

    @bp.before_request
    def protect():
        if request.headers.get('Sec-Fetch-Site') == 'cross-site':
            return jsonify(error='请在一起看页面内操作账号'), 403
        origin = request.headers.get('Origin')
        if origin and origin.rstrip('/') != request.host_url.rstrip('/'):
            return jsonify(error='请在一起看页面内操作账号'), 403
        if request.method != 'GET':
            if request.content_length and request.content_length > 256 * 1024:
                return jsonify(error='账号请求过大，请分批操作'), 413
            if not request.is_json:
                return jsonify(error='请求格式无效'), 415
            token = request.headers.get('X-CSRF-Token', '')
            expected = session.get('account_csrf')
            if not isinstance(expected, str) or not secrets.compare_digest(token.encode('utf-8'), expected.encode('utf-8')):
                return jsonify(error='登录状态已变化，请刷新后重试', code='csrf'), 403
            raw = request.stream.read(256 * 1024 + 1)
            if len(raw) > 256 * 1024:
                return jsonify(error='账号请求过大，请分批操作'), 413
            try:
                g.account_body = json.loads(raw)
            except (ValueError, UnicodeError):
                return jsonify(error='请求格式无效'), 400
            if not isinstance(g.account_body, dict):
                return jsonify(error='请求格式无效'), 400

    @bp.after_request
    def private(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Pragma'] = 'no-cache'
        return response

    @bp.errorhandler(sqlite3.Error)
    def unavailable(_error):
        return jsonify(error='账号存储暂时不可用，请稍后重试；不会影响播放'), 503

    @bp.errorhandler(413)
    def too_large(_error):
        return jsonify(error='账号请求过大，请分批操作'), 413

    def body():
        return g.account_body

    def authenticated(db):
        user = user_for(db)
        if not user:
            return None, (jsonify(error='请先登录', code='unauthenticated'), 401)
        if request.headers.get('X-Account-ID') != user['id']:
            return None, (jsonify(error='账号已切换，请刷新后重试', code='account_changed'), 409)
        return user, None

    def password_valid(password):
        return isinstance(password, str) and 12 <= len(password) <= 128

    def limited_hash(password, encoded=None):
        if not HASH_SLOTS.acquire(blocking=False):
            return None
        try:
            return check_password_hash(encoded, password) if encoded else generate_password_hash(password, method='scrypt:32768:8:1')
        finally:
            HASH_SLOTS.release()

    @bp.get('/session')
    def state():
        with database() as db:
            user = user_for(db)
            return jsonify(user=public_user(user) if user else None, csrf=csrf())

    @bp.post('/register')
    @rate_limit('account-register', 5, 3600)
    def register():
        data = body()
        username = str(data.get('username', '')).strip().lower()
        password = data.get('password')
        name = str(data.get('display_name', '')).strip()[:32] or username
        if not re.fullmatch(r'[a-z0-9_]{4,32}', username):
            return jsonify(error='用户名需为 4–32 位英文字母、数字或下划线'), 400
        if not password_valid(password):
            return jsonify(error='密码请使用 12–128 个字符'), 400
        if data.get('consent') is not True:
            return jsonify(error='请阅读并同意用户协议和隐私政策'), 400
        if current_app.config.get('ACCOUNT_REGISTRATION_ENABLED') is False:
            return jsonify(error='暂未开放新账号注册'), 403
        encoded = limited_hash(password)
        if encoded is None:
            return jsonify(error='操作繁忙，请稍后重试'), 429
        with database() as db:
            try:
                db.execute('INSERT INTO users(id,username,display_name,password_hash,created) VALUES (?,?,?,?,?)',
                           (secrets.token_hex(16), username, name, encoded, int(time.time())))
            except sqlite3.IntegrityError:
                return jsonify(error='该用户名不可用，请换一个'), 409
            user = db.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
            return jsonify(**issue_login(db, user)), 201

    @bp.post('/login')
    @rate_limit('account-login', 30, 900)
    def login():
        data = body()
        username = str(data.get('username', '')).strip().lower()[:128]
        password = data.get('password')
        if not isinstance(password, str) or len(password) > 128:
            return jsonify(error='用户名或密码不正确'), 401
        now = int(time.time())
        with database() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM auth_attempts WHERE expires<=?', (now,))
            key = digest(username)
            attempt = db.execute('SELECT count FROM auth_attempts WHERE key=?', (key,)).fetchone()
            if attempt and attempt['count'] >= 15:
                return jsonify(error='尝试次数过多，请 15 分钟后再试'), 429
            db.execute('INSERT INTO auth_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', (key, now+900))
            user = db.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
        # Unknown users perform the same costly KDF, not a cheap early return.
        dummy = 'scrypt:32768:8:1$unknown-user$' + '0'*128
        valid = limited_hash(password, user['password_hash'] if user else dummy)
        if valid is None:
            return jsonify(error='操作繁忙，请稍后重试'), 429
        if not valid or not user:
            return jsonify(error='用户名或密码不正确'), 401
        with database() as db:
            db.execute('BEGIN IMMEDIATE')
            current = db.execute('SELECT * FROM users WHERE id=?', (user['id'],)).fetchone()
            if not current or current['password_hash'] != user['password_hash']:
                return jsonify(error='账号已更新，请重新登录'), 401
            db.execute('DELETE FROM auth_attempts WHERE key=?', (key,))
            return jsonify(**issue_login(db, current))

    @bp.post('/logout')
    def logout():
        with database() as db:
            user, error = authenticated(db)
            if error:
                return error
            db.execute('DELETE FROM logins WHERE token_hash=?', (digest(session['account_token']),))
        session.clear()
        return jsonify(user=None, csrf=csrf())

    @bp.route('/history', methods=['GET', 'POST'])
    @rate_limit('account-history', 180, 60)
    def history():
        import json
        with database() as db:
            user, error = authenticated(db)
            if error:
                return error
            if request.method == 'GET':
                return jsonify(**snapshot(db, user['id']))
            data = body()
            rows, deletes = data.get('upserts', []), data.get('deletes', [])
            if (not isinstance(rows, list) or not isinstance(deletes, list) or len(rows) > 100 or len(deletes) > 100
                    or type(data.get('revision')) is not int or ('enabled' in data and type(data['enabled']) is not bool)
                    or ('clear' in data and type(data['clear']) is not bool)):
                return jsonify(error='历史请求格式无效'), 400
            try:
                rows = [clean_history(row) for row in rows]
                for key in deletes:
                    if not isinstance(key, str) or len(key.split(':')) != 3:
                        raise ValueError('历史标识无效')
                    history_key(dict(zip(('source', 'item', 'episode'), key.split(':'))))
            except (ValueError, TypeError):
                return jsonify(error='历史记录格式无效'), 400
            db.execute('BEGIN IMMEDIATE')
            if not user_for(db):
                return jsonify(error='登录已失效，请重新登录', code='unauthenticated'), 401
            current = db.execute('SELECT * FROM users WHERE id=?', (user['id'],)).fetchone()
            if not current:
                return jsonify(error='请重新登录'), 401
            if data['revision'] != current['revision']:
                return jsonify(error='其他设备已更新历史，已读取最新记录', code='history_conflict', history=snapshot(db, user['id'])), 409
            uid, now = user['id'], int(time.time()*1000)
            if data.get('clear'):
                deletes += [r['key'] for r in db.execute('SELECT key FROM history WHERE user_id=?', (uid,))]
            for key in set(deletes):
                db.execute('DELETE FROM history WHERE user_id=? AND key=?', (uid, key))
                db.execute('INSERT OR REPLACE INTO history_deleted VALUES (?,?,?)', (uid, key, now))
            enabled = data.get('enabled', bool(current['enabled']))
            if enabled:
                for row in rows:
                    key = history_key(row)
                    # An old offline/import record must not rewind a newer record.
                    db.execute('INSERT INTO history VALUES (?,?,?,?) ON CONFLICT(user_id,key) DO UPDATE '
                               'SET payload=excluded.payload,updated=excluded.updated WHERE excluded.updated>=history.updated',
                               (uid, key, json.dumps(row, ensure_ascii=False), row['updated']))
                    db.execute('DELETE FROM history_deleted WHERE user_id=? AND key=?', (uid, key))
            db.execute('DELETE FROM history WHERE user_id=? AND key NOT IN '
                       '(SELECT key FROM history WHERE user_id=? ORDER BY updated DESC LIMIT 100)', (uid, uid))
            db.execute('DELETE FROM history_deleted WHERE user_id=? AND key NOT IN '
                       '(SELECT key FROM history_deleted WHERE user_id=? ORDER BY updated DESC LIMIT 100)', (uid, uid))
            db.execute('UPDATE users SET enabled=?,revision=revision+1 WHERE id=?', (int(enabled), uid))
            return jsonify(**snapshot(db, uid))

    @bp.post('/password')
    @rate_limit('account-password', 8, 900)
    def password_change():
        data = body()
        if not password_valid(data.get('password')) or not isinstance(data.get('current_password'), str) or len(data['current_password']) > 128:
            return jsonify(error='请输入当前密码；新密码需为 12–128 个字符'), 400
        with database() as db:
            user, error = authenticated(db)
            if error:
                return error
        if limited_hash(data['current_password'], user['password_hash']) is not True:
            return jsonify(error='当前密码不正确或操作繁忙，请稍后重试'), 400
        encoded = limited_hash(data['password'])
        if encoded is None:
            return jsonify(error='操作繁忙，请稍后重试'), 429
        with database() as db:
            db.execute('BEGIN IMMEDIATE')
            result = db.execute('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?', (encoded, user['id'], user['password_hash']))
            if not result.rowcount:
                return jsonify(error='账号已更新，请重新登录'), 409
            db.execute('DELETE FROM logins WHERE user_id=?', (user['id'],))
            return jsonify(**issue_login(db, user))

    @bp.post('/delete')
    @rate_limit('account-delete', 8, 900)
    def delete():
        data = body()
        if data.get('confirm') != 'DELETE' or not isinstance(data.get('password'), str) or len(data['password']) > 128:
            return jsonify(error='请确认注销并填写密码'), 400
        with database() as db:
            user, error = authenticated(db)
            if error:
                return error
        if limited_hash(data['password'], user['password_hash']) is not True:
            return jsonify(error='密码不正确或操作繁忙，请稍后重试'), 400
        with database() as db:
            result = db.execute('DELETE FROM users WHERE id=? AND password_hash=?', (user['id'], user['password_hash']))
            if not result.rowcount:
                return jsonify(error='账号已更新，请重新登录'), 409
        session.clear()
        return jsonify(user=None, csrf=csrf())

    app.register_blueprint(bp)
