import json
import os
import unittest
from unittest.mock import patch

import app as application
import source_search as search
from source_discovery import is_search_page


ITEM = {"title": "星际穿越", "aka": "Interstellar", "slug": "interstellar",
        "year": 2014, "url": "/movie/interstellar", "type": "电影",
        "poster": "https://img.ddys.io/movies/interstellar.webp"}


class DdysSourceTests(unittest.TestCase):
    def setUp(self):
        search._cache.clear()
        application.rate_buckets.clear()
        self.provider = search.PROVIDERS["ddys"]
        self.client = application.app.test_client()

    def test_search_reads_only_public_metadata_and_matches_aliases(self):
        body = json.dumps({"success": True, "data": [ITEM, ITEM,
                           {**ITEM, "title": "其他推荐", "aka": "", "slug": "other", "url": "/movie/other"}]})
        rows = search.parse_results(self.provider, body, "Interstellar")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "星际穿越")
        self.assertEqual(rows[0]["year"], "2014")
        self.assertEqual(rows[0]["page_url"], "https://ddys.io/movie/interstellar")
        self.assertFalse(rows[0]["playback_verified"])
        self.assertNotIn("poster", rows[0])  # No third-party image requests on page load.

    def test_search_uses_documented_bounded_movie_query(self):
        with patch.object(search, "_fetch_path", return_value='{"success":true,"data":[]}') as fetch:
            result = search.search_provider("ddys", "星际穿越")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(fetch.call_args.args[1], "/api/v1/search?q=%E6%98%9F%E9%99%85%E7%A9%BF%E8%B6%8A&type=movie&per_page=12")

    def test_rejects_foreign_credentials_redirects_and_mismatched_slugs(self):
        for url in ["http://ddys.io/movie/interstellar", "https://ddys.io.evil.test/movie/interstellar",
                    "https://user@ddys.io/movie/interstellar", "/movie/interstellar?redirect=bad",
                    "/movie/interstellar#bad", "/movie/../../admin", "/movie/%69nterstellar",
                    "/movie/" + "x" * 121]:
            self.assertIsNone(search.detail_url(self.provider, url), url)
        rows = search.parse_results(self.provider, json.dumps({"success": True, "data": [
            {**ITEM, "url": "https://evil.test/movie/interstellar"}, {**ITEM, "slug": "other"},
            {**ITEM, "slug": []}, None]}), "星际穿越")
        self.assertEqual(rows, [])

    def test_bad_json_or_failure_is_unavailable_not_an_empty_success(self):
        for body in ["null", "[]", '{"success":false,"data":[]}', '{"success":true,"data":{}}', "<h1>Access denied</h1>"]:
            search._cache.clear()
            with patch.object(search, "_fetch_path", return_value=body):
                self.assertEqual(search.search_provider("ddys", "test")["status"], "unavailable")

    def test_detail_is_honest_original_page_entry_without_media_or_html(self):
        body = json.dumps({"success": True, "data": {**ITEM, "online_sources_count": 9,
            "intro": "<p>一段简介</p><script>secret_script()</script><style>secret_css</style>",
            "media_url": "https://example.invalid/secret.mp4", "download": "secret_share"}})
        with patch.object(search, "_fetch_path", return_value=body) as fetch:
            result = search.load_detail("ddys", "https://ddys.io/movie/interstellar")
            self.assertEqual(fetch.call_args.args[1], "/api/v1/movies/interstellar")
            self.assertEqual(result["description"], "一段简介")
            self.assertEqual(result["selection_mode"], "original_page")
            self.assertEqual(len(result["episodes"]), 1)
            self.assertEqual(result["episodes"][0]["id"], "page")
            self.assertFalse(result["playback_verified"])
            self.assertNotIn("secret", str(result))
            self.assertNotIn(".mp4", str(result))
            result["episodes"].clear()
            self.assertEqual(len(search.load_detail("ddys", result["page_url"])["episodes"]), 1)
            self.assertEqual(fetch.call_count, 1)

    def test_no_online_source_and_wrong_movie_do_not_create_playable_episodes(self):
        for data, status in [({**ITEM, "online_sources_count": 0}, "no_episodes"),
                             ({**ITEM, "online_sources_count": True}, "no_episodes"),
                             ({**ITEM, "slug": "other", "online_sources_count": 9}, "unavailable"),
                             ([], "unavailable")]:
            search._cache.clear()
            with patch.object(search, "_fetch_path", return_value=json.dumps({"success": True, "data": data})):
                result = search.load_detail("ddys", "https://ddys.io/movie/interstellar")
            self.assertEqual(result["status"], status)
            self.assertEqual(result["episodes"], [])

    def test_legacy_identity_is_readable_but_new_discovery_is_retired(self):
        self.assertEqual(search.selection_page("ddys", "interstellar", "page"), "https://ddys.io/movie/interstellar")
        for item, episode in [("interstellar", "1"), ("other?url=evil", "page"), ("/evil", "page")]:
            self.assertIsNone(search.selection_path("ddys", item, episode))
        self.assertTrue(is_search_page("https://ddys.io/search?q=test"))
        self.assertEqual(self.client.get("/discover/play/ddys/interstellar/page").status_code, 404)
        with patch.dict(os.environ, {"DISCOVERY_DISABLED_SEARCH_SOURCES": "ddys"}):
            self.assertNotIn('data-live-source="ddys"', self.client.get("/discover").text)
            self.assertEqual(self.client.get("/discover/play/ddys/interstellar/page").status_code, 404)
            self.assertEqual(self.client.post("/api/discover/search", json={"source": "ddys", "q": "test"}).status_code, 400)

    def test_retirement_covers_all_public_entry_points_without_upstream_requests(self):
        # An empty deployment exclusion setting must not resurrect a retired source.
        with patch.dict(os.environ, {"DISCOVERY_DISABLED_SEARCH_SOURCES": ""}), \
                patch.object(search, '_fetch_path', side_effect=AssertionError('retired source requested')):
            sources = self.client.get('/api/discover/sources').json['sources']
            self.assertNotIn('ddys', {p['id'] for p in sources})
            self.assertTrue({'pkavi', 'kanju', 'cupfox', 'yhdmoe'} <= {p['id'] for p in sources})
            for path in ('/', '/discover', '/room/test-retired-source'):
                page = self.client.get(path)
                self.assertEqual(page.status_code, 200)
                self.assertNotIn('data-live-source="ddys"', page.text)
                self.assertNotIn('data-feed-source="ddys"', page.text)
                self.assertNotIn('https://img.ddys.io', page.text)
            self.assertEqual(self.client.post('/api/discover/search', json={'source': 'ddys', 'q': '测试'}).status_code, 400)
            self.assertEqual(self.client.post('/api/discover/detail', json={'source': 'ddys', 'page_url': 'https://ddys.io/movie/interstellar'}).status_code, 400)
            self.assertEqual(self.client.get('/api/discover/feed?source=ddys&category=all&page=1').status_code, 400)
            self.assertEqual(self.client.get('/discover/play/ddys/interstellar/page').status_code, 404)
            self.assertEqual(self.client.post('/api/watch-rooms', json={'selection': {'source': 'ddys', 'item': 'interstellar', 'episode': 'page'}}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
