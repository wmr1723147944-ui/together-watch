import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from scripts.backup_accounts import backup


class BackupTests(unittest.TestCase):
    def test_online_backup_wal_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            source, dest = Path(folder)/'source.sqlite3', Path(folder)/'backup.sqlite3'
            with closing(sqlite3.connect(source)) as conn:
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('CREATE TABLE sample (id TEXT)')
                conn.execute('INSERT INTO sample VALUES (?)', ('test-account',))
                conn.commit()
                backup(source, dest)
                with closing(sqlite3.connect(dest)) as saved:
                    self.assertEqual(saved.execute('SELECT id FROM sample').fetchone()[0], 'test-account')
                with self.assertRaises(FileExistsError):
                    backup(source, dest)
                with self.assertRaises(ValueError):
                    backup(source, source)
                self.assertEqual(conn.execute('SELECT count(*) FROM sample').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
