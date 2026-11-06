import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import app as application
import client_updates
from scripts.prepare_client_release import prepare


class ClientUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.config = patch.dict(application.app.config, CLIENT_RELEASE_DIR=str(self.root))
        self.config.start()
        self.client = application.app.test_client()
        client_updates._verified.clear()
        self.item = dict(version="0.6.24", filename="TogetherWatch-Windows-0.6.24-x64.zip",
                         size=12, sha256=hashlib.sha256(b"fixture-only").hexdigest(), notes=["更新说明"])
        (self.root / self.item["filename"]).write_bytes(b"fixture-only")
        self.publish()

    def tearDown(self):
        self.config.stop()
        self.temp.cleanup()

    def publish(self):
        (self.root / "manifest.json").write_text(json.dumps(dict(schema=1, releases={"windows": self.item})), encoding="utf-8")

    def test_checked_release_api_and_range_download(self):
        result = self.client.get('/api/client-updates/windows')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.headers['Cache-Control'], 'no-store')
        self.assertTrue(result.json['available'])
        path = result.json['release']['download_path']
        with self.client.get(path, headers={'Range': 'bytes=0-3'}) as response:
            self.assertEqual(response.status_code, 206)
            self.assertEqual(response.data, b'fixt')
            self.assertIn('attachment', response.headers['Content-Disposition'])
        self.assertEqual(self.client.get('/api/client-updates/ios').status_code, 404)

    def test_missing_or_corrupt_files_never_advertise_update(self):
        self.assertIsNotNone(client_updates.release(self.root, 'windows'))
        (self.root / self.item['filename']).write_bytes(b'changed-only')
        self.assertFalse(self.client.get('/api/client-updates/windows').json['available'])
        self.assertEqual(self.client.get('/downloads/files/' + self.item['filename']).status_code, 404)
        (self.root / self.item['filename']).unlink()
        self.assertFalse(self.client.get('/api/client-updates/windows').json['available'])

    def test_manifest_rejects_traversal_urls_versions_and_unbounded_text(self):
        original = self.item.copy()
        for changes in ({'filename': '../app.py'}, {'filename': 'https://evil.invalid/a.zip'},
                        {'version': '0.6.24/evil'}, {'sha256': 'wrong'}, {'size': True},
                        {'notes': ['x' * 241]}, {'notes': 'not-an-array'}):
            self.item = {**original, **changes}; self.publish()
            self.assertFalse(self.client.get('/api/client-updates/windows').json['available'], changes)
        self.assertEqual(self.client.get('/downloads/files/app.py').status_code, 404)

    def test_download_page_escapes_notes_and_has_no_fake_download(self):
        self.item['notes'] = ['<script>alert(1)</script>']; self.publish()
        page = self.client.get('/downloads').text
        self.assertNotIn('<script>alert', page)
        self.assertIn('&lt;script&gt;', page)
        (self.root / 'manifest.json').write_text('{bad', encoding='utf-8')
        page = self.client.get('/downloads').text
        self.assertIn('安装包尚未发布', page)
        self.assertNotIn('class="download"', page)

    def test_android_requires_integer_build_number(self):
        item = {**self.item, 'version': '0.3.28', 'filename': 'TogetherWatch-Android-0.3.28.apk'}
        (self.root / item['filename']).write_bytes(b'fixture-only')
        for code, valid in [(None, False), (True, False), (0, False), (33, True)]:
            item['version_code'] = code
            (self.root / 'manifest.json').write_text(json.dumps(dict(schema=1, releases={'android': item})))
            self.assertEqual(self.client.get('/api/client-updates/android').json['available'], valid)

    def test_release_preparation_is_local_checked_and_never_overwrites_directory(self):
        output = self.root / 'new-release'
        source = self.root / self.item['filename']
        with patch('builtins.print'):
            prepare(source, source, output, ['此次说明'])
        for platform in ('windows', 'android'):
            self.assertEqual(client_updates.release(output, platform)['notes'], ['此次说明'])
        before = (output / 'manifest.json').read_bytes()
        with self.assertRaises(FileExistsError):
            prepare(source, source, output)
        self.assertEqual((output / 'manifest.json').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
