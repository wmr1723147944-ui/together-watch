from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import unittest

import app as application


class Structure(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.forms, self.links, self.labels = [], [], [], []
        self.form_depth = self.max_form_depth = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.append(attrs["id"])
        if tag == "form":
            self.form_depth += 1
            self.max_form_depth = max(self.max_form_depth, self.form_depth)
            self.forms.append(attrs)
        if tag == "link" and attrs.get("rel") == "stylesheet":
            self.links.append(attrs.get("href", ""))
        if tag == "label" and attrs.get("for"):
            self.labels.append(attrs["for"])

    def handle_endtag(self, tag):
        if tag == "form":
            self.form_depth -= 1


class MediaLayoutTests(unittest.TestCase):
    def setUp(self):
        self.client = application.app.test_client()

    def test_pages_keep_unique_controls_and_valid_static_stylesheets(self):
        for path in ["/", "/discover", "/room/layout-test", "/mobile-room/layout-test"]:
            page = self.client.get(path)
            self.assertEqual(page.status_code, 200)
            tree = Structure()
            tree.feed(page.text)
            self.assertFalse([key for key, count in Counter(tree.ids).items() if count > 1], path)
            self.assertLessEqual(tree.max_form_depth, 1, path)
            self.assertEqual(tree.form_depth, 0, path)
            for label in tree.labels:
                self.assertIn(label, tree.ids, path)
            for css in tree.links:
                with self.client.get(css) as response:
                    self.assertEqual(response.status_code, 200, css)
                    self.assertIn("text/css", response.content_type)

    def test_film_first_home_hides_room_form_until_invited_and_keeps_consent(self):
        page = self.client.get("/").text
        for identifier in ["loginForm", "username", "roomId", "complianceConsent", "formError", "createRoomBtn", "joinRoomBtn", "roomEntry", "discoveryForm"]:
            self.assertIn(f'id="{identifier}"', page)
        self.assertIn('data-catalog-mode="films"', page)
        self.assertIn('<dialog id="roomEntry"', page)
        self.assertNotIn('class="home-intro"', page)
        self.assertNotIn('discovery-source-settings', page)
        self.assertNotIn('data-directory-site=', page)
        self.assertIn('href="/#roomEntry"', page)
        self.assertIn('data-live-source="ddys"', page)
        self.assertIn('data-discovery-query="Sintel"', page)
        self.assertIn('id="discoveryWelcome"', page)
        self.assertNotIn('href="https://img.ddys.io', page)

    def test_client_header_inset_remains_aligned_and_mobile_room_keeps_controls(self):
        root = Path(__file__).resolve().parents[1]
        css = (root / "desktop-app/ui/shell.css").read_text(encoding="utf-8")
        self.assertIn("header { height: 72px", css)
        self.assertIn("#tools { height: 128px", css)
        self.assertIn("#finderTools { height:128px", css)
        policy = (root / "desktop-app/src/policy.cjs").read_text(encoding="utf-8")
        self.assertIn("const top = full ? 0 : 200", policy)  # 72 + 128; finder and player agree.
        room = self.client.get("/mobile-room/layout-test").text
        for identifier in ["chatInput", "sendBtn", "mobileVideoVolume", "joinCallBtn", "muteCallBtn", "leaveCallBtn"]:
            self.assertIn(f'id="{identifier}"', room)
        self.assertIn("client-room-theme.css", room)


if __name__ == "__main__":
    unittest.main()
