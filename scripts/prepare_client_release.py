"""Build a publication directory; never upload, restart or replace live files."""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import client_updates


def prepare(windows, android, output, notes=None):
    notes = notes or ["新增客户端更新检查和下载入口。", "普通更新可以稍后处理，不自动打断观看。"]
    if len(notes) > 8 or any(not isinstance(note, str) or len(note) > 240 for note in notes):
        raise ValueError("更新说明最多 8 条，每条不超过 240 字")
    root = Path(__file__).resolve().parents[1]
    version = json.loads((root / "desktop-app/package.json").read_text(encoding="utf-8"))["version"]
    gradle = (root / "android-app/app/build.gradle").read_text(encoding="utf-8")
    android_version = re.search(r'versionName "([^"]+)"', gradle).group(1)
    android_code = int(re.search(r'versionCode (\d+)', gradle).group(1))
    for path in (windows, android):
        if not Path(path).is_file():
            raise ValueError(f"安装包不存在：{path}")
    destination = Path(output).resolve()
    destination.mkdir(parents=True, exist_ok=False)
    releases = {}
    for platform, source, number, filename in (
        ("windows", windows, version, f"TogetherWatch-Windows-{version}-x64.zip"),
        ("android", android, android_version, f"TogetherWatch-Android-{android_version}.apk"),
    ):
        target = destination / filename
        shutil.copyfile(source, target)
        digest = hashlib.sha256()
        with target.open("rb") as stream:
            for block in iter(lambda: stream.read(1048576), b""):
                digest.update(block)
        releases[platform] = dict(version=number, filename=filename, size=target.stat().st_size,
                                  sha256=digest.hexdigest(), notes=notes)
        if platform == "android":
            releases[platform]["version_code"] = android_code
    (destination / "manifest.json").write_text(json.dumps(dict(schema=1, releases=releases), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for platform in releases:
        if not client_updates.release(destination, platform):
            raise ValueError(f"发布目录校验失败：{platform}")
    print(f"已生成并校验：{destination}；尚未上传或部署。请先传两个安装包，最后发布 manifest.json。")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--windows", required=True)
    parser.add_argument("--android", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--note", action="append", help="更新说明，可重复；最多 8 条")
    args = parser.parse_args()
    prepare(args.windows, args.android, args.output, args.note)
