"""Run HTTP and Socket.IO smoke tests against a local or public deployment."""

import argparse
import io
import json
import time
import uuid
import zipfile

import requests
import socketio


def expect(condition, message):
    if not condition:
        raise RuntimeError(message)


def wait_for(events, event_name, timeout=6):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for index, (name, payload) in enumerate(list(events)):
            if name == event_name:
                events.pop(index)
                return payload
        time.sleep(0.05)
    raise RuntimeError(f"等待 {event_name} 事件超时")


def run(base_url):
    base_url = base_url.rstrip("/")
    session = requests.Session()
    session.headers["User-Agent"] = "Together-Watch-Smoke-Test/1.0"

    health = session.get(f"{base_url}/health", timeout=20)
    health.raise_for_status()
    health_payload = health.json()
    expect(health_payload.get("status") == "ok", "健康检查状态异常")
    expect(
        health_payload.get("legacy_media_pipeline") is False,
        "旧媒体解析链路没有关闭",
    )
    expect(
        health_payload.get("companion_archive") is True,
        "观影伴侣安装包缺失",
    )
    expect(
        isinstance(health_payload.get("turn_configured"), bool),
        "健康检查没有报告 TURN 配置状态",
    )

    room_id = f"smoke-{uuid.uuid4().hex[:12]}"
    room = session.get(f"{base_url}/room/{room_id}", timeout=20)
    room.raise_for_status()
    expect("粘贴官方视频网页" in room.text, "房间页面内容不完整")

    resolved = session.post(
        f"{base_url}/resolve_source",
        json={"url": "https://www.bilibili.com/video/BV1xx411c7mD"},
        timeout=20,
    )
    resolved.raise_for_status()
    source = resolved.json().get("source")
    expect(source and source.get("mode") == "official_page", "官方来源识别失败")

    archive = session.get(f"{base_url}/companion-extension.zip", timeout=20)
    archive.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(archive.content)) as extension_zip:
        manifest = json.loads(extension_zip.read("manifest.json"))
    expect(manifest.get("manifest_version") == 3, "扩展安装包格式异常")

    first_events = []
    second_events = []
    first = socketio.Client(reconnection=False, request_timeout=20)
    second = socketio.Client(reconnection=False, request_timeout=20)

    for event_name in ("presence", "room_state", "sync_video", "app_error"):
        first.on(
            event_name,
            lambda payload, name=event_name: first_events.append((name, payload)),
        )
        second.on(
            event_name,
            lambda payload, name=event_name: second_events.append((name, payload)),
        )

    try:
        first.connect(base_url, transports=["websocket"], wait_timeout=20)
        second.connect(base_url, transports=["websocket"], wait_timeout=20)
        first.emit("join", {"username": "冒烟甲", "room": room_id})
        second.emit("join", {"username": "冒烟乙", "room": room_id})

        presence = wait_for(first_events, "presence")
        deadline = time.monotonic() + 4
        while presence.get("count") != 2 and time.monotonic() < deadline:
            presence = wait_for(first_events, "presence")
        expect(presence.get("count") == 2, "两个成员没有同时加入房间")

        first.emit(
            "video_event",
            {
                "room": room_id,
                "type": "change_source",
                "time": 0,
                "source": source,
            },
        )
        first.emit(
            "video_event",
            {
                "room": room_id,
                "type": "play",
                "time": 8.5,
            },
        )
        synced = wait_for(second_events, "sync_video")
        if synced.get("type") == "change_source":
            synced = wait_for(second_events, "sync_video")
        expect(synced.get("type") == "play", "播放事件没有同步到第二位成员")
        expect(float(synced.get("time", 0)) == 8.5, "同步播放时间不正确")

        second.emit("request_room_state", {"room": room_id})
        state = wait_for(second_events, "room_state")
        expect(state.get("playing") is True, "房间权威状态不是播放中")
        expect(
            state.get("media_source", {}).get("provider_key") == "bilibili",
            "房间来源状态不正确",
        )
    finally:
        if first.connected:
            first.disconnect()
        if second.connected:
            second.disconnect()

    return {
        "base_url": base_url,
        "room": room_id,
        "health": health_payload,
        "extension_version": manifest.get("version"),
        "checks": [
            "HTTP health",
            "room page",
            "fast source recognition",
            "extension archive",
            "WebSocket connection",
            "two-member presence",
            "playback synchronization",
            "authoritative room state",
        ],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "base_url",
        nargs="?",
        default="http://127.0.0.1:5000",
        help="Deployment base URL, for example https://example.onrender.com",
    )
    args = parser.parse_args()
    print(json.dumps(run(args.base_url), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
