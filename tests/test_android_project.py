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
        self.assertIn(":app:assembleDebug", workflow)
        self.assertIn("app-debug.apk", workflow)

    def test_native_player_has_modern_back_navigation_and_lint_gate(self):
        activity = (ANDROID / "app/src/main/java/cloud/watchtogethernow/mobile/MainActivity.java").read_text(encoding="utf-8")
        workflow = (ROOT / ".github/workflows/android.yml").read_text(encoding="utf-8")
        self.assertIn("extends ComponentActivity", activity)
        self.assertIn("getOnBackPressedDispatcher().addCallback", activity)
        self.assertNotIn("public void onBackPressed()", activity)
        self.assertIn(":app:lintDebug", workflow)
        self.assertIn("packages: platform-tools", workflow)
        backup = ET.parse(ANDROID / "app/src/main/res/xml/data_extraction_rules.xml").getroot()
        for section in ("cloud-backup", "device-transfer"):
            self.assertIsNotNone(backup.find(f"./{section}/exclude[@domain='root'][@path='.']"))

    def test_native_fullscreen_uses_overlay_and_restores_player(self):
        activity = (ANDROID / "app/src/main/java/cloud/watchtogethernow/mobile/MainActivity.java").read_text(encoding="utf-8")
        self.assertIn("fullscreenContainer.addView(nativePlayerView", activity)
        self.assertIn("fullscreenContainer.removeView(nativePlayerView)", activity)
        self.assertIn("SCREEN_ORIENTATION_SENSOR_LANDSCAPE", activity)
        self.assertIn("bars.hide(WindowInsetsCompat.Type.systemBars())", activity)
        self.assertIn("bars.show(WindowInsetsCompat.Type.systemBars())", activity)
        self.assertIn("AspectRatioFrameLayout.RESIZE_MODE_ZOOM", activity)
        self.assertIn("AspectRatioFrameLayout.RESIZE_MODE_FIT", activity)
        self.assertIn("setFullscreenButtonState(false)", activity)


if __name__ == "__main__":
    unittest.main()
