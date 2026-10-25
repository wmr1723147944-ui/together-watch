import os
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, unquote, urlparse

import app as application
from source_discovery import (
    FREE_SOURCES, OPEN_FILMS, SEARCH_PROVIDERS, SOURCE_TYPES, discovery_context, is_search_page,
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
        self.assertEqual(discovery_context()["discovery_count"], 7)
        for film in OPEN_FILMS:
            self.assertNotIn("media_url", film)
            self.assertNotIn("play_url", film)
            self.assertTrue(film["evidence_url"].startswith("https://"))
            self.assertTrue(film["license_url"].startswith("https://creativecommons.org/"))

    def test_navigation_metadata_distinguishes_free_access_from_quality_and_rights(self):
        self.assertEqual(len({s["id"] for s in FREE_SOURCES}), len(FREE_SOURCES))
        self.assertEqual(discovery_context()["discovery_source_count"], 6)
        for source in FREE_SOURCES:
            for field in ("name", "description", "access", "region", "quality_note"):
                self.assertTrue(source[field])
            self.assertTrue(source["genres"])
            self.assertTrue(set(source["genres"]) <= set(SOURCE_TYPES) - {"all"})
        for item in (*FREE_SOURCES, *OPEN_FILMS):
            for field in ("url", "page_url", "evidence_url", "quality_evidence_url"):
                if field in item:
                    parsed = urlparse(item[field])
                    self.assertEqual(parsed.scheme, "https")
                    self.assertIsNotNone(parsed.hostname)
                    self.assertIsNone(parsed.username)
                    self.assertIsNone(parsed.password)
            self.assertNotIn("media_url", item)
            self.assertNotIn("play_url", item)
            if item.get("has_4k_evidence"):
                self.assertTrue(item["quality_evidence_url"])
                self.assertTrue(item["quality_note"])

    def test_filters_require_explicit_4k_evidence_and_keep_navigation_separate_from_title_search(self):
        context = discovery_context(source_type="animation", quality="4k")
        self.assertEqual(context["discovery_source_count"], 0)
        self.assertEqual([f["id"] for f in context["discovery_films"] if f["matches"]],
                         ["big-buck-bunny", "glass-half"])
        context = discovery_context(source_type="series", quality="4k")
        self.assertEqual([s["id"] for s in context["discovery_sources"] if s["matches"]], ["cctv-4k"])
        # A portal is a way to search at the source, not a result for this title.
        context = discovery_context("nonexistent-title", source_type="animation")
        self.assertEqual(context["discovery_count"], 0)
        self.assertGreater(context["discovery_source_count"], 0)
        self.assertTrue(all("animation" in s["genres"] for s in context["discovery_sources"] if s["matches"]))
        context = discovery_context("bunny", source_type="series", quality="4k")
        self.assertEqual(context["discovery_count"], 1)  # Genre is explicitly navigation-only.
        context = discovery_context(source_type="<script>", quality="1080p")
        self.assertEqual(context["discovery_source_type"], "all")
        self.assertEqual(context["discovery_quality"], "all")
        self.assertEqual(context["discovery_source_count"], 6)

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
            if route.startswith('/room/'):
                self.assertIn("这是搜索入口，不是影片结果", html)
                self.assertIn("具体影片文件、字幕和兼容性尚未核验", html)
            else:
                self.assertIn('catalog-browser.js', html)
                self.assertIn('搜索结果', html)
                self.assertNotIn('data-directory-site=', html)
        response = self.client.get('/discover', query_string={"q": '\"><script>alert(1)</script>'})
        html = response.get_data(as_text=True)
        self.assertNotIn('<script>alert(1)</script>', html)
        self.assertIn("&lt;script&gt;", html)
        self.assertEqual(response.headers["Referrer-Policy"], "no-referrer")
        self.assertIn("script-src 'self'", response.headers["Content-Security-Policy"])
        self.assertIn('referrerpolicy="no-referrer"', html)

    def test_home_is_offline_rendered_and_no_javascript_fallback_is_honest(self):
        with patch.object(application.requests, "get", side_effect=AssertionError("must stay offline")):
            html = self.client.get('/discover?q=sintel').get_data(as_text=True)
        self.assertIn('value="sintel"', html)
        self.assertIn('请启用 JavaScript 以搜索影片和查看集数', html)
        self.assertIn('来自公开片单', html)
        self.assertNotIn('本地目录匹配', html)
        self.assertIn('target="_self"', html)

    def test_filters_work_without_javascript_and_have_honest_empty_states(self):
        # The legacy room tool still offers navigation filters. Home no longer
        # renders this directory; its categories filter recommendations only.
        from flask import render_template
        with patch.object(application.requests, "get", side_effect=AssertionError("must stay offline")):
            with application.app.test_request_context('/room/filters'):
                html = render_template('_source_discovery.html', **application.source_discovery_context(source_type='animation', quality='4k'))
        self.assertIn('value="animation" selected', html)
        self.assertIn('value="4k" selected', html)
        self.assertIn('导航显示 0 / 6 个入口', html)
        self.assertIn('本地目录匹配 2 / 7 部', html)
        self.assertIn('<p id="discoverySourceEmpty" >', html)
        self.assertIn('片目与地区限制以原站为准', html)
        self.assertIn('超分辨率不等于原生 4K', html)
        self.assertIn('不会放行新域名', html)
        self.assertIn('data-has-4k="false" hidden', html)

    def test_search_never_modifies_room_or_playback_allowlists(self):
        with patch.dict(application.room_states, {}, clear=True):
            before_media = application.AUTHORIZED_MEDIA_HOSTS
            before_page = application.AUTHORIZED_PAGE_HOSTS
            self.client.get('/discover?q=Sintel&type=series&quality=4k')
            self.assertEqual(application.room_states, {})
            self.assertEqual(application.AUTHORIZED_MEDIA_HOSTS, before_media)
            self.assertEqual(application.AUTHORIZED_PAGE_HOSTS, before_page)

    def test_disabled_sources_disappear_from_all_entry_points(self):
        with patch.dict(os.environ, {
            "DISCOVERY_DISABLED_PROVIDERS": "bilibili,tencent,youku",
            "DISCOVERY_DISABLED_FILMS": ",".join(f["id"] for f in OPEN_FILMS),
            "DISCOVERY_DISABLED_SOURCES": ",".join(s["id"] for s in FREE_SOURCES),
        }):
            for route in ("/", "/room/search-test", "/discover"):
                html = self.client.get(route).get_data(as_text=True)
                self.assertNotIn("data-search-base=", html)
                self.assertNotIn("data-search-text=", html)
                self.assertNotIn("data-source-id=", html)
                if route.startswith('/room/'):
                    self.assertIn("平台搜索入口暂未开放", html)
                    self.assertIn("本地目录匹配 0 / 0 部", html)
                    self.assertIn("导航显示 0 / 0 个入口", html)
                else:
                    self.assertIn('data-catalog-mode="films"', html)

    def test_compose_passes_source_disable_settings_into_container(self):
        root = Path(__file__).resolve().parents[1]
        compose = (root / "compose.yaml").read_text(encoding="utf-8")
        example = (root / ".env.server.example").read_text(encoding="utf-8")
        for key in ("DISCOVERY_DISABLED_PROVIDERS", "DISCOVERY_DISABLED_FILMS", "DISCOVERY_DISABLED_SOURCES"):
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
