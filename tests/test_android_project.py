from pathlib import Path
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "android-app"


class AndroidProjectTests(unittest.TestCase):
    def test_home_browses_before_identity_but_selected_episode_waits_for_consent(self):
        activity = (ANDROID / "app/src/main/java/cloud/watchtogethernow/mobile/MainActivity.java").read_text(encoding="utf-8")
        startup = activity.split('protected void onCreate', 1)[1].split('private void bindViews', 1)[0]
        self.assertIn('bindActions();', startup)
        self.assertIn('if (!Intent.ACTION_SEND.equals(getIntent().getAction())) showFinder();', startup)
        selection = activity.split('private void chooseSelection(', 1)[1].split('boolean change=', 1)[0]
        self.assertIn('!consentCheck.isChecked()', selection)
        self.assertIn('showSetup();pendingSetupSelection=selection', selection)
        self.assertIn('if(selected.page.equals(videoUrl)) {chooseSelection(selected);return;}', activity)
        self.assertIn('uri.toString().equals(SERVER_ORIGIN+"/#roomEntry")', activity)
        self.assertIn('statusText.setVisibility(View.VISIBLE)', activity)

    def test_android_entry_preserves_invitation_and_legacy_uses_local_sync(self):
        activity = (ANDROID / "app/src/main/java/cloud/watchtogethernow/mobile/MainActivity.java").read_text(encoding="utf-8")
        find_action = activity.split('findViewById(R.id.findButton).setOnClickListener', 1)[1].split('findViewById(R.id.findAgainButton)', 1)[0]
        self.assertIn('roomInput.getText()', find_action)
        self.assertIn('startSession()', find_action)
        selection = activity.split('private void chooseSelection(', 1)[1].split('boolean change=', 1)[0]
        self.assertIn('startSession();return;', selection)
        self.assertNotIn('nativePlayer.isActive() || programRevision==0', activity)
        self.assertNotIn('fetchAndInjectHelper(generation, url);', activity)
        self.assertIn("currentEpisode('kanju')", activity)
        self.assertIn('R.id.setupStatus', activity)

    def test_web_player_uses_compiled_injection_and_scoped_mobile_layout(self):
        activity = (ANDROID / "app/src/main/java/cloud/watchtogethernow/mobile/MainActivity.java").read_text(encoding="utf-8")
        wrapper = (ANDROID / "app/src/main/assets/android-web-sync.js").read_text(encoding="utf-8")
        layout = (ANDROID / "app/src/main/assets/android-page-layout.js").read_text(encoding="utf-8")
        self.assertIn("WebPlayerScripts.sample(webSyncScript,playerAgent)", activity)
        self.assertNotIn(".eval(", wrapper)
        self.assertIn("settings.setUseWideViewPort(true)", activity)
        self.assertIn("WebPlayerScripts.diagnostic(reason)", activity)
        self.assertIn("document.getElementById('mobilePlayerStatus')", activity)
        self.assertIn("['kanju.ai','www.kanju.ai']", layout)
        self.assertIn("location.pathname.startsWith('/player/')", layout)
        self.assertIn("@media (max-width: 700px)", layout)
        self.assertNotIn("display: none", layout)

    def test_managed_room_flow_and_revision_guard_are_wired(self):
        activity = (ANDROID / "app/src/main/java/cloud/watchtogethernow/mobile/MainActivity.java").read_text(encoding="utf-8")
        layout = (ANDROID / "app/src/main/res/layout/activity_main.xml").read_text(encoding="utf-8")
        build = (ANDROID / "app/build.gradle").read_text(encoding="utf-8")
        for text in ('ProgramPolicy.handoff', 'validatedProgram', 'b.applyProgram(', 'programRevision>0', 'PlaybackBoundary.sample', 'PlaybackBoundary.command', 'request.hasGesture()'):
            self.assertIn(text, activity)
        for control in ('findButton', 'findAgainButton', 'pickPageButton', 'finderToolbar'):
            self.assertIn('@+id/' + control, layout)
        self.assertIn('prepareSharedPlayerAssets', build)
        self.assertIn("include 'player-agent.js'", build)
        self.assertIn("include 'catalog-adapters.js'", build)

    def test_microphone_rechecks_current_room_after_android_prompt(self):
        activity = (ANDROID / "app/src/main/java/cloud/watchtogethernow/mobile/MainActivity.java").read_text(encoding="utf-8")
        callback = activity.split('public void onRequestPermissionsResult', 1)[1].split('private void fetchAndInjectHelper', 1)[0]
        self.assertIn('foreground && sessionActive && trustedRoomPage()', callback)
        self.assertIn('request.getOrigin()', callback)
        self.assertIn('cancelPendingMicrophone();pendingAudioPermission = request;', activity)
        self.assertIn('runOnUiThread(request::deny)', activity)

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
        self.assertIn("android.permission.MODIFY_AUDIO_SETTINGS", manifest)
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
