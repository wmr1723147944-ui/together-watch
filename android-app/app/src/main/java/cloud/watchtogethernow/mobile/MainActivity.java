package cloud.watchtogethernow.mobile;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;
import org.json.JSONArray;
import androidx.media3.ui.PlayerView;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends ComponentActivity {
    private static final String PREFS = "together_watch_mobile";
    private static final String SERVER_ORIGIN = BuildConfig.SERVER_ORIGIN;
    private static final String SERVER_HOST = Uri.parse(SERVER_ORIGIN).getHost();
    private static final String HELPER_URL = SERVER_ORIGIN + "/static/js/bookmarklet.js";
    private static final int REQUEST_MICROPHONE = 4102;
    private static final int MAX_HELPER_BYTES = 512 * 1024;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();

    private SharedPreferences preferences;
    private ScrollView setupPanel;
    private View mainContent;
    private View browserToolbar;
    private TextView statusText;
    private EditText nicknameInput;
    private EditText roomInput;
    private EditText videoUrlInput;
    private CheckBox consentCheck;
    private LinearLayout webContainer;
    private FrameLayout videoContainer;
    private FrameLayout roomContainer;
    private PlayerView nativePlayerView;
    private NativePlayerController nativePlayer;
    private CheckBox autoNativeCheck;
    private final LinkedHashMap<String, JSONObject> mediaCandidates = new LinkedHashMap<>();
    private String discoveryScript = "";
    private String sourcePageUrl = "";
    private boolean preferWebThisPage;
    private boolean sessionActive;
    private boolean destroyed;
    private boolean nativeFullscreen;
    private long lastDiscovery;
    private boolean discoveryInFlight;
    private boolean protectedPage;
    private boolean foreground = true;
    private int bridgeGeneration;
    private int bridgeMisses;
    private int activeCandidateCount;
    private String lastActiveCandidate = "";
    private FrameLayout popupContainer;
    private FrameLayout fullscreenContainer;

    private WebView videoWebView;
    private WebView roomWebView;
    private WebView companionWebView;
    private PermissionRequest pendingAudioPermission;
    private OnBackPressedCallback navigationBack;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    private String activeRoom = "";
    private String activeNickname = "";
    private boolean roomBootstrapPending = false;
    private volatile int videoPageGeneration = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        bindViews();
        createWebViews();
        restoreInputs();
        readSharedText(getIntent());
        bindActions();
    }

    private void bindViews() {
        setupPanel = findViewById(R.id.setupPanel);
        mainContent = findViewById(R.id.mainContent);
        browserToolbar = findViewById(R.id.browserToolbar);
        statusText = findViewById(R.id.statusText);
        nicknameInput = findViewById(R.id.nicknameInput);
        roomInput = findViewById(R.id.roomInput);
        videoUrlInput = findViewById(R.id.videoUrlInput);
        consentCheck = findViewById(R.id.consentCheck);
        webContainer = findViewById(R.id.webContainer);
        videoContainer = findViewById(R.id.videoContainer);
        roomContainer = findViewById(R.id.roomContainer);
        autoNativeCheck = findViewById(R.id.autoNativeCheck);
        popupContainer = findViewById(R.id.popupContainer);
        fullscreenContainer = findViewById(R.id.fullscreenContainer);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebViews() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        videoWebView = new WebView(this);
        configureWebView(videoWebView, true);
        videoWebView.setWebViewClient(new VideoPageClient());
        videoWebView.setWebChromeClient(new VideoChromeClient());

        roomWebView = new WebView(this);
        configureWebView(roomWebView, false);
        roomWebView.setWebViewClient(new RoomPageClient());
        roomWebView.setWebChromeClient(new RoomChromeClient());

        FrameLayout.LayoutParams match = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        videoContainer.addView(videoWebView, match);
        nativePlayerView = new PlayerView(this);
        nativePlayerView.setVisibility(View.GONE);
        nativePlayerView.setKeepScreenOn(true);
        videoContainer.addView(nativePlayerView, new FrameLayout.LayoutParams(-1, -1));
        nativePlayer = new NativePlayerController(this, nativePlayerView, this::setStatus);
        roomContainer.addView(roomWebView, new FrameLayout.LayoutParams(-1, -1));
        try (InputStream input = getAssets().open("media-discovery.js")) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] bytes = new byte[4096]; int count;
            while ((count = input.read(bytes)) != -1) output.write(bytes, 0, count);
            discoveryScript = output.toString("UTF-8");
        } catch (IOException error) { setStatus("资源识别组件不可用，仍可使用网页播放"); }
        arrangePanels();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView(WebView webView, boolean supportsCompanionPopup) {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setSupportMultipleWindows(supportsCompanionPopup);
        settings.setJavaScriptCanOpenWindowsAutomatically(supportsCompanionPopup);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);
    }

    private void restoreInputs() {
        nicknameInput.setText(preferences.getString("nickname", "观影成员"));
        roomInput.setText(preferences.getString("room", ""));
        videoUrlInput.setText(preferences.getString("video_url", ""));
        consentCheck.setChecked(preferences.getBoolean("consent", false));
        autoNativeCheck.setChecked(preferences.getBoolean("auto_native", true));
    }

    private void bindActions() {
        navigationBack = new OnBackPressedCallback(false) {
            @Override public void handleOnBackPressed() { handleBackNavigation(); }
        };
        getOnBackPressedDispatcher().addCallback(this, navigationBack);
        findViewById(R.id.openVideoButton).setOnClickListener(view -> startSession());
        findViewById(R.id.videoTabButton).setOnClickListener(view -> showVideoTab());
        findViewById(R.id.roomTabButton).setOnClickListener(view -> showRoomTab());
        findViewById(R.id.setupTabButton).setOnClickListener(view -> showSetup());
        findViewById(R.id.termsButton).setOnClickListener(view -> openExternal(SERVER_ORIGIN + "/terms"));
        findViewById(R.id.privacyButton).setOnClickListener(view -> openExternal(SERVER_ORIGIN + "/privacy"));
        findViewById(R.id.sourceButton).setOnClickListener(view -> choosePlayback());
        findViewById(R.id.sampleButton).setOnClickListener(view -> chooseSample());
        findViewById(R.id.fullscreenButton).setOnClickListener(view -> {
            nativeFullscreen = !nativeFullscreen;
            roomContainer.setVisibility(nativeFullscreen ? View.GONE : View.VISIBLE);
            videoContainer.setVisibility(View.VISIBLE);
            ((Button) view).setText(nativeFullscreen ? "退出全屏" : "全屏视频");
        });
        findViewById(R.id.inviteButton).setOnClickListener(view -> {
            Intent invite = new Intent(Intent.ACTION_SEND).setType("text/plain");
            invite.putExtra(Intent.EXTRA_TEXT, "来一起看：" + SERVER_ORIGIN + "/room/" + Uri.encode(activeRoom));
            startActivity(Intent.createChooser(invite, "邀请朋友"));
        });
    }

    private void startSession() {
        String nickname = nicknameInput.getText().toString().trim();
        String room = UrlPolicy.extractRoom(roomInput.getText().toString(), SERVER_HOST);
        String videoUrl = UrlPolicy.extractFirstHttpsUrl(videoUrlInput.getText().toString());

        if (nickname.isEmpty()) {
            showInputError(nicknameInput, "请填写昵称");
            return;
        }
        if (roomInput.getText().toString().trim().isEmpty()) room = UUID.randomUUID().toString().replace("-", "").substring(0, 24);
        if (room.isEmpty()) {
            showInputError(roomInput, "房间号无效，请输入房间号或完整邀请链接");
            return;
        }
        if (videoUrl.isEmpty()) {
            showInputError(videoUrlInput, "只允许公开 HTTPS 网页，不能使用本机或局域网地址");
            return;
        }
        if (!consentCheck.isChecked()) {
            Toast.makeText(this, "请先阅读并勾选合规使用说明", Toast.LENGTH_LONG).show();
            return;
        }

        activeNickname = nickname.substring(0, Math.min(nickname.length(), 32));
        activeRoom = room;
        roomInput.setText(room);
        sourcePageUrl = videoUrl;
        preferWebThisPage = false;
        protectedPage = false;
        discoveryInFlight = false;
        sessionActive = true;
        navigationBack.setEnabled(true);
        bridgeMisses = 0;
        mediaCandidates.clear();
        preferences.edit()
            .putString("nickname", activeNickname)
            .putString("room", activeRoom)
            .putString("video_url", videoUrl)
            .putBoolean("consent", true)
            .putBoolean("auto_native", autoNativeCheck.isChecked())
            .apply();

        hideKeyboard();
        setupPanel.setVisibility(View.GONE);
        browserToolbar.setVisibility(View.VISIBLE);
        findViewById(R.id.playbackToolbar).setVisibility(View.VISIBLE);
        statusText.setVisibility(View.VISIBLE);
        mainContent.setVisibility(View.VISIBLE);
        setStatus("正在打开视频页面…");

        bootstrapRoomPage();
        showVideoTab();
        if (MediaSourcePolicy.isMedia(videoUrl)) openNative(videoUrl, 0);
        else videoWebView.loadUrl(videoUrl);
        final int generation = ++bridgeGeneration;
        mainHandler.post(() -> tickBridge(generation));
    }

    private void bootstrapRoomPage() {
        roomBootstrapPending = true;
        roomWebView.loadUrl(SERVER_ORIGIN + "/");
    }

    private void showVideoTab() {
        videoContainer.setVisibility(View.VISIBLE);
        roomContainer.setVisibility(View.VISIBLE);
        nativeFullscreen = false;
        ((Button) findViewById(R.id.fullscreenButton)).setText("全屏视频");
    }

    private void showRoomTab() {
        videoContainer.setVisibility(View.GONE);
        roomContainer.setVisibility(View.VISIBLE);
        setStatus("房间页：可聊天、调整音量和加入语音通话");
    }

    private void showSetup() {
        sessionActive = false;
        navigationBack.setEnabled(false);
        cancelPendingMicrophone();
        ++bridgeGeneration;
        nativePlayer.release();
        nativePlayerView.setVisibility(View.GONE);
        videoWebView.setVisibility(View.VISIBLE);
        hideFullscreenVideo();
        destroyCompanion();
        videoPageGeneration += 1;
        videoWebView.loadUrl("about:blank");
        roomWebView.loadUrl("about:blank");
        browserToolbar.setVisibility(View.GONE);
        findViewById(R.id.playbackToolbar).setVisibility(View.GONE);
        statusText.setVisibility(View.GONE);
        setupPanel.setVisibility(View.VISIBLE);
        mainContent.setVisibility(View.GONE);
    }

    private void showInputError(EditText input, String message) {
        input.setError(message);
        input.requestFocus();
    }

    private void arrangePanels() {
        boolean landscape = getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        webContainer.setOrientation(landscape ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL);
        videoContainer.setLayoutParams(new LinearLayout.LayoutParams(landscape ? 0 : -1, landscape ? -1 : 0, landscape ? 1.65f : 1f));
        roomContainer.setLayoutParams(new LinearLayout.LayoutParams(landscape ? 0 : -1, landscape ? -1 : 0, 1f));
    }

    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        arrangePanels();
    }

    private void tickBridge(int generation) {
        if (destroyed || !foreground || !sessionActive || generation != bridgeGeneration) return;
        if (!nativePlayer.isActive() && System.currentTimeMillis() - lastDiscovery > 2000) discoverMedia();
        String url = roomWebView.getUrl();
        String path = url == null ? "" : Uri.parse(url).getPath();
        if (!UrlPolicy.isTrustedServerUrl(url, SERVER_HOST) || !("/mobile-room/" + activeRoom).equals(path)) {
            mainHandler.postDelayed(() -> tickBridge(generation), 350);
            return;
        }
        String script = "(function(){const bridge=window.TogetherWatchMobile;if(!bridge)return null;"
            + "bridge.receive(" + nativePlayer.sample().toString() + ");return bridge.drain();})()";
        roomWebView.evaluateJavascript(script, result -> {
            if (destroyed || !foreground || !sessionActive || generation != bridgeGeneration) return;
            try {
                JSONObject response = new JSONObject(result);
                if (response.optInt("version") == 1) {
                    bridgeMisses = 0;
                    JSONArray commands = response.optJSONArray("commands");
                    if (commands != null) for (int i = 0; i < Math.min(16, commands.length()); i++) {
                        JSONObject command = commands.optJSONObject(i);
                        if (command != null) nativePlayer.apply(command);
                    }
                }
            } catch (Exception ignored) {
                if (++bridgeMisses == 20) setStatus("房间组件尚未就绪：请更新服务器到支持安卓内置播放的版本，再重新进入房间");
            }
            mainHandler.postDelayed(() -> tickBridge(generation), 300);
        });
    }

    private void rememberCandidate(String rawUrl, JSONObject details) {
        if (!sessionActive || protectedPage || MediaSourcePolicy.preferWeb(sourcePageUrl)) return;
        String url = UrlPolicy.normalizeHttpsUrl(rawUrl);
        if (url.isEmpty() || !MediaSourcePolicy.isMedia(url)) return;
        if (!mediaCandidates.containsKey(url) && mediaCandidates.size() >= 24) return;
        mediaCandidates.put(url, details == null ? new JSONObject() : details);
        ((Button) findViewById(R.id.sourceButton)).setText("播放方式 (" + mediaCandidates.size() + ")");
    }

    private void discoverMedia() {
        lastDiscovery = System.currentTimeMillis();
        if (discoveryInFlight || destroyed || !sessionActive || nativePlayer.isActive()
            || discoveryScript.isEmpty() || MediaSourcePolicy.preferWeb(sourcePageUrl)) return;
        discoveryInFlight = true;
        int generation = videoPageGeneration;
        videoWebView.evaluateJavascript(discoveryScript, result -> {
            discoveryInFlight = false;
            if (destroyed || generation != videoPageGeneration || !sessionActive || nativePlayer.isActive()) return;
            try {
                JSONObject discovery = new JSONObject(result);
                protectedPage = discovery.optBoolean("protectedVideo");
                if (protectedPage) { mediaCandidates.clear(); return; }
                JSONArray candidates = discovery.optJSONArray("candidates");
                List<JSONObject> active = new ArrayList<>();
                if (candidates != null) for (int i = 0; i < candidates.length(); i++) {
                    JSONObject candidate = candidates.getJSONObject(i);
                    rememberCandidate(candidate.optString("url"), candidate);
                    if (candidate.optBoolean("active") && candidate.optDouble("duration") >= 120) active.add(candidate);
                }
                // Require the same visible, playing long-form video twice;
                // network-only candidates are offered for manual selection.
                if (active.size() == 1 && autoNativeCheck.isChecked() && !preferWebThisPage) {
                    JSONObject candidate = active.get(0);
                    String url = candidate.optString("url");
                    activeCandidateCount = url.equals(lastActiveCandidate) ? activeCandidateCount + 1 : 1;
                    lastActiveCandidate = url;
                    if (activeCandidateCount >= 2 && mediaCandidates.containsKey(url)) openNative(url, candidate.optDouble("position", 0));
                } else { activeCandidateCount = 0; lastActiveCandidate = ""; }
            } catch (Exception ignored) { /* The page may navigate during evaluation. */ }
        });
    }

    private void openNative(String url, double position) {
        if (!MediaSourcePolicy.isMedia(url) || UrlPolicy.normalizeHttpsUrl(url).isEmpty() || protectedPage) return;
        hideFullscreenVideo();
        destroyCompanion();
        ++videoPageGeneration;
        // about:blank unloads the complete frame tree, preventing hidden video
        // or ad frames from continuing to produce a second audio track.
        videoWebView.loadUrl("about:blank");
        videoWebView.setVisibility(View.GONE);
        nativePlayerView.setVisibility(View.VISIBLE);
        String referer = MediaSourcePolicy.origin(sourcePageUrl);
        nativePlayer.open(url, referer, videoWebView.getSettings().getUserAgentString(), position);
        showVideoTab();
    }

    private void returnToWeb() {
        nativePlayer.release();
        nativePlayerView.setVisibility(View.GONE);
        videoWebView.setVisibility(View.VISIBLE);
        preferWebThisPage = true;
        showVideoTab();
        videoWebView.loadUrl(sourcePageUrl);
    }

    private void choosePlayback() {
        List<String> urls = new ArrayList<>(mediaCandidates.keySet());
        List<String> labels = new ArrayList<>();
        labels.add(nativePlayer.isActive() ? "返回原网页播放 / 选集" : "继续网页播放（关闭本页自动切换）");
        labels.add("刷新网页并重新识别");
        for (String url : urls) labels.add("内置播放：" + MediaSourcePolicy.displayName(url));
        new AlertDialog.Builder(this).setTitle(urls.isEmpty() ? "暂未识别到可内置播放的资源" : "选择播放方式")
            .setItems(labels.toArray(new String[0]), (dialog, index) -> {
                if (index == 0) { preferWebThisPage = true; if (nativePlayer.isActive()) returnToWeb(); }
                else if (index == 1) { returnToWeb(); preferWebThisPage = false; }
                else {
                    String url = urls.get(index - 2);
                    JSONObject details = mediaCandidates.get(url);
                    openNative(url, details == null ? 0 : details.optDouble("position", 0));
                }
            }).setNegativeButton("取消", null).show();
    }

    private void chooseSample() {
        String[] titles = {"Big Buck Bunny · 预告片", "Sintel · 预告片"};
        String[] urls = {
            "https://media.w3.org/2010/05/bunny/trailer.mp4",
            "https://media.w3.org/2010/05/sintel/trailer.mp4"
        };
        new AlertDialog.Builder(this).setTitle("先用公开影片测试播放与同步")
            .setItems(titles, (dialog, index) -> videoUrlInput.setText(urls[index]))
            .setNegativeButton("取消", null).show();
    }

    private void setStatus(String text) {
        statusText.setText(text);
    }

    private void hideKeyboard() {
        View focused = getCurrentFocus();
        if (focused == null) return;
        InputMethodManager manager = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (manager != null) manager.hideSoftInputFromWindow(focused.getWindowToken(), 0);
    }

    private void readSharedText(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        if (!"text/plain".equals(intent.getType())) return;
        String shared = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (shared == null || shared.trim().isEmpty()) return;
        String room = UrlPolicy.extractRoom(shared, SERVER_HOST);
        if (!room.isEmpty()) {
            roomInput.setText(shared.trim());
        } else {
            String url = UrlPolicy.extractFirstHttpsUrl(shared);
            if (!url.isEmpty()) videoUrlInput.setText(url);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        showSetup();
        readSharedText(intent);
    }

    private final class VideoPageClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            // Observe only the URL. Cookies and Authorization headers stay in
            // WebView; we neither copy them nor send them to the room server.
            String url = request.getUrl().toString();
            int generation = videoPageGeneration;
            if (MediaSourcePolicy.isMedia(url)) mainHandler.post(() -> {
                if (generation == videoPageGeneration && !nativePlayer.isActive()) rememberCandidate(url, null);
            });
            return null;
        }
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if ("https".equalsIgnoreCase(uri.getScheme()) && !UrlPolicy.normalizeHttpsUrl(uri.toString()).isEmpty()) {
                return false;
            }
            setStatus("已阻止非 HTTPS 或本地地址：" + uri.getScheme());
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            if ("about:blank".equals(url)) return;
            videoPageGeneration += 1;
            protectedPage = false;
            mediaCandidates.clear();
            lastActiveCandidate = "";
            activeCandidateCount = 0;
            sourcePageUrl = url;
            destroyCompanion();
            setStatus("网页加载中…");
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (!sessionActive || nativePlayer.isActive() || !UrlPolicy.isHttpsWebUrl(url)) return;
            int generation = videoPageGeneration;
            setStatus("网页已打开，正在加载同步助手…");
            fetchAndInjectHelper(generation, url);
            discoverMedia();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (request.isForMainFrame()) setStatus("网页加载失败：" + error.getDescription());
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, android.net.http.SslError error) {
            handler.cancel();
            setStatus("网页证书异常，已停止访问");
        }
    }

    private final class RoomPageClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (UrlPolicy.isTrustedServerUrl(url, SERVER_HOST)) return false;
            openExternal(url);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (!sessionActive || !roomBootstrapPending || !UrlPolicy.isTrustedServerUrl(url, SERVER_HOST)) return;
            roomBootstrapPending = false;
            String script = "(function(){"
                + "localStorage.setItem('tw_legal_notice_version'," + js(activeLegalVersion()) + ");"
                + "localStorage.setItem('tw_username'," + js(activeNickname) + ");"
                + "localStorage.setItem('tw_last_room'," + js(activeRoom) + ");"
                + "return true;})()";
            view.evaluateJavascript(script, ignored -> {
                if (sessionActive && !destroyed) view.loadUrl(SERVER_ORIGIN + "/mobile-room/" + Uri.encode(activeRoom));
            });
        }

        @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() == 404)
                setStatus("服务器尚未更新安卓房间页，请先部署新版网站后重新进入");
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, android.net.http.SslError error) {
            handler.cancel();
        }
    }

    private final class VideoChromeClient extends WebChromeClient {
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            destroyCompanion();
            companionWebView = new WebView(MainActivity.this);
            configureWebView(companionWebView, false);
            companionWebView.setWebViewClient(new CompanionPageClient());
            companionWebView.setWebChromeClient(new WebChromeClient());
            popupContainer.addView(companionWebView, new FrameLayout.LayoutParams(1, 1));

            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(companionWebView);
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public void onCloseWindow(WebView window) {
            destroyCompanion();
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            showFullscreenVideo(view, callback);
        }

        @Override
        public void onHideCustomView() {
            hideFullscreenVideo();
        }
    }

    private final class CompanionPageClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !UrlPolicy.isTrustedServerUrl(request.getUrl().toString(), SERVER_HOST);
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            if (!"about:blank".equals(url) && !UrlPolicy.isTrustedServerUrl(url, SERVER_HOST)) {
                mainHandler.post(MainActivity.this::destroyCompanion);
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (!UrlPolicy.isTrustedServerUrl(url, SERVER_HOST) || !url.contains("/companion")) return;
            String script = "(function(){"
                + "localStorage.setItem('tw_last_room'," + js(activeRoom) + ");"
                + "localStorage.setItem('tw_username'," + js(activeNickname) + ");"
                + "const room=document.getElementById('webCompanionRoom');if(room)room.value=" + js(activeRoom) + ";"
                + "const name=document.getElementById('webCompanionUsername');if(name)name.value=" + js(activeNickname) + ";"
                + "setTimeout(function(){document.getElementById('webCompanionConnect')?.click();},250);"
                + "return true;})()";
            view.evaluateJavascript(script, ignored -> setStatus("同步助手已启动，请等待播放器识别"));
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, android.net.http.SslError error) {
            handler.cancel();
        }
    }

    private final class RoomChromeClient extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> handleRoomPermissionRequest(request));
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingAudioPermission == request) pendingAudioPermission = null;
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            showFullscreenVideo(view, callback);
        }

        @Override
        public void onHideCustomView() {
            hideFullscreenVideo();
        }
    }

    private void handleRoomPermissionRequest(PermissionRequest request) {
        if (!foreground || !sessionActive || !UrlPolicy.isTrustedServerUrl(request.getOrigin().toString(), SERVER_HOST)) {
            request.deny();
            return;
        }
        boolean asksForAudio = Arrays.asList(request.getResources())
            .contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
        if (!asksForAudio) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            return;
        }
        pendingAudioPermission = request;
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_MICROPHONE);
    }

    private void cancelPendingMicrophone() {
        if (pendingAudioPermission != null) pendingAudioPermission.deny();
        pendingAudioPermission = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_MICROPHONE || pendingAudioPermission == null) return;
        PermissionRequest request = pendingAudioPermission;
        pendingAudioPermission = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            request.deny();
            Toast.makeText(this, "麦克风权限被拒绝，无法使用语音通话", Toast.LENGTH_LONG).show();
        }
    }

    private void fetchAndInjectHelper(int generation, String pageUrl) {
        networkExecutor.execute(() -> {
            try {
                String source = downloadUtf8(HELPER_URL + "?v=" + System.currentTimeMillis());
                mainHandler.post(() -> injectHelperIfCurrent(source, generation, pageUrl));
            } catch (IOException error) {
                mainHandler.post(() -> {
                    if (generation == videoPageGeneration && !destroyed && !nativePlayer.isActive())
                        setStatus("同步助手下载失败，请点击播放方式重新识别");
                });
            }
        });
    }

    private String downloadUtf8(String rawUrl) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(rawUrl).openConnection();
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(15_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/javascript,text/javascript");
        connection.setRequestProperty("User-Agent", "TogetherWatchAndroid/" + BuildConfig.VERSION_NAME);
        try {
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IOException("helper HTTP " + connection.getResponseCode());
            }
            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int total = 0;
                int read;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_HELPER_BYTES) throw new IOException("helper too large");
                    output.write(buffer, 0, read);
                }
                return new String(output.toByteArray(), StandardCharsets.UTF_8);
            }
        } finally {
            connection.disconnect();
        }
    }

    private void injectHelperIfCurrent(String source, int generation, String expectedUrl) {
        if (destroyed || !sessionActive || nativePlayer.isActive() || generation != videoPageGeneration) return;
        if (videoWebView.getUrl() == null || !videoWebView.getUrl().equals(expectedUrl)) return;
        String payload = source + "\n;window.TogetherWatchBookmarklet?.start(" + js(SERVER_ORIGIN) + ");";
        videoWebView.evaluateJavascript(payload, ignored -> mainHandler.postDelayed(() -> {
            if (destroyed || nativePlayer.isActive() || generation != videoPageGeneration) return;
            videoWebView.evaluateJavascript(
                "Boolean(window.__TW_BOOKMARK_COMPANION__)",
                ready -> setStatus("true".equals(ready)
                    ? "助手已加载：正在连接房间并寻找播放器"
                    : "该网页暂未启动助手，请尝试刷新或换用受支持页面")
            );
        }, 700));
    }

    private void destroyCompanion() {
        if (companionWebView == null) return;
        popupContainer.removeView(companionWebView);
        companionWebView.stopLoading();
        companionWebView.loadUrl("about:blank");
        companionWebView.destroy();
        companionWebView = null;
    }

    private void showFullscreenVideo(View view, WebChromeClient.CustomViewCallback callback) {
        if (fullscreenView != null) {
            callback.onCustomViewHidden();
            return;
        }
        fullscreenView = view;
        fullscreenCallback = callback;
        mainContent.setVisibility(View.GONE);
        setupPanel.setVisibility(View.GONE);
        fullscreenContainer.addView(view, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        fullscreenContainer.setVisibility(View.VISIBLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
    }

    private void hideFullscreenVideo() {
        if (fullscreenView == null) return;
        fullscreenContainer.removeView(fullscreenView);
        fullscreenContainer.setVisibility(View.GONE);
        fullscreenView = null;
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        mainContent.setVisibility(View.VISIBLE);
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, "没有应用可以打开此链接", Toast.LENGTH_SHORT).show();
        }
    }

    private static String activeLegalVersion() {
        return BuildConfig.LEGAL_NOTICE_VERSION;
    }

    private static String js(String value) {
        return JSONObject.quote(value == null ? "" : value);
    }

    private void handleBackNavigation() {
        if (nativeFullscreen) { showVideoTab(); return; }
        if (fullscreenView != null) {
            hideFullscreenVideo();
            return;
        }
        if (videoContainer.getVisibility() != View.VISIBLE) {
            showVideoTab();
            return;
        }
        if (nativePlayer.isActive() && videoContainer.getVisibility() == View.VISIBLE) {
            returnToWeb();
            return;
        }
        if (setupPanel.getVisibility() != View.VISIBLE && videoWebView.canGoBack()) {
            videoWebView.goBack();
            return;
        }
        if (setupPanel.getVisibility() != View.VISIBLE) {
            showSetup();
            return;
        }
        navigationBack.setEnabled(false);
        getOnBackPressedDispatcher().onBackPressed();
    }

    @Override
    protected void onStop() {
        foreground = false;
        cancelPendingMicrophone();
        ++bridgeGeneration;
        if (nativePlayer != null) nativePlayer.pauseLocally();
        if (roomWebView != null && UrlPolicy.isTrustedServerUrl(roomWebView.getUrl(), SERVER_HOST)) {
            roomWebView.evaluateJavascript("window.TogetherWatchMobile?.suspend()", null);
        }
        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        foreground = true;
        if (sessionActive) {
            final int generation = ++bridgeGeneration;
            mainHandler.post(() -> tickBridge(generation));
        }
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        sessionActive = false;
        ++bridgeGeneration;
        mainHandler.removeCallbacksAndMessages(null);
        nativePlayer.release();
        cancelPendingMicrophone();
        destroyCompanion();
        if (videoWebView != null) videoWebView.destroy();
        if (roomWebView != null) roomWebView.destroy();
        networkExecutor.shutdownNow();
        super.onDestroy();
    }
}
