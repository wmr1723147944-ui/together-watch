from pathlib import Path
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "android-app"


class AndroidProjectTests(unittest.TestCase):
    def test_episode_picker_uses_current_program_and_preserves_owner_checks(self):
        java = (ANDROID / 'app/src/main/java/cloud/watchtogethernow/mobile/MainActivity.java').read_text(encoding='utf-8')
        entry = java.split('private void showCurrentEpisodes()',1)[1].split('private void showFinder(boolean',1)[0]
        self.assertIn('ownerKey.isEmpty()',entry)
        self.assertIn('episodePicker.show(programSelection)',entry)
        self.assertNotIn('showFinder()',entry)
        self.assertNotIn('exitNativeFullscreen()',entry)
        picker = (ANDROID / 'app/src/main/java/cloud/watchtogethernow/mobile/EpisodePickerController.java').read_text(encoding='utf-8')
        self.assertIn('attempt>=60',picker)
        self.assertIn('TogetherWatchCatalogNavigation.episodes(',picker)
        self.assertIn('window.__twMetadataQueue',picker)
        self.assertIn('next.item.equals(program.item)',picker)
        self.assertIn('request.hasGesture()',picker)
        self.assertNotIn('addJavascriptInterface',picker)
        self.assertNotIn('pauseLocally',picker)
        self.assertIn('episodes.setOnClickListener(v->showCurrentEpisodes())',java)
        self.assertIn('findViewById(R.id.findAgainButton).setOnClickListener(view -> showCurrentEpisodes())',java)

    def test_catalogue_query_does_not_reintroduce_jdk_only_regex_flags(self):
        # JVM unit tests accepted this flag; Android's ICU engine rejects it
        # before any original-site page is opened. Guard the platform boundary.
        java = ANDROID / 'app/src/main/java'
        for path in java.rglob('*.java'):
            with self.subTest(path=path.name):
                self.assertNotIn('(?U)', path.read_text(encoding='utf-8'))
        policy = (java / 'cloud/watchtogethernow/mobile/CatalogMetadataPolicy.java').read_text(encoding='utf-8')
        normalization = policy.split('static String normalizeQuery(', 1)[1].split('static JSONObject request(', 1)[0]
        self.assertNotIn('.replaceAll(', normalization)
        self.assertNotIn('Pattern.compile(', normalization)
        self.assertIn('Character.isSpaceChar(point)', normalization)
        self.assertIn('q=normalizeQuery(payload.getString("q"))', policy)

    def test_fullscreen_controls_expire_and_hold_cancels_on_lifecycle_changes(self):
        activity = (ANDROID / 'app/src/main/java/cloud/watchtogethernow/mobile/MainActivity.java').read_text(encoding='utf-8')
        for marker in ('postDelayed(hideFullscreenUi,2500)', 'removeCallbacks(hideFullscreenUi)',
                       'setContentDescription("退出全屏")', 'dispatchTouchEvent(MotionEvent event)',
                       'postDelayed(startPlayerHold,450)', 'MotionEvent.ACTION_CANCEL', 'MotionEvent.ACTION_POINTER_DOWN',
                       'touchesPlayerControl', 'playerTouchConsumed', 'webHoldScript("canHold")'):
            self.assertIn(marker, activity)
        for method in ('protected void onStop()', 'protected void onDestroy()', 'private void exitNativeFullscreen()', 'private void hideFullscreenVideo()'):
            body=activity.split(method,1)[1].split('\n    }',1)[0]
            self.assertIn('finishPlayerHold(false)',body)
        self.assertNotIn('exit.setText("退出全屏")',activity)

    def test_metadata_bridge_stays_in_catalogue_and_keeps_cookies_local(self):
        java = ANDROID / 'app/src/main/java/cloud/watchtogethernow/mobile'
        activity = (java / 'MainActivity.java').read_text(encoding='utf-8')
        controller = (java / 'CatalogMetadataController.java').read_text(encoding='utf-8')
        self.assertIn('catalogMetadata.navigation()', activity)
        self.assertIn('catalogMetadata.close()', activity)
        self.assertIn('foreground && finding && !originalFinderActive', activity)
        for marker in ('CatalogMetadataPolicy.catalogue', 'CatalogMetadataPolicy.request',
                       'CatalogMetadataPolicy.allowed', 'documentToken.equals(job.token)',
                       'CookieManager.getInstance().flush()', 'setMediaPlaybackRequiresUserGesture(true)',
                       'request.deny()', 'h.cancel()', 'jobs.size()>=2'):
            self.assertIn(marker, controller)
        self.assertNotIn('.addJavascriptInterface(', controller)
        self.assertNotIn('.getCookie(', controller)
        self.assertNotIn('setAcceptFileSchemeCookies', controller)
        for marker in ('interactive?178000:28000', 'job.retried', 'job.partial!=null',
                       'handler.removeCallbacks(job.reload)', 'page.view.getProgress()==100'):
            self.assertIn(marker, controller)
        self.assertNotIn("document.readyState==='loading'", controller)
        for marker in ('queryHost.addView(page.view,0', 'setOffscreenPreRaster(!interactive)',
                       'IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS', 'detach(job.page.view)',
                       'setOffscreenPreRaster(false)', 'setFocusable(interactive)'):
            self.assertIn(marker, controller)
        self.assertIn('this,catalogWebView,videoContainer,catalogScript', activity)

    def test_launcher_icons_adapt_to_round_masks_and_android_themed_icons(self):
        res = ANDROID / 'app/src/main/res'
        ns = '{http://schemas.android.com/apk/res/android}'
        manifest = ET.parse(ANDROID / 'app/src/main/AndroidManifest.xml').getroot().find('application')
        self.assertEqual(manifest.get(ns+'icon'), '@mipmap/ic_launcher')
        self.assertEqual(manifest.get(ns+'roundIcon'), '@mipmap/ic_launcher')
        for version in ('v26', 'v33'):
            tree = ET.parse(res / f'mipmap-anydpi-{version}/ic_launcher.xml').getroot()
            self.assertEqual(tree.tag, 'adaptive-icon')
            self.assertEqual(tree.find('foreground').get(ns+'drawable'), '@drawable/ic_launcher_foreground')
            self.assertEqual(tree.find('background').get(ns+'drawable'), '@color/launcher_background')
            if version == 'v33':
                self.assertEqual(tree.find('monochrome').get(ns+'drawable'), '@drawable/ic_launcher_monochrome')
        svg = ET.parse(ROOT / 'static/favicon.svg').getroot()
        paths = [p.get('d') for p in svg.iter('{http://www.w3.org/2000/svg}path')]
        vector = ET.parse(res / 'drawable/ic_launcher_foreground.xml').getroot()
        self.assertEqual([p.get(ns+'pathData') for p in vector.iter('path')], paths)
        group = vector.find('group')
        self.assertIsNotNone(group)
        self.assertEqual(group.get(ns+'scaleX'), '0.65')
        self.assertEqual(group.get(ns+'scaleY'), '0.65')
        self.assertEqual(group.get(ns+'pivotX'), '54')
        self.assertEqual(group.get(ns+'pivotY'), '54')
        monochrome = ET.parse(res / 'drawable/ic_launcher_monochrome.xml').getroot()
        mono_path = next(monochrome.iter('path'))
        self.assertEqual(mono_path.get(ns+'fillType'), 'evenOdd')
        self.assertEqual(mono_path.get(ns+'pathData'), ' '.join(paths))

    def test_catalogue_hides_duplicate_header_but_retains_room_and_original_site_navigation(self):
        activity = (ANDROID / 'app/src/main/java/cloud/watchtogethernow/mobile/MainActivity.java').read_text(encoding='utf-8')
        chrome = activity.split('private void updateCatalogChrome()', 1)[1].split('private void startSession()', 1)[0]
        self.assertIn('catalogue=finding && !originalFinderActive', chrome)
        self.assertIn('catalogue && !sessionActive?View.GONE:View.VISIBLE', chrome)
        self.assertIn('setAppearanceLightStatusBars(catalogue)', chrome)
        self.assertIn('setAppearanceLightNavigationBars(catalogue)', chrome)
        setup = activity.split('private void showSetup()', 1)[1].split('private void configureEntry', 1)[0]
        self.assertLess(setup.index('finding=false'), setup.index('updateCatalogChrome()'))
        controls = activity.split('private void updateRoomControls()', 1)[1].split('private void updateCatalogChrome()', 1)[0]
        self.assertIn('updateCatalogChrome()', controls)
        layout = (ANDROID / 'app/src/main/res/layout/activity_main.xml').read_text(encoding='utf-8')
        self.assertIn('@+id/navigationToolbar', layout)

    def test_room_actions_are_contextual_and_exit_requires_confirmation(self):
        activity = (ANDROID / 'app/src/main/java/cloud/watchtogethernow/mobile/MainActivity.java').read_text(encoding='utf-8')
        layout = (ANDROID / 'app/src/main/res/layout/activity_main.xml').read_text(encoding='utf-8')
        tree = ET.fromstring(layout)
        ids = {'a': 'http://schemas.android.com/apk/res/android'}
        toolbar = next(el for el in tree.iter('LinearLayout') if el.get('{'+ids['a']+'}id') == '@+id/browserToolbar')
        self.assertEqual([el.get('{'+ids['a']+'}id') for el in toolbar], ['@+id/findAgainButton', '@+id/inviteButton', '@+id/fullscreenButton'])
        self.assertNotIn('playbackToolbar', layout)
        self.assertIn('R.id.moreButton', activity)
        self.assertIn('setNegativeButton("继续观看",null)', activity)
        self.assertIn('setPositiveButton("离开房间"', activity)
        self.assertIn('actions.add(this::choosePlayback)', activity)
        self.assertIn('finding && originalFinderActive?View.VISIBLE:View.GONE', activity)

    def test_back_preserves_catalogue_original_finder_and_room(self):
        activity = (ANDROID / "app/src/main/java/cloud/watchtogethernow/mobile/MainActivity.java").read_text(encoding="utf-8")
        finder = activity.split('private void showFinder(boolean original)', 1)[1].split('private void pauseFinder', 1)[0]
        self.assertIn('if(catalogWebView.getUrl()==null)catalogWebView.loadUrl', finder)
        self.assertNotIn('videoWebView.loadUrl', finder)
        resume = activity.split('private void resumePlayback()', 1)[1].split('private void chooseCurrentPage', 1)[0]
        self.assertNotIn('.loadUrl(', resume)
        self.assertNotIn('startResolved', resume)
        back = activity.split('private void handleBackNavigation()', 1)[1].split('protected void onStop', 1)[0]
        self.assertIn('TogetherWatchCatalogNavigation?.back()', back)
        self.assertIn('originalFinderWebView.goBack()', back)
        self.assertIn('showPreviousFinder()', back)
        self.assertNotIn('showSetup()', back)
        self.assertNotIn('openProgramPage(', back)
        for view in ('catalogWebView', 'originalFinderWebView'):
            self.assertIn(view + '.destroy()', activity)
        layout = (ANDROID / 'app/src/main/res/layout/activity_main.xml').read_text(encoding='utf-8')
        for control in ('previousButton', 'setupBackButton'):
            self.assertIn('@+id/' + control, layout)

    def test_home_browses_before_identity_but_selected_episode_waits_for_consent(self):
        activity = (ANDROID / "app/src/main/java/cloud/watchtogethernow/mobile/MainActivity.java").read_text(encoding="utf-8")
        startup = activity.split('protected void onCreate', 1)[1].split('private void bindViews', 1)[0]
        self.assertIn('bindActions();', startup)
        self.assertIn('showFinder();', startup)
        self.assertIn('if (Intent.ACTION_SEND.equals(getIntent().getAction()))', startup)
        selection = activity.split('private void chooseSelection(', 1)[1].split('boolean change=', 1)[0]
        self.assertIn('!consentCheck.isChecked()', selection)
        self.assertIn('showSetup();pendingSetupSelection=selection', selection)
        self.assertIn('if(selected.page.equals(videoUrl)) {chooseSelection(selected);return;}', activity)
        self.assertIn('uri.toString().equals(SERVER_ORIGIN+"/#roomEntry")', activity)
        self.assertIn('statusText.setVisibility(View.VISIBLE)', activity)

    def test_android_entry_preserves_invitation_and_legacy_uses_local_sync(self):
        activity = (ANDROID / "app/src/main/java/cloud/watchtogethernow/mobile/MainActivity.java").read_text(encoding="utf-8")
        start = activity.split('private void startSession()', 1)[1].split('private boolean validateIdentity()', 1)[0]
        self.assertLess(start.index('final String requestedRoom=room'), start.index('pendingSetupSelection!=null'))
        self.assertIn('startResolved(requestedRoom,selected.page)', start)
        selection = activity.split('private void chooseSelection(', 1)[1].split('boolean change=', 1)[0]
        self.assertIn('if(!sessionActive)roomInput.setText("")', selection)
        self.assertNotIn('startSession();return;', selection)
        self.assertNotIn('nativePlayer.isActive() || programRevision==0', activity)
        self.assertNotIn('fetchAndInjectHelper(generation, url);', activity)
        self.assertIn("currentEpisode('kanju')", activity)
        self.assertIn('R.id.setupStatus', activity)

    def test_first_watch_is_compact_and_returning_selection_skips_entry(self):
        activity = (ANDROID / 'app/src/main/java/cloud/watchtogethernow/mobile/MainActivity.java').read_text(encoding='utf-8')
        layout = ET.fromstring((ANDROID / 'app/src/main/res/layout/activity_main.xml').read_text(encoding='utf-8'))
        attr = '{http://schemas.android.com/apk/res/android}'
        panel = next(el for el in layout.iter('ScrollView') if el.get(attr+'id') == '@+id/setupPanel')
        self.assertEqual(panel.get(attr+'layout_height'), 'wrap_content')
        self.assertEqual(panel.get(attr+'layout_gravity'), 'center')
        selection = activity.split('private void chooseSelection(', 1)[1].split('private void openProgramPage', 1)[0]
        self.assertIn('configureEntry(true)', selection)
        self.assertIn('!consentCheck.isChecked()', selection)
        self.assertIn('requestProgram(change?', selection)
        self.assertIn('"consent", true', activity)
        self.assertIn('showSetup();showFinder();', activity)

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
        for control in ('entryAdvancedButton', 'findAgainButton', 'pickPageButton', 'finderToolbar'):
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
