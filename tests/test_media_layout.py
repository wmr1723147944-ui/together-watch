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
        self.assertNotIn('data-live-source="ddys"', page)
        self.assertIn('data-live-source="pkavi"', page)
        self.assertIn('id="catalogFeedGrid"', page)
        self.assertIn('catalog-feed.js', page)
        self.assertNotIn('data-discovery-query="Sintel"', page)
        self.assertIn('id="discoveryWelcome"', page)
        self.assertNotIn('href="https://img.ddys.io', page)

    def test_client_header_inset_remains_aligned_and_mobile_room_keeps_controls(self):
        root = Path(__file__).resolve().parents[1]
        css = (root / "desktop-app/ui/shell.css").read_text(encoding="utf-8")
        self.assertIn("header { height: 72px", css)
        self.assertIn("#tools { height: 56px", css)
        self.assertIn("#tools.expanded { height:256px", css)
        self.assertIn("#finderTools { height:128px", css)
        policy = (root / "desktop-app/src/policy.cjs").read_text(encoding="utf-8")
        self.assertIn("const top = full ? 0 : expanded ? 328 : 128", policy)
        room = self.client.get("/mobile-room/layout-test").text
        for identifier in ["chatInput", "sendBtn", "mobileVideoVolume", "joinCallBtn", "muteCallBtn", "leaveCallBtn"]:
            self.assertIn(f'id="{identifier}"', room)
        self.assertIn("client-room-theme.css", room)
        self.assertIn('<details class="room-audio-options">', room)

    def test_catalog_keeps_one_navigation_search_and_does_not_retheme_playback(self):
        for path in ('/', '/discover?q=测试'):
            html = self.client.get(path).text
            self.assertEqual(html.count('id="discoveryForm"'), 1)
            self.assertEqual(html.count('id="discoveryQuery"'), 1)
            self.assertLess(html.index('id="discoveryForm"'), html.index('<main'))
            self.assertIn('catalog-browser-light.css', html)
            self.assertIn('catalog-theater.css', html)
            self.assertEqual(html.count('class="cinema-sidebar"'), 1)
            self.assertNotIn('catalog-cinema.css', html)
            self.assertIn('id="catalogSpotlightGrid"', html)
            self.assertIn('aria-label="筛选推荐片单"', html)
            self.assertNotIn('data-live-source="fcma"', html)
            self.assertNotIn('data-live-source="ddys"', html)
        room = self.client.get('/room/layout-light-isolation').text
        self.assertNotIn('catalog-browser-light.css', room)
        self.assertNotIn('catalog-theater.css', room)

    def test_mobile_catalog_has_three_working_entries_not_fake_social_tabs(self):
        for path in ('/', '/discover'):
            html = self.client.get(path).text
            self.assertIn('catalog-mobile.css', html)
            self.assertIn('catalog-mobile.js', html)
            self.assertEqual(html.count('id="catalogMobileHome"'), 1)
            self.assertEqual(html.count('id="catalogMobileSearch"'), 1)
            self.assertIn('aria-label="一起看，加入朋友的房间"', html)
            self.assertIn('viewport-fit=cover', html)
            self.assertNotIn('>投稿<', html)
            self.assertNotIn('>动态<', html)
        for path in ('/room/mobile-ui-isolation', '/mobile-room/mobile-ui-isolation'):
            html = self.client.get(path).text
            self.assertNotIn('catalog-mobile.css', html)
            self.assertNotIn('catalogMobileHome', html)


if __name__ == "__main__":
    unittest.main()
