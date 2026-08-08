import io
import json
import time
import unittest
import zipfile
from unittest.mock import patch

import app as application


def direct_source(url="https://cdn.example.com/movie.mp4"):
    return application.resolve_media_source(url)


def official_source(url="https://www.bilibili.com/video/BV1xx411c7mD"):
    return application.resolve_media_source(url)


class TogetherWatchTests(unittest.TestCase):
    def setUp(self):
        application.app.config.update(TESTING=True)
        self.client = application.app.test_client()
        self.authorized_media_patcher = patch.object(
            application,
            "AUTHORIZED_MEDIA_HOSTS",
            ("cdn.example.com",),
        )
        self.authorized_media_patcher.start()
        self.addCleanup(self.authorized_media_patcher.stop)
        application.rate_buckets.clear()
        with application.room_lock:
            application.room_states.clear()
            application.room_members.clear()
            application.sid_membership.clear()
            application.sid_roles.clear()
            application.sid_client_keys.clear()
            application.room_activity.clear()
            application.socket_message_times.clear()
            application.call_members.clear()
            application.room_buffering.clear()
            application.rooms_paused_for_buffering.clear()

    def test_pages_and_security_headers(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        landing_html = response.get_data(as_text=True)
        self.assertIn('id="complianceConsent"', landing_html)
        self.assertIn('href="/terms"', landing_html)
        self.assertIn('href="/privacy"', landing_html)
        self.assertIn('href="/copyright"', landing_html)
        self.assertIn("一起看同步工具 - Together Watch", landing_html)
        self.assertIn("冀ICP备2026030481号-1", landing_html)
        self.assertIn('href="https://beian.miit.gov.cn/"', landing_html)
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("default-src 'self'", response.headers["Content-Security-Policy"])
        self.assertIn(
            "https://cdn.example.com",
            response.headers["Content-Security-Policy"],
        )

        room = self.client.get("/room/test-room")
        self.assertEqual(room.status_code, 200)
        html = room.get_data(as_text=True)
        self.assertIn("粘贴官方视频网页", html)
        self.assertIn("打开视频页面", html)
        self.assertIn(
            'aria-label="识别并使用视频来源">使用这个链接</button>',
            html,
        )
        self.assertIn("拖到书签栏：一起看助手", html)
        self.assertIn("复制助手代码", html)
        self.assertIn("/static/js/bookmarklet.js", html)
        self.assertIn("20260808-frames", html)
        self.assertIn("官方页面由原网站验证登录与会员权限", html)
        self.assertIn("助手窗口需要保持打开", html)
        self.assertIn("已登记 1 条域名规则", html)
        self.assertIn('id="videoVolumeSlider"', html)
        self.assertIn('id="callVolumeSlider"', html)
        self.assertIn('id="legalNoticeVersion"', html)
        self.assertIn("/static/js/room-gate.js", html)
        self.assertNotIn("上传本地视频", html)
        self.assertIn("只同步，不共享会员权限", html)
        self.assertIn("冀ICP备2026030481号-1", html)

        companion = self.client.get("/companion")
        self.assertEqual(companion.status_code, 200)
        companion_html = companion.get_data(as_text=True)
        self.assertIn("免安装观影助手", companion_html)
        self.assertIn('id="webCompanionRoom"', companion_html)
        self.assertIn("/static/js/web-companion.js", companion_html)
        self.assertIn("20260808-frames", companion_html)
        self.assertIn("不读取账号、Cookie 或视频地址", companion_html)

        for path, marker in (
            ("/terms", "用户协议"),
            ("/privacy", "隐私政策"),
            ("/copyright", "版权投诉"),
        ):
            legal_page = self.client.get(path)
            self.assertEqual(legal_page.status_code, 200)
            self.assertIn(marker, legal_page.get_data(as_text=True))
            self.assertIn("冀ICP备2026030481号-1", legal_page.get_data(as_text=True))

        invalid_room = self.client.get("/room/x")
        self.assertEqual(invalid_room.status_code, 404)

    def test_health_reports_public_deployment_readiness(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["status"], "ok")
        self.assertIn("version", payload)
        self.assertIn("uptime_seconds", payload)
        self.assertIn("active_rooms", payload)
        self.assertIn("connected_clients", payload)
        self.assertTrue(payload["compliance_mode"])
        self.assertFalse(payload["legacy_media_pipeline"])
        self.assertTrue(payload["authorized_media_enabled"])
        self.assertEqual(payload["authorized_media_host_rules"], 1)
        self.assertIsInstance(payload["copyright_contact_configured"], bool)
        self.assertIsInstance(payload["service_operator_configured"], bool)
        self.assertIsInstance(payload["public_launch_ready"], bool)
        self.assertIsInstance(payload["turn_configured"], bool)
        self.assertTrue(payload["companion_archive"])

    def test_companion_download_and_socket_origin_policy(self):
        extension = self.client.get("/companion-extension.zip")
        self.assertEqual(extension.status_code, 200)
        self.assertEqual(extension.mimetype, "application/zip")
        self.assertIn(
            "attachment",
            extension.headers.get("Content-Disposition", ""),
        )
        with zipfile.ZipFile(io.BytesIO(extension.get_data())) as archive:
            manifest = json.loads(archive.read("manifest.json"))
        self.assertEqual(manifest["version"], "0.5.0")
        self.assertIn(
            "https://watchtogethernow.cloud/*",
            manifest["host_permissions"],
        )
        extension.close()

        extension_origin = f"chrome-extension://{'a' * 32}"
        self.assertTrue(application.socket_origin_allowed(extension_origin))
        self.assertTrue(
            application.socket_origin_allowed(
                "https://watch.example.com",
                {
                    "wsgi.url_scheme": "https",
                    "HTTP_HOST": "watch.example.com",
                },
            )
        )
        self.assertFalse(
            application.socket_origin_allowed("https://untrusted.example")
        )

    def test_legacy_media_pipeline_is_disabled(self):
        checks = (
            self.client.post("/upload"),
            self.client.post("/probe_media", json={"url": "https://cdn.example/a.mp4"}),
            self.client.get("/proxy", query_string={"url": "https://cdn.example/a.mp4"}),
            self.client.get("/hls_proxy", query_string={"url": "https://cdn.example/a.m3u8"}),
            self.client.get(f"/transcode/{'a' * 32}"),
        )
        for response in checks:
            self.assertEqual(response.status_code, 410)
            self.assertEqual(
                response.get_json()["code"],
                "legacy_media_pipeline_disabled",
            )

    def test_source_resolver_recognizes_official_provider_without_network(self):
        with (
            patch("app.socket.getaddrinfo") as dns,
            patch("app.safe_request") as request_source,
        ):
            response = self.client.post(
                "/resolve_source",
                json={"url": "https://www.bilibili.com/video/BV1xx411c7mD"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["source"]["mode"], "official_page")
        self.assertEqual(payload["source"]["provider_key"], "bilibili")
        self.assertEqual(payload["source"]["media_id"], "BV1xx411c7mD")
        self.assertTrue(payload["source"]["requires_companion"])
        self.assertIsNone(payload["source"]["media_url"])
        self.assertEqual(payload["diagnostic"]["code"], "official_page_ready")
        dns.assert_not_called()
        request_source.assert_not_called()

    def test_source_resolver_recognizes_direct_media(self):
        response = self.client.post(
            "/resolve_source",
            json={"url": "https://cdn.example.com/path/movie.m3u8?token=abc"},
        )
        self.assertEqual(response.status_code, 200)
        source = response.get_json()["source"]
        self.assertEqual(source["mode"], "direct_media")
        self.assertEqual(source["provider_key"], "direct")
        self.assertFalse(source["requires_companion"])
        self.assertEqual(
            source["media_url"],
            "https://cdn.example.com/path/movie.m3u8?token=abc",
        )
        self.assertEqual(source["provider_name"], "已授权媒体")

    def test_source_resolver_only_accepts_authorized_generic_page(self):
        started_at = time.monotonic()
        with patch.object(
            application,
            "AUTHORIZED_PAGE_HOSTS",
            ("movies.example.com",),
        ):
            response = self.client.post(
                "/parse_url",
                json={"url": "https://movies.example.com/watch/episode-1"},
            )
        elapsed = time.monotonic() - started_at

        self.assertEqual(response.status_code, 200)
        source = response.get_json()["source"]
        self.assertEqual(source["mode"], "official_page")
        self.assertIn("movies.example.com", source["provider_name"])
        self.assertLess(elapsed, 0.3)

    def test_source_resolver_rejects_unapproved_pages_and_media(self):
        with patch.object(application, "AUTHORIZED_MEDIA_HOSTS", ()):
            media = self.client.post(
                "/resolve_source",
                json={"url": "https://cdn.example.com/member/master.m3u8"},
            )
        self.assertEqual(media.status_code, 403)
        self.assertEqual(media.get_json()["code"], "media_host_not_authorized")
        self.assertEqual(media.get_json()["hostname"], "cdn.example.com")
        self.assertEqual(media.get_json()["source_kind"], "direct_media")

        page = self.client.post(
            "/resolve_source",
            json={"url": "https://movies.example.com/watch/episode-1"},
        )
        self.assertEqual(page.status_code, 403)
        self.assertEqual(page.get_json()["code"], "page_host_not_authorized")

        insecure = self.client.post(
            "/resolve_source",
            json={"url": "http://cdn.example.com/movie.mp4"},
        )
        self.assertEqual(insecure.status_code, 400)
        self.assertEqual(insecure.get_json()["code"], "media_requires_https")

        official_direct = self.client.post(
            "/resolve_source",
            json={"url": "https://v.qq.com/member/movie.m3u8"},
        )
        self.assertEqual(official_direct.status_code, 403)
        self.assertEqual(
            official_direct.get_json()["code"],
            "official_media_direct_forbidden",
        )

    def test_production_requires_operator_and_complaint_contact(self):
        with (
            patch.object(application, "APP_ENV", "production"),
            patch.object(application, "PUBLIC_LAUNCH_READY", False),
        ):
            response = self.client.post(
                "/resolve_source",
                json={"url": "https://www.bilibili.com/video/BV1xx411c7mD"},
            )
            landing = self.client.get("/")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["code"], "compliance_setup_required")
        self.assertIn(
            "目前仅供内部测试",
            landing.get_data(as_text=True),
        )

    def test_source_resolver_rejects_local_and_unsafe_urls(self):
        for url in (
            "http://127.0.0.1/movie.mp4",
            "http://localhost/movie.mp4",
            "http://192.168.1.8/movie.mp4",
            "javascript:alert(1)",
        ):
            response = self.client.post("/resolve_source", json={"url": url})
            self.assertEqual(response.status_code, 400, url)
            self.assertFalse(response.get_json()["ok"])

    def test_sanitize_source_does_not_trust_client_mode(self):
        spoofed = {
            "mode": "direct_media",
            "provider_key": "direct",
            "provider_name": "伪装直链",
            "page_url": "https://example.com/watch/1",
            "media_url": "https://example.com/watch/1",
        }
        self.assertIsNone(application.sanitize_media_source(spoofed))

        safe = application.sanitize_media_source(direct_source())
        self.assertEqual(safe["mode"], "direct_media")
        self.assertEqual(safe["media_url"], "https://cdn.example.com/movie.mp4")

    def test_socket_room_state_and_chat(self):
        first = application.socketio.test_client(
            application.app,
            flask_test_client=self.client,
        )
        second = application.socketio.test_client(
            application.app,
            flask_test_client=application.app.test_client(),
        )
        try:
            first.emit("join", {"username": "甲", "room": "test-room"})
            first.get_received()
            first.emit(
                "video_event",
                {
                    "room": "test-room",
                    "type": "change_source",
                    "time": 0,
                    "source": official_source(),
                },
            )
            first.emit(
                "video_event",
                {"room": "test-room", "type": "play", "time": 12.5},
            )

            time.sleep(0.01)
            second.emit("join", {"username": "乙", "room": "test-room"})
            received = second.get_received()
            states = [
                item["args"][0]
                for item in received
                if item["name"] == "room_state"
            ]
            self.assertEqual(len(states), 1)
            self.assertTrue(states[0]["playing"])
            self.assertGreaterEqual(states[0]["time"], 12.5)
            self.assertEqual(states[0]["media_source"]["mode"], "official_page")
            self.assertIsNone(states[0]["media_source"]["media_url"])

            second.emit(
                "chat_message",
                {"room": "test-room", "message": "<img src=x onerror=alert(1)>"},
            )
            chat_events = [
                item["args"][0]
                for item in first.get_received()
                if item["name"] == "chat_message"
            ]
            self.assertEqual(
                chat_events[-1]["message"],
                "<img src=x onerror=alert(1)>",
            )
        finally:
            first.disconnect()
            second.disconnect()

    def test_three_members_receive_presence_list(self):
        clients = [
            application.socketio.test_client(
                application.app,
                flask_test_client=application.app.test_client(),
            )
            for _ in range(3)
        ]
        try:
            for index, client in enumerate(clients, start=1):
                client.emit(
                    "join",
                    {"username": f"成员{index}", "room": "multi-room"},
                )

            received = clients[-1].get_received()
            presence_events = [
                item["args"][0]
                for item in received
                if item["name"] == "presence"
            ]
            self.assertTrue(presence_events)
            self.assertEqual(presence_events[-1]["count"], 3)
            self.assertEqual(
                presence_events[-1]["users"],
                ["成员1", "成员2", "成员3"],
            )
        finally:
            for client in clients:
                client.disconnect()

    def test_companion_connection_is_hidden_from_human_count(self):
        room_page = application.socketio.test_client(
            application.app,
            flask_test_client=self.client,
        )
        companion = application.socketio.test_client(
            application.app,
            flask_test_client=application.app.test_client(),
        )
        try:
            room_page.emit("join", {"username": "甲", "room": "companion-room"})
            room_page.get_received()
            companion.emit(
                "join",
                {
                    "username": "甲",
                    "room": "companion-room",
                    "role": "companion",
                },
            )
            presence = [
                item["args"][0]
                for item in room_page.get_received()
                if item["name"] == "presence"
            ][-1]
            self.assertEqual(presence["count"], 1)
            self.assertEqual(presence["users"], ["甲"])

            companion.emit(
                "chat_message",
                {"room": "companion-room", "message": "播放页里的消息"},
            )
            chat_events = [
                item["args"][0]
                for item in room_page.get_received()
                if item["name"] == "chat_message"
            ]
            self.assertEqual(chat_events[-1]["username"], "甲")
            self.assertEqual(chat_events[-1]["message"], "播放页里的消息")
        finally:
            room_page.disconnect()
            companion.disconnect()

    def test_volume_command_only_reaches_paired_companion(self):
        room_page = application.socketio.test_client(
            application.app,
            flask_test_client=self.client,
        )
        paired = application.socketio.test_client(
            application.app,
            flask_test_client=application.app.test_client(),
        )
        other = application.socketio.test_client(
            application.app,
            flask_test_client=application.app.test_client(),
        )
        try:
            room_page.emit(
                "join",
                {
                    "username": "甲",
                    "room": "volume-room",
                    "client_key": "paired-client-key-1234",
                },
            )
            paired.emit(
                "join",
                {
                    "username": "甲",
                    "room": "volume-room",
                    "role": "companion",
                    "client_key": "paired-client-key-1234",
                },
            )
            other.emit(
                "join",
                {
                    "username": "甲",
                    "room": "volume-room",
                    "role": "companion",
                    "client_key": "other-client-key-5678",
                },
            )
            room_page.get_received()
            paired.get_received()
            other.get_received()

            room_page.emit(
                "companion_command",
                {
                    "room": "volume-room",
                    "command": "set_volume",
                    "value": 0.35,
                },
            )
            paired_commands = [
                item["args"][0]
                for item in paired.get_received()
                if item["name"] == "companion_command"
            ]
            other_commands = [
                item
                for item in other.get_received()
                if item["name"] == "companion_command"
            ]
            self.assertEqual(
                paired_commands[-1],
                {"command": "set_volume", "value": 0.35},
            )
            self.assertEqual(other_commands, [])
        finally:
            room_page.disconnect()
            paired.disconnect()
            other.disconnect()

    def test_companions_can_sync_without_public_media_source(self):
        first = application.socketio.test_client(
            application.app,
            flask_test_client=self.client,
        )
        second = application.socketio.test_client(
            application.app,
            flask_test_client=application.app.test_client(),
        )
        try:
            first.emit(
                "join",
                {
                    "username": "私人测试甲",
                    "room": "private-sync-room",
                    "role": "companion",
                },
            )
            second.emit(
                "join",
                {
                    "username": "私人测试乙",
                    "room": "private-sync-room",
                    "role": "companion",
                },
            )
            first.get_received()
            second.get_received()

            first.emit(
                "video_event",
                {
                    "room": "private-sync-room",
                    "type": "play",
                    "time": 18.5,
                },
            )
            sync_events = [
                item["args"][0]
                for item in second.get_received()
                if item["name"] == "sync_video"
            ]
            self.assertEqual(sync_events[-1]["type"], "play")
            self.assertEqual(sync_events[-1]["time"], 18.5)
            self.assertEqual(sync_events[-1]["username"], "私人测试甲")

            second.emit("request_room_state", {"room": "private-sync-room"})
            room_states = [
                item["args"][0]
                for item in second.get_received()
                if item["name"] == "room_state"
            ]
            self.assertTrue(room_states[-1]["external_playback"])
            self.assertTrue(room_states[-1]["playing"])
            self.assertGreaterEqual(room_states[-1]["time"], 18.5)
            self.assertLess(room_states[-1]["time"], 19.5)
        finally:
            first.disconnect()
            second.disconnect()

    def test_latency_probe_and_room_buffering_resume(self):
        first = application.socketio.test_client(
            application.app,
            flask_test_client=application.app.test_client(),
        )
        second = application.socketio.test_client(
            application.app,
            flask_test_client=application.app.test_client(),
        )
        try:
            first.emit("join", {"username": "甲", "room": "sync-room"})
            second.emit("join", {"username": "乙", "room": "sync-room"})
            first.emit(
                "video_event",
                {
                    "room": "sync-room",
                    "type": "change_source",
                    "time": 0,
                    "source": direct_source(),
                },
            )
            first.emit(
                "video_event",
                {"room": "sync-room", "type": "play", "time": 5},
            )
            first.get_received()
            second.get_received()

            sent_at = int(time.time() * 1000)
            second.emit(
                "sync_ping",
                {"room": "sync-room", "client_time": sent_at},
            )
            pong_events = [
                item["args"][0]
                for item in second.get_received()
                if item["name"] == "sync_pong"
            ]
            self.assertEqual(pong_events[-1]["client_time"], sent_at)
            self.assertIsInstance(pong_events[-1]["server_time"], float)

            second.emit(
                "buffering_event",
                {"room": "sync-room", "active": True, "time": 4.5},
            )
            paused_events = [
                item["args"][0]
                for item in first.get_received()
                if item["name"] == "buffering_state"
            ]
            self.assertTrue(paused_events[-1]["active"])
            self.assertEqual(paused_events[-1]["buffering_users"], ["乙"])
            self.assertGreaterEqual(paused_events[-1]["time"], 5)

            second.emit(
                "buffering_event",
                {"room": "sync-room", "active": False, "time": 5},
            )
            resumed_events = [
                item["args"][0]
                for item in first.get_received()
                if item["name"] == "buffering_state"
            ]
            resumed = resumed_events[-1]
            self.assertFalse(resumed["active"])
            self.assertTrue(resumed["playing"])
            self.assertGreater(resumed["resume_at"], resumed["server_time"])
        finally:
            first.disconnect()
            second.disconnect()

    def test_multi_member_call_signaling(self):
        first = application.socketio.test_client(
            application.app,
            flask_test_client=application.app.test_client(),
        )
        second = application.socketio.test_client(
            application.app,
            flask_test_client=application.app.test_client(),
        )
        try:
            first.emit("join", {"username": "甲", "room": "call-room"})
            second.emit("join", {"username": "乙", "room": "call-room"})
            first.get_received()
            second.get_received()

            first.emit("call_join", {"room": "call-room"})
            first_ready = [
                item["args"][0]
                for item in first.get_received()
                if item["name"] == "call_ready"
            ][-1]
            first_id = first_ready["self_id"]
            self.assertEqual(first_ready["members"], [])
            self.assertTrue(first_ready["ice_servers"])
            self.assertEqual(
                first_ready["turn_configured"],
                application.TURN_CONFIGURED,
            )

            second.emit("call_join", {"room": "call-room"})
            second_received = second.get_received()
            second_ready = [
                item["args"][0]
                for item in second_received
                if item["name"] == "call_ready"
            ][-1]
            second_id = second_ready["self_id"]
            self.assertEqual(second_ready["members"][0]["id"], first_id)

            first.get_received()
            second.emit(
                "webrtc_offer",
                {
                    "room": "call-room",
                    "target": first_id,
                    "description": {"type": "offer", "sdp": "test-sdp"},
                },
            )
            offers = [
                item["args"][0]
                for item in first.get_received()
                if item["name"] == "webrtc_offer"
            ]
            self.assertEqual(offers[-1]["from"], second_id)
            self.assertEqual(offers[-1]["description"]["type"], "offer")

            second.emit(
                "call_mute",
                {"room": "call-room", "muted": True},
            )
            updates = [
                item["args"][0]
                for item in first.get_received()
                if item["name"] == "call_member_updated"
            ]
            self.assertEqual(updates[-1], {"id": second_id, "muted": True})
        finally:
            first.disconnect()
            second.disconnect()

    def test_direct_source_switch_preserves_room_position(self):
        first = application.socketio.test_client(
            application.app,
            flask_test_client=application.app.test_client(),
        )
        second = application.socketio.test_client(
            application.app,
            flask_test_client=application.app.test_client(),
        )
        try:
            first.emit("join", {"username": "甲", "room": "direct-room"})
            second.emit("join", {"username": "乙", "room": "direct-room"})
            first.get_received()
            second.get_received()

            first.emit(
                "video_event",
                {
                    "room": "direct-room",
                    "type": "change_source",
                    "time": 0,
                    "source": direct_source("https://cdn.example.com/source.mp4"),
                },
            )
            first.emit(
                "video_event",
                {
                    "room": "direct-room",
                    "type": "change_source",
                    "time": 42.25,
                    "source": direct_source("https://cdn.example.com/master.m3u8"),
                    "preserve_position": True,
                    "resume_playing": True,
                },
            )
            switches = [
                item["args"][0]
                for item in second.get_received()
                if item["name"] == "sync_video"
                and item["args"][0]["type"] == "change_source"
            ]
            latest = switches[-1]
            self.assertTrue(latest["preserve_position"])
            self.assertTrue(latest["playing"])
            self.assertEqual(latest["time"], 42.25)
            self.assertEqual(latest["source"]["mode"], "direct_media")

            second.emit("request_room_state", {"room": "direct-room"})
            states = [
                item["args"][0]
                for item in second.get_received()
                if item["name"] == "room_state"
            ]
            self.assertTrue(states[-1]["playing"])
            self.assertGreaterEqual(states[-1]["time"], 42.25)
            self.assertEqual(
                states[-1]["media_source"]["media_url"],
                "https://cdn.example.com/master.m3u8",
            )
        finally:
            first.disconnect()
            second.disconnect()

    def test_legacy_socket_source_is_ignored(self):
        client = application.socketio.test_client(
            application.app,
            flask_test_client=self.client,
        )
        try:
            client.emit("join", {"username": "甲", "room": "legacy-room"})
            client.get_received()
            client.emit(
                "video_event",
                {
                    "room": "legacy-room",
                    "type": "change_source",
                    "time": 0,
                    "src": "/static/uploads/old.mp4",
                },
            )
            client.emit("request_room_state", {"room": "legacy-room"})
            states = [
                item
                for item in client.get_received()
                if item["name"] == "room_state"
            ]
            self.assertEqual(states, [])
        finally:
            client.disconnect()

    def test_unapproved_media_cannot_be_injected_through_socket(self):
        client = application.socketio.test_client(
            application.app,
            flask_test_client=self.client,
        )
        try:
            client.emit("join", {"username": "测试者", "room": "blocked-room"})
            client.get_received()
            forged_source = {
                "mode": "direct_media",
                "provider_key": "direct",
                "provider_name": "伪造授权媒体",
                "page_url": "https://evil.example/member.mp4",
                "media_url": "https://evil.example/member.mp4",
            }
            client.emit(
                "video_event",
                {
                    "room": "blocked-room",
                    "type": "change_source",
                    "time": 0,
                    "source": forged_source,
                },
            )
            client.emit("request_room_state", {"room": "blocked-room"})
            states = [
                item
                for item in client.get_received()
                if item["name"] == "room_state"
            ]
            self.assertEqual(states, [])
        finally:
            client.disconnect()


if __name__ == "__main__":
    unittest.main()
