"""Reviewed navigation metadata. Never a search API, media resolver or proxy."""
import json
from pathlib import Path

DIRECTORY = json.loads((Path(__file__).parent / "static/data/site-directory.json").read_text(encoding="utf-8"))
STATUS_LABELS = {
    "entry": "核对时首页可达", "login": "核对时出现登录页",
    "verification": "核对时遇到验证", "publication": "核对时为发布页",
    "regional": "核对时受地区限制", "restricted": "核对时访问受限",
}


def site_entries(disabled=()):
    return [{**s, "status_label": STATUS_LABELS[s["status"]],
             "status_scope": "review_snapshot", "reviewed_at": DIRECTORY["reviewed"],
             "launch_path": "/discover/site/" + s["id"]} for s in DIRECTORY["sites"]
            if "site-" + s["id"] not in disabled]


def site_entry(key, disabled=()):
    return next((s for s in site_entries(disabled) if s["id"] == key), None)
