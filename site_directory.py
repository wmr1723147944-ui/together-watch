"""Reviewed navigation metadata. Never a search API, media resolver or proxy."""
import json
from pathlib import Path

DIRECTORY = json.loads((Path(__file__).parent / "static/data/site-directory.json").read_text(encoding="utf-8"))
STATUS_LABELS = {
    "entry": "首页已核对 · 播放未验证", "login": "需自行登录",
    "verification": "需原站验证", "publication": "地址发布页",
    "regional": "有地区限制", "restricted": "访问受限 · 可手动尝试",
}


def site_entries(disabled=()):
    return [{**s, "status_label": STATUS_LABELS[s["status"]],
             "launch_path": "/discover/site/" + s["id"]} for s in DIRECTORY["sites"]
            if "site-" + s["id"] not in disabled]


def site_entry(key, disabled=()):
    return next((s for s in site_entries(disabled) if s["id"] == key), None)
