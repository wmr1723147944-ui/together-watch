"""First-party release metadata. Only advertise complete, hash-checked files."""
import hashlib
import json
import re
import threading
from pathlib import Path

VERSION = re.compile(r"(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\Z")
_verified = {}
_lock = threading.Lock()


def release(directory, platform):
    if platform not in ("windows", "android"):
        return None
    try:
        root = Path(directory).resolve()
        manifest = root / "manifest.json"
        if manifest.is_symlink() or manifest.stat().st_size > 32768:
            return None
        data = json.loads(manifest.read_text(encoding="utf-8"))
        if data.get("schema") != 1:
            return None
        item = data["releases"][platform]
        version = item["version"]
        if not isinstance(version, str) or not VERSION.fullmatch(version):
            return None
        expected = f"TogetherWatch-Windows-{version}-x64.zip" if platform == "windows" else f"TogetherWatch-Android-{version}.apk"
        if item["filename"] != expected or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            return None
        size = item["size"]
        if type(size) is not int or not 0 < size <= 1024 * 1024 * 1024:
            return None
        if platform == "android" and (type(item.get("version_code")) is not int or not 0 < item["version_code"] <= 2100000000):
            return None
        notes = item.get("notes", [])
        if not isinstance(notes, list) or len(notes) > 8 or any(not isinstance(n, str) or len(n) > 240 for n in notes):
            return None
        target = root / expected
        if target.is_symlink() or not target.is_file() or target.resolve().parent != root:
            return None
        before = target.stat()
        if before.st_size != size:
            return None
        key = (str(target), before.st_size, before.st_mtime_ns, before.st_ctime_ns, item["sha256"])
        with _lock:
            if key not in _verified:
                digest = hashlib.sha256()
                with target.open("rb") as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        digest.update(chunk)
                after = target.stat()
                if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != key[1:4]:
                    return None
                if len(_verified) >= 8:
                    _verified.clear()
                _verified[key] = digest.hexdigest() == item["sha256"]
            if not _verified[key]:
                return None
        return {"platform": platform, "version": version, "filename": expected, "size": size,
                "sha256": item["sha256"], "notes": notes,
                "version_code": item.get("version_code", 0), "download_path": "/downloads/files/" + expected}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None
