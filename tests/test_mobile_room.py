import unittest

import app as application


class MobileRoomTests(unittest.TestCase):
    def setUp(self):
        application.app.config.update(TESTING=True)
        application.rate_buckets.clear()
        self.clients = []
        self.addCleanup(self.disconnect_clients)

    def disconnect_clients(self):
        for client in self.clients:
            if client.is_connected():
                client.disconnect()

    def connect(self, room, key="native-mobile-test-123456", role="companion"):
        client = application.socketio.test_client(application.app)
        self.clients.append(client)
        client.emit("join", {"room": room, "username": "手机测试", "role": role, "client_key": key})
        return client

    def test_mobile_room_uses_legal_gate_local_scripts_and_no_inline_handlers(self):
        response = application.app.test_client().get("/mobile-room/mobile-route-test")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('id="legalNoticeVersion"', html)
        self.assertIn("/static/js/room-gate.js", html)
        self.assertIn("/static/js/native-sync.js", html)
        self.assertIn("/static/js/voice-call.js", html)
        self.assertNotIn("onsubmit=", html)
        self.assertIn("default-src 'self'", response.headers["Content-Security-Policy"])
        self.assertEqual(application.app.test_client().get("/mobile-room/%3Cscript%3E").status_code, 404)

    def test_empty_room_has_explicit_acknowledgement(self):
        client = self.connect("native-empty-room-test")
        reply = client.emit("request_room_state", {"room": "native-empty-room-test"}, callback=True)
        self.assertEqual(reply, {"ok": True, "state": None})

    def test_unjoined_client_cannot_read_room_state(self):
        client = application.socketio.test_client(application.app)
        self.clients.append(client)
        reply = client.emit("request_room_state", {"room": "native-no-membership"}, callback=True)
        self.assertNotIsInstance(reply, dict)

    def test_native_controls_are_compatible_with_existing_companions(self):
        room = "native-state-room-test"
        first = self.connect(room)
        second = self.connect(room, key="native-second-user-123456")
        first.get_received()
        second.get_received()
        first.emit("video_event", {"room": room, "type": "pause", "time": 75, "speed": 1})
        reply = second.emit("request_room_state", {"room": room}, callback=True)
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["state"]["time"], 75)
        self.assertFalse(reply["state"]["playing"])
        self.assertTrue(reply["state"]["external_playback"])
        pushed = [event["args"][0] for event in second.get_received() if event["name"] == "room_state"]
        self.assertEqual(pushed[-1], reply["state"])
        second.emit("video_event", {"room": room, "type": "seek", "time": 150, "speed": 1})
        synced = [event["args"][0] for event in first.get_received() if event["name"] == "sync_video"]
        self.assertEqual(synced[-1]["time"], 150)
        self.assertGreater(synced[-1]["revision"], reply["state"]["revision"])


if __name__ == "__main__":
    unittest.main()
