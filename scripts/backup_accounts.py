"""Create a consistent SQLite account backup; never overwrite an existing file."""
import argparse
import os
import sqlite3
from contextlib import closing
from pathlib import Path


def backup(source, destination):
    source = Path(source).resolve(strict=True)
    destination = Path(destination).resolve()
    if source == destination:
        raise ValueError('备份不能覆盖原数据库')
    # Exclusive creation also rejects pre-existing symlinks and concurrent writers.
    fd = os.open(str(destination), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    with closing(sqlite3.connect(source.as_uri()+'?mode=ro', uri=True)) as src, closing(sqlite3.connect(destination)) as dst:
        src.backup(dst)
        if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('备份完整性检查失败，请勿使用此备份')
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default=os.environ.get('ACCOUNT_DATABASE', 'data/accounts.sqlite3'))
    parser.add_argument('destination', help='新的备份文件路径（不能已存在）')
    args = parser.parse_args()
    print('备份完成：'+str(backup(args.source, args.destination)))
