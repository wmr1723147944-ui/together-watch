package cloud.watchtogethernow.mobile;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
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
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
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
    private FrameLayout webContainer;
    private FrameLayout popupContainer;
    private FrameLayout fullscreenContainer;

    private WebView videoWebView;
    private WebView roomWebView;
    private WebView companionWebView;
    private PermissionRequest pendingAudioPermission;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    private String activeRoom = "";
    private String activeNickname = "";
    private boolean roomBootstrapPending = false;
    private int videoPageGeneration = 0;

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
        roomWebView.setVisibility(View.GONE);

        FrameLayout.LayoutParams match = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        webContainer.addView(videoWebView, match);
        webContainer.addView(roomWebView, match);
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
    }

    private void bindActions() {
        findViewById(R.id.openVideoButton).setOnClickListener(view -> startSession());
        findViewById(R.id.videoTabButton).setOnClickListener(view -> showVideoTab());
        findViewById(R.id.roomTabButton).setOnClickListener(view -> showRoomTab());
        findViewById(R.id.setupTabButton).setOnClickListener(view -> showSetup());
        findViewById(R.id.termsButton).setOnClickListener(view -> openExternal(SERVER_ORIGIN + "/terms"));
        findViewById(R.id.privacyButton).setOnClickListener(view -> openExternal(SERVER_ORIGIN + "/privacy"));
    }

    private void startSession() {
        String nickname = nicknameInput.getText().toString().trim();
        String room = UrlPolicy.extractRoom(roomInput.getText().toString(), SERVER_HOST);
        String videoUrl = UrlPolicy.extractFirstHttpsUrl(videoUrlInput.getText().toString());

        if (nickname.isEmpty()) {
            showInputError(nicknameInput, "请填写昵称");
            return;
        }
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
        preferences.edit()
            .putString("nickname", activeNickname)
            .putString("room", activeRoom)
            .putString("video_url", videoUrl)
            .putBoolean("consent", true)
            .apply();

        hideKeyboard();
        setupPanel.setVisibility(View.GONE);
        browserToolbar.setVisibility(View.VISIBLE);
        statusText.setVisibility(View.VISIBLE);
        mainContent.setVisibility(View.VISIBLE);
        setStatus("正在打开视频页面…");

        bootstrapRoomPage();
        showVideoTab();
        videoWebView.loadUrl(videoUrl);
    }

    private void bootstrapRoomPage() {
        roomBootstrapPending = true;
        roomWebView.loadUrl(SERVER_ORIGIN + "/");
    }

    private void showVideoTab() {
        videoWebView.setVisibility(View.VISIBLE);
        roomWebView.setVisibility(View.GONE);
        setStatus("视频页：助手会自动识别 HTML5 播放器");
    }

    private void showRoomTab() {
        videoWebView.setVisibility(View.GONE);
        roomWebView.setVisibility(View.VISIBLE);
        setStatus("房间页：可聊天、调整音量和加入语音通话");
    }

    private void showSetup() {
        hideFullscreenVideo();
        destroyCompanion();
        videoPageGeneration += 1;
        videoWebView.loadUrl("about:blank");
        roomWebView.loadUrl("about:blank");
        browserToolbar.setVisibility(View.GONE);
        statusText.setVisibility(View.GONE);
        setupPanel.setVisibility(View.VISIBLE);
    }

    private void showInputError(EditText input, String message) {
        input.setError(message);
        input.requestFocus();
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
            videoPageGeneration += 1;
            destroyCompanion();
            setStatus("网页加载中…");
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (!UrlPolicy.isHttpsWebUrl(url)) return;
            int generation = videoPageGeneration;
            setStatus("网页已打开，正在加载同步助手…");
            fetchAndInjectHelper(generation, url);
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
            if (!roomBootstrapPending || !UrlPolicy.isTrustedServerUrl(url, SERVER_HOST)) return;
            roomBootstrapPending = false;
            String script = "(function(){"
                + "localStorage.setItem('tw_legal_notice_version'," + js(activeLegalVersion()) + ");"
                + "localStorage.setItem('tw_username'," + js(activeNickname) + ");"
                + "localStorage.setItem('tw_last_room'," + js(activeRoom) + ");"
                + "return true;})()";
            view.evaluateJavascript(script, ignored -> view.loadUrl(
                SERVER_ORIGIN + "/room/" + Uri.encode(activeRoom)
            ));
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
        if (!UrlPolicy.isTrustedServerUrl(request.getOrigin().toString(), SERVER_HOST)) {
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
                mainHandler.post(() -> setStatus("同步助手下载失败，请检查网络后重新打开视频"));
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
        if (generation != videoPageGeneration) return;
        if (videoWebView.getUrl() == null || !videoWebView.getUrl().equals(expectedUrl)) return;
        String payload = source + "\n;window.TogetherWatchBookmarklet?.start(" + js(SERVER_ORIGIN) + ");";
        videoWebView.evaluateJavascript(payload, ignored -> mainHandler.postDelayed(() -> {
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

    @Override
    public void onBackPressed() {
        if (fullscreenView != null) {
            hideFullscreenVideo();
            return;
        }
        WebView visible = roomWebView.getVisibility() == View.VISIBLE ? roomWebView : videoWebView;
        if (setupPanel.getVisibility() != View.VISIBLE && visible.canGoBack()) {
            visible.goBack();
            return;
        }
        if (setupPanel.getVisibility() != View.VISIBLE) {
            showSetup();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        pendingAudioPermission = null;
        destroyCompanion();
        if (videoWebView != null) videoWebView.destroy();
        if (roomWebView != null) roomWebView.destroy();
        networkExecutor.shutdownNow();
        super.onDestroy();
    }
}
