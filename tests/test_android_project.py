from pathlib import Path
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "android-app"


class AndroidProjectTests(unittest.TestCase):
    def test_android_xml_files_are_well_formed(self):
        xml_files = list((ANDROID / "app" / "src" / "main").rglob("*.xml"))
        self.assertGreaterEqual(len(xml_files), 8)
        for path in xml_files:
            with self.subTest(path=path):
                ET.parse(path)

    def test_manifest_uses_https_and_scoped_microphone(self):
        manifest = (
            ANDROID / "app" / "src" / "main" / "AndroidManifest.xml"
        ).read_text(encoding="utf-8")
        security = (
            ANDROID / "app" / "src" / "main" / "res" / "xml"
            / "network_security_config.xml"
        ).read_text(encoding="utf-8")
        activity = (
            ANDROID / "app" / "src" / "main" / "java" / "cloud"
            / "watchtogethernow" / "mobile" / "MainActivity.java"
        ).read_text(encoding="utf-8")

        self.assertIn("android.permission.INTERNET", manifest)
        self.assertIn("android.permission.RECORD_AUDIO", manifest)
        self.assertIn('android:usesCleartextTraffic="false"', manifest)
        self.assertIn('cleartextTrafficPermitted="false"', security)
        self.assertIn("UrlPolicy.isTrustedServerUrl(request.getOrigin()", activity)
        self.assertNotIn("addJavascriptInterface", activity)

    def test_mobile_app_reuses_public_helper_without_native_bridge(self):
        activity = (
            ANDROID / "app" / "src" / "main" / "java" / "cloud"
            / "watchtogethernow" / "mobile" / "MainActivity.java"
        ).read_text(encoding="utf-8")
        helper = (ROOT / "static" / "js" / "bookmarklet.js").read_text(encoding="utf-8")
        workflow = (ROOT / ".github" / "workflows" / "android.yml").read_text(
            encoding="utf-8"
        )

        self.assertIn("TogetherWatchBookmarklet?.start", activity)
        self.assertIn("start: startTogetherWatchBookmark", helper)
        self.assertIn("gradle -p android-app :app:assembleDebug", workflow)
        self.assertIn("app-debug.apk", workflow)


if __name__ == "__main__":
    unittest.main()
