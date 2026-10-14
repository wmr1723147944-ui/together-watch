import os
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, unquote, urlparse

import app as application
from source_discovery import (
    OPEN_FILMS, SEARCH_PROVIDERS, discovery_context, is_search_page,
    normalize_query, search_url,
)


class SourceDiscoveryTests(unittest.TestCase):
    def setUp(self):
        application.app.config.update(TESTING=True)
        self.client = application.app.test_client()

    def test_query_normalization_and_limits(self):
        self.assertEqual(normalize_query("  ＳＩＮＴＥＬ\n\t  春天\x00  "), "SINTEL 春天")
        self.assertEqual(len(normalize_query("春" * 300)), 80)
        self.assertEqual(len(normalize_query("😀" * 100)), 80)

    def test_local_search_is_real_but_never_a_playable_catalog(self):
        self.assertEqual([f["id"] for f in discovery_context("辛特尔")["discovery_films"] if f["matches"]], ["sintel"])
        self.assertEqual(discovery_context("ＢＩＧ bunny")["discovery_count"], 1)
        self.assertEqual(discovery_context("not-in-our-catalog")["discovery_count"], 0)
        self.assertEqual(discovery_context()["discovery_count"], 5)
        for film in OPEN_FILMS:
            self.assertNotIn("media_url", film)
            self.assertNotIn("play_url", film)
            self.assertTrue(film["evidence_url"].startswith("https://"))
            self.assertTrue(film["license_url"].startswith("https://creativecommons.org/"))

    def test_official_search_encodes_query_without_changing_host(self):
        query = '春天 &q=other # / ? <script> "'
        for provider in SEARCH_PROVIDERS:
            url = search_url(provider, query)
            self.assertEqual(urlparse(url).hostname, urlparse(provider["base"]).hostname)
            self.assertEqual(urlparse(url).fragment, "")
            if provider["param"]:
                self.assertEqual(parse_qs(urlparse(url).query), {provider["param"]: [query]})
            else:
                self.assertEqual(unquote(url[len(provider["base"]):]), query)
            self.assertEqual(search_url(provider, " \t"), provider["home"])

    def test_routes_escape_query_and_use_same_component(self):
        for route in ("/", "/room/search-test", "/discover"):
            response = self.client.get(route)
            html = response.get_data(as_text=True)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(html.count('id="sourceDiscovery"'), 1)
            self.assertIn("source-discovery.js", html)
            self.assertIn("这是搜索入口，不是影片结果", html)
            self.assertIn("具体影片文件、字幕和兼容性尚未核验", html)
        response = self.client.get('/discover', query_string={"q": '\"><script>alert(1)</script>'})
        html = response.get_data(as_text=True)
        self.assertNotIn('<script>alert(1)</script>', html)
        self.assertIn("&lt;script&gt;", html)
        self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")
        self.assertIn("script-src 'self'", response.headers["Content-Security-Policy"])
        self.assertIn('referrerpolicy="no-referrer"', html)

    def test_server_search_works_without_javascript_and_makes_no_remote_requests(self):
        with patch.object(application.requests, "get", side_effect=AssertionError("must stay offline")):
            html = self.client.get('/discover?q=sintel').get_data(as_text=True)
        self.assertIn("本地目录匹配 1 / 5 部", html)
        self.assertIn("keyword=sintel", html)
        self.assertIn('data-search-text="big buck bunny', html)
        self.assertIn('target="_self"', html)

    def test_search_never_modifies_room_or_playback_allowlists(self):
        with patch.dict(application.room_states, {}, clear=True):
            before_media = application.AUTHORIZED_MEDIA_HOSTS
            before_page = application.AUTHORIZED_PAGE_HOSTS
            self.client.get('/discover?q=Sintel')
            self.assertEqual(application.room_states, {})
            self.assertEqual(application.AUTHORIZED_MEDIA_HOSTS, before_media)
            self.assertEqual(application.AUTHORIZED_PAGE_HOSTS, before_page)

    def test_disabled_sources_disappear_from_all_entry_points(self):
        with patch.dict(os.environ, {
            "DISCOVERY_DISABLED_PROVIDERS": "bilibili,tencent,youku",
            "DISCOVERY_DISABLED_FILMS": ",".join(f["id"] for f in OPEN_FILMS),
        }):
            for route in ("/", "/room/search-test", "/discover"):
                html = self.client.get(route).get_data(as_text=True)
                self.assertNotIn("data-search-base=", html)
                self.assertNotIn("data-search-text=", html)
                self.assertIn("平台搜索入口暂未开放", html)
                self.assertIn("本地目录匹配 0 / 0 部", html)

    def test_compose_passes_source_disable_settings_into_container(self):
        root = Path(__file__).resolve().parents[1]
        compose = (root / "compose.yaml").read_text(encoding="utf-8")
        example = (root / ".env.server.example").read_text(encoding="utf-8")
        for key in ("DISCOVERY_DISABLED_PROVIDERS", "DISCOVERY_DISABLED_FILMS"):
            self.assertIn(f"{key}: ${{{key}:-}}", compose)
            self.assertIn(f"{key}=", example)

    def test_known_search_pages_are_not_accepted_as_playback_pages(self):
        with patch.object(application, "PUBLIC_LAUNCH_READY", True):
            for provider in SEARCH_PROVIDERS:
                url = search_url(provider, "Sintel")
                self.assertTrue(is_search_page(url))
                with self.assertRaises(application.UnsafeURLError) as error:
                    application.resolve_media_source(url)
                self.assertEqual(error.exception.code, "search_page_not_playable")
        self.assertFalse(is_search_page("https://www.bilibili.com/video/BV1xx411c7mD"))
        self.assertFalse(is_search_page("https://v.qq.com/x/cover/example.html"))
        self.assertFalse(is_search_page("https://search.bilibili.com.evil.example/all?keyword=x"))


if __name__ == "__main__":
    unittest.main()
