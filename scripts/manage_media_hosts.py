#!/usr/bin/env python3
"""Safely manage AUTHORIZED_MEDIA_HOSTS in a deployment env file."""

import argparse
import ipaddress
import os
import re
import stat
from pathlib import Path
from urllib.parse import urlparse


SETTING = "AUTHORIZED_MEDIA_HOSTS"
HOST_PATTERN = re.compile(
    r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*"
    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
)
OFFICIAL_VIDEO_DOMAINS = (
    "bilibili.com",
    "b23.tv",
    "v.qq.com",
    "iqiyi.com",
    "qiyi.com",
    "youku.com",
    "mgtv.com",
    "douyin.com",
    "iesdouyin.com",
    "kuaishou.com",
    "acfun.cn",
    "youtube.com",
    "youtu.be",
)


def normalize_rule(value):
    candidate = str(value or "").strip()
    if "://" in candidate:
        parsed = urlparse(candidate)
        candidate = parsed.hostname or ""
    candidate = candidate.rstrip(".").lower()
    wildcard = candidate.startswith("*.")
    base = candidate[2:] if wildcard else candidate
    try:
        base = base.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError("域名编码无效") from exc
    if not base or not HOST_PATTERN.fullmatch(base):
        raise ValueError("请输入完整域名或以 http(s) 开头的媒体链接")
    if base == "localhost" or base.endswith(".local"):
        raise ValueError("不能授权本机或局域网域名")
    try:
        address = ipaddress.ip_address(base)
    except ValueError:
        address = None
    if address is not None:
        raise ValueError("请使用媒体域名，不要直接授权 IP 地址")
    if any(base == domain or base.endswith(f".{domain}") for domain in OFFICIAL_VIDEO_DOMAINS):
        raise ValueError("官方视频平台不能登记为直链来源，请使用其官方网页和本人账号")
    return f"*.{base}" if wildcard else base


def parse_rules(value):
    rules = []
    for item in re.split(r"[\s,;]+", value or ""):
        if not item:
            continue
        rule = normalize_rule(item)
        if rule not in rules:
            rules.append(rule)
    return tuple(rules)


def load_env(path):
    if not path.is_file():
        raise FileNotFoundError(f"找不到环境文件：{path}")
    text = path.read_text(encoding="utf-8")
    match = re.search(rf"(?m)^{SETTING}=(.*)$", text)
    return text, parse_rules(match.group(1).strip()) if match else ()


def save_env(path, original, rules):
    replacement = f"{SETTING}={','.join(rules)}"
    if re.search(rf"(?m)^{SETTING}=.*$", original):
        updated = re.sub(rf"(?m)^{SETTING}=.*$", replacement, original, count=1)
    else:
        separator = "" if original.endswith(("\n", "\r")) else "\n"
        updated = f"{original}{separator}{replacement}\n"

    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(updated, encoding="utf-8", newline="\n")
    try:
        os.chmod(temporary, stat.S_IMODE(path.stat().st_mode))
    except OSError:
        pass
    os.replace(temporary, path)


def update_rules(path, action, values):
    original, current_rules = load_env(path)
    rules = list(current_rules)
    normalized = [normalize_rule(value) for value in values]
    if action == "add":
        for rule in normalized:
            if rule not in rules:
                rules.append(rule)
    elif action == "remove":
        rules = [rule for rule in rules if rule not in normalized]
    else:
        raise ValueError("不支持的操作")
    save_env(path, original, rules)
    return tuple(rules)


def build_parser():
    parser = argparse.ArgumentParser(
        description="按域名管理自有或已授权媒体直链，不会逐条保存视频地址。",
    )
    parser.add_argument(
        "--env-file",
        default=".env.server",
        type=Path,
        help="部署环境文件，默认 .env.server",
    )
    subparsers = parser.add_subparsers(dest="action", required=True)
    subparsers.add_parser("list", help="查看已登记的媒体域名")
    add = subparsers.add_parser("add", help="登记媒体域名")
    add.add_argument("values", nargs="+", help="域名、*.域名或完整媒体链接")
    add.add_argument(
        "--confirm-rights",
        action="store_true",
        help="确认对该来源拥有所有权或足够授权",
    )
    remove = subparsers.add_parser("remove", help="移除媒体域名")
    remove.add_argument("values", nargs="+", help="域名、*.域名或完整媒体链接")
    return parser


def main():
    args = build_parser().parse_args()
    try:
        if args.action == "list":
            _, rules = load_env(args.env_file)
        else:
            if args.action == "add" and not args.confirm_rights:
                raise ValueError("添加前必须使用 --confirm-rights 确认拥有权利或授权")
            rules = update_rules(args.env_file, args.action, args.values)
    except (FileNotFoundError, ValueError, OSError) as exc:
        raise SystemExit(f"操作失败：{exc}") from exc

    if rules:
        print("已登记媒体域名：")
        for rule in rules:
            print(f"- {rule}")
    else:
        print("当前没有登记媒体域名。")
    if args.action != "list":
        print("配置已更新。重新创建应用容器后生效：")
        print("sudo docker compose --env-file .env.server up -d --force-recreate app")


if __name__ == "__main__":
    main()
