package cloud.watchtogethernow.mobile;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.ClipData;
import android.content.ClipboardManager;
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
import android.os.Build;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
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
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
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

@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
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
    private boolean cropFullscreen;
    private int orientationBeforeFullscreen = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private LinearLayout fullscreenControls;
    private TextView holdSpeedHint;
    private boolean touchCandidate, holdRequested, holdGestureActive, holdNativeMode, webHoldEligible;
    private boolean playerTouchConsumed, holdObserved;
    private float holdX, holdY, holdNx, holdNy;
    private long holdDownTime;
    private int holdToken;
    private View holdTouchTarget;
    private final Runnable hideFullscreenUi = () -> {
        if (fullscreenControls != null) fullscreenControls.setVisibility(View.GONE);
        if (nativeFullscreen && nativePlayerView != null) nativePlayerView.hideController();
    };
    private final Runnable startPlayerHold = this::startPlayerHold;
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
    // Keep the catalogue and at most one original-site finder separate from
    // playback. Replacing a video must not discard search/episode history.
    private WebView catalogWebView, originalFinderWebView;
    private CatalogMetadataController catalogMetadata;
    private boolean originalFinderActive, backPending;
    private WebView roomWebView;
    private WebView companionWebView;
    private WebView routingPopup;
    private PermissionRequest pendingAudioPermission;
    private OnBackPressedCallback navigationBack;
    private View fullscreenView;
    private DanmakuView webFullscreenDanmaku;
    private JSONObject lastDanmakuPacket;
    private double danmakuTime,danmakuSpeed=1;
    private long danmakuSampleAt;
    private boolean danmakuPlaying;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    private String activeRoom = "";
    private String activeNickname = "";
    private boolean finding, requestBusy, awaitingEpisode, videoLoading;
    private int flowGeneration;
    private long programRevision, appliedProgramRevision, episodeStarted;
    private ProgramPolicy.Selection programSelection;
    private String ownerKey = "";
    private String playerAgent = "", webSyncScript = "", catalogScript = "", pageLayoutScript = "";
    private String playerBridgeNotice = "";
    private boolean roomBootstrapPending = false;
    private volatile int videoPageGeneration = 0;
    private ProgramPolicy.Selection pendingSetupSelection = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        bindViews();
        createWebViews();
        restoreInputs();
        bindActions();
        showFinder();
        if (Intent.ACTION_SEND.equals(getIntent().getAction())) {
            showSetup();readSharedText(getIntent());
            if(!videoUrlInput.getText().toString().isEmpty())setEntryAdvanced(true);
        }
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

        catalogWebView = new WebView(this);
        configureWebView(catalogWebView, true);
        catalogWebView.setWebViewClient(new FinderPageClient(true));
        catalogWebView.setWebChromeClient(new VideoChromeClient());
        catalogWebView.setVisibility(View.GONE);

        roomWebView = new WebView(this);
        configureWebView(roomWebView, false);
        roomWebView.setWebViewClient(new RoomPageClient());
        roomWebView.setWebChromeClient(new RoomChromeClient());

        FrameLayout.LayoutParams match = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        videoContainer.addView(videoWebView, match);
        videoContainer.addView(catalogWebView, new FrameLayout.LayoutParams(-1, -1));
        nativePlayerView = new PlayerView(this);
        nativePlayerView.setVisibility(View.GONE);
        nativePlayerView.setKeepScreenOn(true);
        nativePlayerView.setControllerShowTimeoutMs(2500);
        videoContainer.addView(nativePlayerView, new FrameLayout.LayoutParams(-1, -1));
        nativePlayer = new NativePlayerController(this, nativePlayerView, this::setStatus);
        nativePlayerView.setFullscreenButtonClickListener(fullscreen -> {
            if (nativeFullscreen) exitNativeFullscreen(); else enterNativeFullscreen();
        });
        nativePlayerView.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> {
            if (nativeFullscreen && fullscreenControls != null) {
                if (visibility == View.VISIBLE && !holdGestureActive) showFullscreenControls();
                else fullscreenControls.setVisibility(View.GONE);
            }
        });
        roomContainer.addView(roomWebView, new FrameLayout.LayoutParams(-1, -1));
        try (InputStream input = getAssets().open("media-discovery.js")) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] bytes = new byte[4096]; int count;
            while ((count = input.read(bytes)) != -1) output.write(bytes, 0, count);
            discoveryScript = output.toString("UTF-8");
        } catch (IOException error) { setStatus("资源识别组件不可用，仍可使用网页播放"); }
        playerAgent = readAsset("danmaku-overlay.js") + "\n" + readAsset("player-agent.js");
        webSyncScript = readAsset("android-web-sync.js");
        catalogScript = readAsset("catalog-adapters.js");
        pageLayoutScript = readAsset("android-page-layout.js");
        catalogMetadata = new CatalogMetadataController(this,catalogWebView,videoContainer,catalogScript,
            readAsset("catalog-metadata-bridge.js"),SERVER_ORIGIN,
            () -> foreground && finding && !originalFinderActive,
            view -> configureWebView(view,false),networkExecutor);
        arrangePanels();
    }

    private String readAsset(String name) {
        try (InputStream input=getAssets().open(name); ByteArrayOutputStream output=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[4096];int count;
            while((count=input.read(buffer))!=-1) {if(output.size()+count>MAX_HELPER_BYTES)return "";output.write(buffer,0,count);}
            return new String(output.toByteArray(),StandardCharsets.UTF_8);
        } catch(IOException error) {return "";}
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
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);
    }

    private void restoreInputs() {
        nicknameInput.setText(preferences.getString("nickname", "观影成员"));
        // Do not silently rejoin yesterday's room or override a new invitation.
        roomInput.setText("");
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
        findViewById(R.id.previousButton).setOnClickListener(view -> handleBackNavigation());
        findViewById(R.id.setupBackButton).setOnClickListener(view -> showPreviousFinder());
        findViewById(R.id.moreButton).setOnClickListener(view -> showRoomMenu());
        findViewById(R.id.finderCatalogButton).setOnClickListener(view -> showFinder());
        findViewById(R.id.termsButton).setOnClickListener(view -> openExternal(SERVER_ORIGIN + "/terms"));
        findViewById(R.id.privacyButton).setOnClickListener(view -> openExternal(SERVER_ORIGIN + "/privacy"));
        findViewById(R.id.sampleButton).setOnClickListener(view -> chooseSample());
        findViewById(R.id.entryAdvancedButton).setOnClickListener(view ->
            setEntryAdvanced(videoUrlInput.getVisibility()!=View.VISIBLE));
        findViewById(R.id.findAgainButton).setOnClickListener(view -> showFinder());
        findViewById(R.id.pickPageButton).setOnClickListener(view -> chooseCurrentPage());
        findViewById(R.id.fullscreenButton).setOnClickListener(view -> {
            showVideoTab();
            if (nativePlayer.isActive()) enterNativeFullscreen();
            else enterWebFullscreen();
        });
        findViewById(R.id.inviteButton).setOnClickListener(view -> inviteFriends());
    }

    private void inviteFriends() {
        if(!sessionActive)return;
        String link=SERVER_ORIGIN+"/room/"+Uri.encode(activeRoom);
        new AlertDialog.Builder(this).setTitle("房间号："+activeRoom)
            .setItems(new String[]{"复制房间号", "复制邀请链接", "分享邀请"},(dialog,which)->{
                if(which<2) {
                    ClipboardManager clipboard=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
                    if(clipboard!=null)clipboard.setPrimaryClip(ClipData.newPlainText("一起看邀请",which==0?activeRoom:link));
                    Toast.makeText(this,"已复制，请让朋友粘贴到房间号输入框",Toast.LENGTH_LONG).show();
                } else {
                    Intent invite=new Intent(Intent.ACTION_SEND).setType("text/plain");
                    invite.putExtra(Intent.EXTRA_TEXT,"来一起看："+link);
                    startActivity(Intent.createChooser(invite,"邀请朋友"));
                }
            }).setNegativeButton("关闭",null).show();
    }

    private void showRoomMenu() {
        List<String> labels=new ArrayList<>();List<Runnable> actions=new ArrayList<>();
        if(sessionActive) {
            labels.add(finding?"回到播放":videoContainer.getVisibility()==View.VISIBLE?"只看聊天与语音":"恢复同屏观看");
            actions.add(finding?this::resumePlayback:videoContainer.getVisibility()==View.VISIBLE?this::showRoomTab:this::showVideoTab);
            if(!finding) {
                labels.add("播放方式与故障处理");actions.add(this::choosePlayback);
                if(!nativePlayer.isActive()){labels.add("核对当前集数 / 重新连接同步");actions.add(this::chooseCurrentPage);}
            }
        }
        if(finding && originalFinderActive && originalFinderWebView!=null) {
            labels.add("返回搜索结果");actions.add(this::showFinder);
            labels.add("刷新原站页面");actions.add(()->originalFinderWebView.reload());
        }
        labels.add(sessionActive?"离开房间":"加入朋友房间");
        actions.add(()->{
            if(!sessionActive){showSetup();return;}
            new AlertDialog.Builder(this).setTitle("离开当前房间？")
                .setMessage("将断开本机的同步和通话。刚才的搜索仍会保留。")
                .setNegativeButton("继续观看",null).setPositiveButton("离开房间",(dialog,which)->{showSetup();showFinder();}).show();
        });
        new AlertDialog.Builder(this).setTitle("更多操作")
            .setItems(labels.toArray(new String[0]),(dialog,index)->actions.get(index).run())
            .setNegativeButton("关闭",null).show();
    }

    private void updateRoomControls() {
        updateCatalogChrome();
        boolean watching=sessionActive && !finding;
        browserToolbar.setVisibility(watching?View.VISIBLE:View.GONE);
        findViewById(R.id.finderToolbar).setVisibility(finding && originalFinderActive?View.VISIBLE:View.GONE);
        findViewById(R.id.moreButton).setVisibility(sessionActive || originalFinderActive?View.VISIBLE:View.GONE);
        boolean canChoose=!sessionActive || programRevision==0 || !ownerKey.isEmpty();
        findViewById(R.id.findAgainButton).setEnabled(canChoose);
        findViewById(R.id.findAgainButton).setTooltipText(canChoose?"保留房间，选择影片或集数":"由房主换片，你会自动跟随");
        findViewById(R.id.pickPageButton).setEnabled(canChoose);
        ((Button)findViewById(R.id.pickPageButton)).setText(sessionActive?"确认并切换到这一集":"选好这集，开始一起看");
    }

    @SuppressWarnings("deprecation")
    private void updateCatalogChrome() {
        boolean catalogue=finding && !originalFinderActive;
        // The web catalogue owns its compact search/header and bottom tabs.
        // Keep native Back / More while changing films in an existing room.
        findViewById(R.id.navigationToolbar).setVisibility(catalogue && !sessionActive?View.GONE:View.VISIBLE);
        int background=catalogue?0xFFFFFFFF:getColor(R.color.background);
        int text=catalogue?0xFF424956:getColor(R.color.text_primary);
        findViewById(R.id.root).setBackgroundColor(background);
        ((Button)findViewById(R.id.previousButton)).setTextColor(text);
        ((Button)findViewById(R.id.moreButton)).setTextColor(text);
        ViewGroup header=findViewById(R.id.navigationToolbar);
        for(int i=0;i<header.getChildCount();i++) if(header.getChildAt(i) instanceof TextView)
            ((TextView)header.getChildAt(i)).setTextColor(text);
        getWindow().setStatusBarColor(background);
        getWindow().setNavigationBarColor(background);
        WindowInsetsControllerCompat bars=WindowCompat.getInsetsController(getWindow(),getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(catalogue);
        bars.setAppearanceLightNavigationBars(catalogue);
    }

    private void startSession() {
        if(requestBusy || !validateIdentity()) return;
        String room = UrlPolicy.extractRoom(roomInput.getText().toString(), SERVER_HOST);
        String videoUrl = UrlPolicy.extractFirstHttpsUrl(videoUrlInput.getText().toString());
        if(!roomInput.getText().toString().trim().isEmpty()) {
            if(room.isEmpty()) {showInputError(roomInput,"请粘贴房主复制的完整房间号或邀请链接");return;}
            final String requestedRoom=room;
            requestProgram("/api/watch-rooms/"+Uri.encode(room)+"/program","GET",null,"", data -> {
                if(data.optBoolean("legacy")) {
                    if(requestedRoom.matches("[a-f0-9]{24}")) {
                        reportError("找不到这个房间，可能已过期或服务器已重启。请让房主重新创建并复制邀请；不会另开新房间。");return;
                    }
                    if(videoUrl.isEmpty()){reportError("此邀请没有可读取的片源。旧房间需双方填写同一视频链接；新流程请先找片再建房。");return;}
                    new AlertDialog.Builder(this).setTitle("按旧兼容房间加入？")
                        .setMessage("没有查到房间片源。仅在确认这是旧房间且双方已填写相同影片时继续；过期的新邀请请让房主重新发送。")
                        .setPositiveButton("确认加入",(d,w)->{programRevision=0;programSelection=null;ownerKey="";startResolved(requestedRoom,videoUrl);})
                        .setNegativeButton("取消",null).show();return;
                }
                ProgramPolicy.Selection selected=validatedProgram(data);
                if(selected==null) {reportError("邀请片源未受此版本支持；请更新 APP，未打开外部地址。");return;}
                ownerKey=preferences.getString("owner_"+requestedRoom,"");
                programRevision=data.optLong("revision");programSelection=selected;
                startResolved(requestedRoom,selected.page);
            });
            return;
        }
        if(pendingSetupSelection!=null) {
            ProgramPolicy.Selection selected=pendingSetupSelection;pendingSetupSelection=null;
            if(selected.page.equals(videoUrl)) {chooseSelection(selected);return;}
        }
        if(videoUrlInput.getText().toString().trim().isEmpty()) {showInputError(roomInput,"请粘贴朋友的邀请；自己选片请关闭此窗口");return;}
        if(videoUrl.isEmpty()) {
            showInputError(videoUrlInput, "只允许公开 HTTPS 网页，不能使用本机或局域网地址");
            return;
        }
        ProgramPolicy.Selection selected=ProgramPolicy.fromPage(videoUrl);
        if(selected!=null) {chooseSelection(selected);return;}
        new AlertDialog.Builder(this).setTitle("此播放页暂不支持邀请自动选集")
            .setMessage("可建立兼容房间，但朋友仍需自行打开同一影片。也可以返回软件内找片，选集后建立带片源的房间。")
            .setPositiveButton("建立兼容房间",(d,w)->{programRevision=0;programSelection=null;ownerKey="";startResolved("legacy-"+UUID.randomUUID().toString().replace("-", "").substring(0,24),videoUrl);})
            .setNegativeButton("返回找片",(d,w)->showFinder()).show();
    }

    private boolean validateIdentity() {
        String nickname=nicknameInput.getText().toString().trim();
        if(nickname.isEmpty()){showInputError(nicknameInput,"请填写昵称");return false;}
        if (!consentCheck.isChecked()) {
            Toast.makeText(this, "请先阅读并勾选合规使用说明", Toast.LENGTH_LONG).show();
            return false;
        }
        activeNickname = nickname.substring(0, Math.min(nickname.length(), 32));
        return true;
    }

    private void startResolved(String room, String videoUrl) {
        finding=false;
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
        statusText.setVisibility(View.VISIBLE);
        mainContent.setVisibility(View.VISIBLE);
        setStatus("正在打开视频页面…");

        bootstrapRoomPage();
        showVideoTab();
        openProgramPage(videoUrl);
        final int generation = ++bridgeGeneration;
        mainHandler.post(() -> tickBridge(generation));
    }

    private void reportError(String message) {setStatus(message);Toast.makeText(this,message,Toast.LENGTH_LONG).show();}

    private void showFinder() {
        showFinder(false);
    }

    private void showPreviousFinder() {
        showFinder(originalFinderActive && originalFinderWebView != null);
    }

    private void showFinder(boolean original) {
        finishPlayerHold(false);
        if(requestBusy)return;
        pendingSetupSelection=null;
        originalFinderActive=original;
        finding=true;navigationBack.setEnabled(true);hideKeyboard();
        exitNativeFullscreen();hideFullscreenVideo();nativePlayer.pauseLocally();destroyCompanion();
        videoWebView.evaluateJavascript("window.__twAndroidPage?.pause();document.querySelectorAll('video,audio').forEach(v=>v.pause())",null);
        nativePlayerView.setVisibility(View.GONE);videoWebView.setVisibility(View.GONE);
        catalogWebView.setVisibility(original?View.GONE:View.VISIBLE);
        if(originalFinderWebView!=null) {
            originalFinderWebView.setVisibility(original?View.VISIBLE:View.GONE);
            if(!original)pauseFinder(originalFinderWebView);
        }
        setupPanel.setVisibility(View.GONE);mainContent.setVisibility(View.VISIBLE);browserToolbar.setVisibility(View.VISIBLE);
        findViewById(R.id.finderToolbar).setVisibility(View.VISIBLE);
        videoContainer.setVisibility(View.VISIBLE);roomContainer.setVisibility(View.GONE);statusText.setVisibility(View.VISIBLE);
        setStatus("选择推荐影片，或搜索想看的片名。选好集数后再建房。");
        browserToolbar.setVisibility(original?View.VISIBLE:View.GONE);statusText.setVisibility(original?View.VISIBLE:View.GONE);
        findViewById(R.id.finderToolbar).setVisibility(original?View.VISIBLE:View.GONE);
        if(catalogWebView.getUrl()==null)catalogWebView.loadUrl(SERVER_ORIGIN+"/discover");
        updateRoomControls();
    }

    private void pauseFinder(WebView view) {
        if(view!=null)view.evaluateJavascript("document.querySelectorAll('video,audio').forEach(v=>v.pause())",null);
    }

    private void hideFinders() {
        catalogWebView.setVisibility(View.GONE);
        if(originalFinderWebView!=null){pauseFinder(originalFinderWebView);originalFinderWebView.setVisibility(View.GONE);}
    }

    private void openFinderPage(String url) {
        if(UrlPolicy.normalizeHttpsUrl(url).isEmpty())return;
        if(originalFinderWebView==null) {
            originalFinderWebView=new WebView(this);configureWebView(originalFinderWebView,true);
            originalFinderWebView.setWebViewClient(new FinderPageClient(false));
            originalFinderWebView.setWebChromeClient(new VideoChromeClient());
            videoContainer.addView(originalFinderWebView,new FrameLayout.LayoutParams(-1,-1));
        }
        showFinder(true);originalFinderWebView.loadUrl(url);
    }

    private void resumePlayback() {
        if(!sessionActive)return;
        hideFinders();finding=false;
        nativePlayerView.setVisibility(nativePlayer.isActive()?View.VISIBLE:View.GONE);
        videoWebView.setVisibility(nativePlayer.isActive()?View.GONE:View.VISIBLE);
        setupPanel.setVisibility(View.GONE);mainContent.setVisibility(View.VISIBLE);
        browserToolbar.setVisibility(View.VISIBLE);statusText.setVisibility(View.VISIBLE);
        findViewById(R.id.finderToolbar).setVisibility(View.VISIBLE);
        showVideoTab();setStatus("已返回当前播放，房间保持连接。");
    }

    private void chooseCurrentPage() {
        if(requestBusy)return;
        if(!finding && nativePlayer.isActive()){setStatus("当前已使用内置播放器，可直接播放、暂停或拖动进度。");return;}
        if(!finding && programSelection!=null) {
            if(!currentProgramPage()) {openProgramPage(programSelection.page);return;}
            if(programSelection.exact()) {awaitingEpisode=programSelection.needsConfirmation();episodeStarted=System.currentTimeMillis();setStatus("正在重新确认所选集数…");return;}
        }
        final WebView pageView=finding && originalFinderActive?originalFinderWebView:videoWebView;
        if(pageView==null)return;
        ProgramPolicy.Selection selection=ProgramPolicy.fromPage(pageView.getUrl());
        if(selection==null){reportError("当前不是已适配的播放页，请回到目录点具体集数；不会把首页当成影片。");return;}
        if(!finding && programSelection!=null && !programSelection.exact()
            && !(selection.source.equals("kanju") && !ownerKey.isEmpty())) {
            new AlertDialog.Builder(this).setTitle("确认双方已经选好同一集")
                .setMessage("此来源不能自动确认集数。请双方核对影片和集数后再开始同步。")
                .setPositiveButton("我已核对",(d,w)->{awaitingEpisode=false;appliedProgramRevision=0;})
                .setNegativeButton("取消",null).show();return;
        }
        if(selection.source.equals("kanju") && !selection.exact()) {
            // The original site can select an episode without putting it in the URL.
            final String expectedUrl=pageView.getUrl();final int epoch=flowGeneration;
            pageView.evaluateJavascript(catalogScript+";"+webSyncScript+";window.__twAndroidPage.currentEpisode('kanju')", result->{
                if(destroyed || epoch!=flowGeneration || !expectedUrl.equals(pageView.getUrl()))return;
                String episode="";try{episode=new JSONArray("["+result+"]").optString(0,"");}catch(Exception ignored){}
                ProgramPolicy.Selection exact=ProgramPolicy.create(selection.source,selection.item,episode);
                if(exact==null || !exact.exact()){reportError("还没确认当前集数。请先在原站点选一集，再点「确认当前集数」；未创建房间。");return;}
                chooseSelection(exact);
            });return;
        }
        chooseSelection(selection);
    }

    private interface ProgramResult {void accept(JSONObject value);}
    private void requestProgram(String route,String method,ProgramPolicy.Selection selection,String owner,ProgramResult result) {
        if(requestBusy)return;
        requestBusy=true;final int epoch=++flowGeneration;
        findViewById(R.id.openVideoButton).setEnabled(false);
        setStatus("正在读取房间片源…");
        networkExecutor.execute(()->{
            JSONObject data=null;String error="网络连接失败，请检查连接后重试；当前播放没有改变。";
            HttpURLConnection connection=null;
            try {
                connection=(HttpURLConnection)new URL(SERVER_ORIGIN+route).openConnection();
                connection.setRequestMethod(method);connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(10000);connection.setReadTimeout(15000);
                connection.setRequestProperty("Accept","application/json");
                if(!owner.isEmpty())connection.setRequestProperty("Authorization","Bearer "+owner);
                if(selection!=null){
                    JSONObject s=new JSONObject().put("source",selection.source).put("item",selection.item).put("episode",selection.episode);
                    byte[] body=new JSONObject().put("selection",s).toString().getBytes(StandardCharsets.UTF_8);
                    connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");
                    try(java.io.OutputStream out=connection.getOutputStream()){out.write(body);}
                }
                int code=connection.getResponseCode();
                if(code==404 && method.equals("GET")) data=new JSONObject().put("legacy",true);
                if(code!=200 && code!=201){
                    error=code==404?"邀请不存在、已过期或服务器未更新。旧兼容房间仍需双方填写相同链接。":code==403?"只有房主可以换片。":code==429?"操作较频繁，请稍后重试。":"服务器暂不支持此片源，请更新服务器或换一个来源。";
                    throw new IOException("HTTP "+code);
                }
                try(InputStream in=connection.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                    byte[] buffer=new byte[2048];int count;
                    while((count=in.read(buffer))!=-1){if(out.size()+count>16384)throw new IOException("oversize");out.write(buffer,0,count);}
                    data=new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));
                }
            } catch(Exception ignored) { /* no raw response, account data or tokens in logs */ }
            finally{if(connection!=null)connection.disconnect();}
            final JSONObject response=data;final String message=error;
            mainHandler.post(()->{
                if(destroyed || epoch!=flowGeneration)return;
                requestBusy=false;findViewById(R.id.openVideoButton).setEnabled(true);
                if(response==null)reportError(message);else result.accept(response);
            });
        });
    }

    private ProgramPolicy.Selection validatedProgram(JSONObject data) {
        if(data==null || data.optLong("revision")<1 || data.optLong("revision")>9007199254740991L)return null;
        JSONObject p=data.optJSONObject("program");if(p==null)return null;
        ProgramPolicy.Selection selection=ProgramPolicy.create(p.optString("source"),p.optString("item"),p.optString("episode"));
        return selection!=null && selection.page.equals(p.optString("page")) && selection.exact()==p.optBoolean("exact_episode") ? selection:null;
    }

    private void chooseSelection(ProgramPolicy.Selection selection) {
        if(requestBusy)return;
        // Choosing an episode is a new watch action, never an implicit rejoin
        // using an invitation left in the separate join dialog.
        if(!sessionActive)roomInput.setText("");
        if(!sessionActive && (nicknameInput.getText().toString().trim().isEmpty() || !consentCheck.isChecked())) {
            showSetup();pendingSetupSelection=selection;videoUrlInput.setText(selection.page);
            configureEntry(true);
            setStatus("首次确认后即可开始观看，以后选好影片直接进入房间。");return;
        }
        if(!validateIdentity())return;
        if(sessionActive && ownerKey.isEmpty()){reportError("只有房主可以换片。");return;}
        boolean change=sessionActive;
        requestProgram(change?"/api/watch-rooms/"+activeRoom+"/program":"/api/watch-rooms",change?"PUT":"POST",selection,change?ownerKey:"",data->{
            ProgramPolicy.Selection selected=validatedProgram(data);
            if(selected==null){reportError("服务器返回了不支持的片源，未打开外部地址。");return;}
            if(!change){
                String room=data.optString("room"), owner=data.optString("owner");
                if(!room.matches("[a-f0-9]{24}") || !owner.matches("[A-Za-z0-9_-]{32,128}")){reportError("建房回复无效，请重试。");return;}
                ownerKey=owner;preferences.edit().putString("owner_"+room,owner).apply();
                programRevision=data.optLong("revision");programSelection=selected;startResolved(room,selected.page);
            }else if(!applyRoomProgram(data)) openProgramPage(selected.page);
        });
    }

    private void openProgramPage(String page) {
        finishPlayerHold(false);
        hideFinders();
        finding=false;appliedProgramRevision=0;awaitingEpisode=programSelection!=null && (!programSelection.exact() || programSelection.needsConfirmation());
        episodeStarted=System.currentTimeMillis();nativePlayer.release();destroyCompanion();
        mediaCandidates.clear();protectedPage=false;sourcePageUrl=page;++videoPageGeneration;
        preferWebThisPage=false;lastActiveCandidate="";activeCandidateCount=0;videoLoading=true;
        browserToolbar.setVisibility(View.VISIBLE);statusText.setVisibility(View.VISIBLE);
        nativePlayerView.setVisibility(View.GONE);videoWebView.setVisibility(View.VISIBLE);showVideoTab();
        if(MediaSourcePolicy.isMedia(page))openNative(page,0);else videoWebView.loadUrl(page);
    }

    private boolean applyRoomProgram(JSONObject data) {
        if(data==null || data.optLong("revision")<=programRevision)return false;
        ProgramPolicy.Selection selection=validatedProgram(data);
        if(selection==null){programRevision=data.optLong("revision");programSelection=null;reportError("房主选择了当前版本不支持的来源，已暂停同步。");awaitingEpisode=true;nativePlayer.pauseLocally();return true;}
        programRevision=data.optLong("revision");programSelection=selection;
        openProgramPage(selection.page);return true;
    }

    private void bootstrapRoomPage() {
        roomBootstrapPending = true;
        roomWebView.loadUrl(SERVER_ORIGIN + "/");
    }

    private void showVideoTab() {
        exitNativeFullscreen();
        videoContainer.setVisibility(View.VISIBLE);
        roomContainer.setVisibility(finding?View.GONE:View.VISIBLE);
        ((Button) findViewById(R.id.fullscreenButton)).setText("全屏");
        updateRoomControls();
    }

    private void showRoomTab() {
        if(!sessionActive){reportError("选好影片并创建房间后，就能聊天和通话。");return;}
        exitNativeFullscreen();
        videoContainer.setVisibility(View.GONE);
        roomContainer.setVisibility(View.VISIBLE);
        setStatus("房间页：可聊天、调整音量和加入语音通话");
        updateRoomControls();
    }

    private void showSetup() {
        pendingSetupSelection=null;
        roomInput.setText("");videoUrlInput.setText("");
        exitNativeFullscreen();
        sessionActive = false;
        finding=false;requestBusy=false;++flowGeneration;
        updateCatalogChrome();
        programRevision=0;appliedProgramRevision=0;programSelection=null;ownerKey="";awaitingEpisode=false;
        findViewById(R.id.openVideoButton).setEnabled(true);
        findViewById(R.id.finderToolbar).setVisibility(View.GONE);
        navigationBack.setEnabled(true);
        hideFinders();
        cancelPendingMicrophone();
        closeRoutingPopup();
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
        statusText.setVisibility(View.GONE);
        setupPanel.setVisibility(View.VISIBLE);
        mainContent.setVisibility(View.GONE);
        findViewById(R.id.moreButton).setVisibility(View.GONE);
        configureEntry(false);
    }

    private void configureEntry(boolean selected) {
        ((TextView)findViewById(R.id.setupTitle)).setText(selected?"开始一起看":"加入朋友房间");
        ((TextView)findViewById(R.id.setupHint)).setText(selected?"首次确认一下，以后选好影片直接观看。":"粘贴邀请，自动打开朋友正在看的影片。");
        ((TextView)findViewById(R.id.setupStatus)).setText("");
        ((Button)findViewById(R.id.openVideoButton)).setText(selected?"开始观看":"加入房间");
        roomInput.setVisibility(selected?View.GONE:View.VISIBLE);
        findViewById(R.id.entryAdvancedButton).setVisibility(selected?View.GONE:View.VISIBLE);
        setEntryAdvanced(false);
        if(selected) {
            nicknameInput.setVisibility(View.VISIBLE);consentCheck.setVisibility(View.VISIBLE);
            findViewById(R.id.legalLinks).setVisibility(View.VISIBLE);
        }
    }

    private void setEntryAdvanced(boolean expanded) {
        boolean identityNeeded=!consentCheck.isChecked() || nicknameInput.getText().toString().trim().isEmpty();
        nicknameInput.setVisibility(expanded || identityNeeded?View.VISIBLE:View.GONE);
        consentCheck.setVisibility(expanded || identityNeeded?View.VISIBLE:View.GONE);
        findViewById(R.id.legalLinks).setVisibility(expanded || identityNeeded?View.VISIBLE:View.GONE);
        videoUrlInput.setVisibility(expanded?View.VISIBLE:View.GONE);
        autoNativeCheck.setVisibility(expanded?View.VISIBLE:View.GONE);
        findViewById(R.id.sampleButton).setVisibility(expanded?View.VISIBLE:View.GONE);
        ((Button)findViewById(R.id.entryAdvancedButton)).setText(expanded?"收起选项":"昵称 / 手动链接");
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
        if (nativeFullscreen || fullscreenView != null) applyImmersive(true);
    }

    private void tickBridge(int generation) {
        if (destroyed || !foreground || !sessionActive || generation != bridgeGeneration) return;
        if(!trustedRoomPage()){scheduleBridge(generation);return;}
        roomWebView.evaluateJavascript("window.TogetherWatchMobile?.program()", result->{
            if(!bridgeCurrent(generation))return;
            if(programRevision>0)try{if(applyRoomProgram(new JSONObject(result))){scheduleBridge(generation);return;}}catch(Exception ignored){}
            samplePlayer(generation);
        });
    }

    private boolean trustedRoomPage() {
        String url=roomWebView.getUrl();
        return UrlPolicy.isTrustedServerUrl(url,SERVER_HOST) && ("/mobile-room/"+activeRoom).equals(Uri.parse(url).getPath());
    }
    private boolean bridgeCurrent(int generation) {return !destroyed && foreground && sessionActive && generation==bridgeGeneration && trustedRoomPage();}
    private void scheduleBridge(int generation) {mainHandler.postDelayed(()->tickBridge(generation),300);}
    private boolean currentProgramPage() {
        if(programSelection==null)return false;
        String url=videoWebView.getUrl();
        if(programSelection.page.equals(url))return true;
        ProgramPolicy.Selection actual=ProgramPolicy.fromPage(url);
        return actual!=null && actual.source.equals(programSelection.source) && actual.item.equals(programSelection.item) && actual.episode.equals(programSelection.episode);
    }
    private void samplePlayer(int generation) {
        final int page=videoPageGeneration;
        playerBridgeNotice="";
        if(finding || (programRevision>0 && programSelection==null)) {deliverSample(generation,page,new JSONObject(),-1);return;}
        if(programRevision>0 && !nativePlayer.isActive() && (!currentProgramPage() || videoLoading)) {
            if(!videoLoading)setStatus("当前页面与房间片源不同。可在「更多」中核对当前集数并恢复同步。");
            deliverSample(generation,page,new JSONObject(),-1);return;
        }
        if(awaitingEpisode) {
            if(!programSelection.exact()){setStatus("请双方核对同一集，再到「更多 → 核对当前集数」开始同步。");deliverSample(generation,page,new JSONObject(),-1);return;}
            if(System.currentTimeMillis()-episodeStarted>20000){setStatus("尚未确认集数。请在原站选好后，到「更多 → 核对当前集数」重试。");deliverSample(generation,page,new JSONObject(),-1);return;}
            videoWebView.evaluateJavascript(catalogScript+";"+webSyncScript+";window.__twAndroidPage.confirm("+js(programSelection.source)+","+js(programSelection.episode)+")", confirmed->{
                if(!bridgeCurrent(generation))return;
                if(page!=videoPageGeneration){scheduleBridge(generation);return;}
                if("true".equals(confirmed)) {awaitingEpisode=false;setStatus("已确认所选集数，正在接入同步…");}
                else if(System.currentTimeMillis()-episodeStarted>20000)setStatus("尚未确认所选集数。请在原站选好这一集；登录或验证需本人完成。");
                deliverSample(generation,page,new JSONObject(),-1);
            });return;
        }
        if(!nativePlayer.isActive() && System.currentTimeMillis()-lastDiscovery>2000)discoverMedia();
        if(nativePlayer.isActive()) {deliverSample(generation,page,nativePlayer.sample(),-1);return;}
        if(playerAgent.isEmpty() || webSyncScript.isEmpty()){setStatus("播放器组件缺失，请重新安装完整 APK。");deliverSample(generation,page,new JSONObject(),-1);return;}
        videoWebView.evaluateJavascript(WebPlayerScripts.sample(webSyncScript,playerAgent),result->{
            if(!bridgeCurrent(generation))return;
            if(page!=videoPageGeneration){scheduleBridge(generation);return;}
            JSONObject sample=new JSONObject();long localSession=-1;
            String reason="adapter_error";
            try {if(result.length()>65536)throw new IOException("oversize");JSONObject raw=new JSONObject(result);sample=PlaybackBoundary.sample(raw,page);localSession=raw.optLong("session",-1);reason=raw.optString("reason","no_video");}catch(Exception ignored){}
            if(!sample.optBoolean("active")) {
                playerBridgeNotice=WebPlayerScripts.diagnostic(reason);
                setStatus(playerBridgeNotice);
            } else {
                setStatus(sample.optBoolean("ready")?"已识别网页播放器；连接进度请看下方房间状态。":"已识别网页播放器，正在等待视频就绪…");
            }
            deliverSample(generation,page,sample,localSession);
        });
    }
    private void deliverSample(int generation,int page,JSONObject sample,long localSession) {
        if(!bridgeCurrent(generation))return;
        if(page!=videoPageGeneration){scheduleBridge(generation);return;}
        final long revision=programRevision;
        danmakuTime=sample.optDouble("visualTime",sample.optDouble("time",0));danmakuSpeed=sample.optDouble("visualSpeed",sample.optDouble("speed",1));
        if (holdGestureActive) {
            if(sample.optBoolean("holding"))holdObserved=true;
            else if(holdObserved)finishPlayerHold(false);
        }
        danmakuPlaying=sample.optBoolean("active")&&sample.optBoolean("ready")&&sample.optBoolean("playing")&&!sample.optBoolean("seeking");
        danmakuSampleAt=android.os.SystemClock.elapsedRealtime();
        if(!sample.optBoolean("active")){lastDanmakuPacket=null;if(webFullscreenDanmaku!=null)webFullscreenDanmaku.update(null);}
        try { sample.put("title",videoWebView.getTitle()==null?"":videoWebView.getTitle().substring(0,Math.min(160,videoWebView.getTitle().length()))); }catch(Exception ignored){}
        boolean apply=revision>0 && appliedProgramRevision!=revision && !awaitingEpisode && !finding && programSelection!=null && sample.optBoolean("active");
        String script="(function(){const b=window.TogetherWatchMobile;if(!b)return null;b.context?.({owner:"+(!ownerKey.isEmpty())+"});"
            +(apply?"b.applyProgram("+revision+");":"")+"b.receive("+sample+");"
            // Also works with the deployed room script: a connected chat must
            // not keep saying "opening the episode" after detection has failed.
            +(!playerBridgeNotice.isEmpty()?"const s=document.getElementById('mobilePlayerStatus');if(s)s.textContent="+js(playerBridgeNotice)+";":"")
            +"return b.drain();})()";
        roomWebView.evaluateJavascript(script,result->{
            if(!bridgeCurrent(generation))return;
            if(page!=videoPageGeneration || revision!=programRevision){scheduleBridge(generation);return;}
            try {
                JSONObject response=new JSONObject(result);
                if(response.optInt("version")==1){
                    bridgeMisses=0;if(apply)appliedProgramRevision=revision;
                    JSONObject overlay=DanmakuPacket.clean(response.optJSONObject("overlay"),sample.opt("session"));
                    if(overlay!=null){
                        lastDanmakuPacket=overlay;if(webFullscreenDanmaku!=null)webFullscreenDanmaku.update(overlay);
                        if(nativePlayer.isActive())nativePlayer.overlay(overlay);
                        else if(localSession>=0){
                            JSONObject pageOverlay=fullscreenView==null?overlay:new JSONObject().put("enabled",false).put("items",new JSONArray());
                            videoWebView.evaluateJavascript("window.__twAndroidPage?.overlay("+pageOverlay+")",null);
                        }
                    }
                    JSONArray commands=response.optJSONArray("commands");
                    if(commands!=null)for(int i=0;i<Math.min(16,commands.length());i++){
                        JSONObject command=commands.optJSONObject(i);if(command==null)continue;
                        if(nativePlayer.isActive() && !finding && !awaitingEpisode)nativePlayer.apply(command);
                        else if(localSession>=0){JSONObject clean=PlaybackBoundary.command(command,page,localSession);if(clean!=null)videoWebView.evaluateJavascript("window.__twAndroidPage?.apply("+clean+")",null);}
                    }
                }
            }catch(Exception ignored){if(++bridgeMisses==20)setStatus("房间组件尚未就绪，请先更新服务器并重新进入房间。");}
            scheduleBridge(generation);
        });
    }

    private void rememberCandidate(String rawUrl, JSONObject details) {
        if (!sessionActive || finding || awaitingEpisode || protectedPage || MediaSourcePolicy.preferWeb(sourcePageUrl)) return;
        String url = UrlPolicy.normalizeHttpsUrl(rawUrl);
        if (url.isEmpty() || !MediaSourcePolicy.isMedia(url)) return;
        if (!mediaCandidates.containsKey(url) && mediaCandidates.size() >= 24) return;
        mediaCandidates.put(url, details == null ? new JSONObject() : details);
    }

    private void discoverMedia() {
        lastDiscovery = System.currentTimeMillis();
        if (discoveryInFlight || destroyed || !sessionActive || finding || awaitingEpisode || nativePlayer.isActive()
            || discoveryScript.isEmpty() || MediaSourcePolicy.preferWeb(sourcePageUrl)) return;
        discoveryInFlight = true;
        int generation = videoPageGeneration;
        videoWebView.evaluateJavascript(discoveryScript, result -> {
            discoveryInFlight = false;
            if (destroyed || finding || awaitingEpisode || generation != videoPageGeneration || !sessionActive || nativePlayer.isActive()) return;
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
        if(finding || awaitingEpisode)return;
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
        awaitingEpisode=programSelection!=null && (!programSelection.exact() || programSelection.needsConfirmation());
        appliedProgramRevision=0;episodeStarted=System.currentTimeMillis();
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
        ((TextView)findViewById(R.id.setupStatus)).setText(text);
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
        if(!videoUrlInput.getText().toString().isEmpty())setEntryAdvanced(true);
    }

    private final class FinderPageClient extends WebViewClient {
        private final boolean catalogue;
        FinderPageClient(boolean catalogue) {this.catalogue=catalogue;}
        @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) {
            if(!request.isForMainFrame())return !"https".equalsIgnoreCase(request.getUrl().getScheme());
            String url=request.getUrl().toString();
            if(catalogue) {
                // Only explicit actions from our first-party catalogue may
                // select a room source. Source sites receive no native bridge.
                if(!finding || !request.hasGesture() || !UrlPolicy.isTrustedServerUrl(view.getUrl(),SERVER_HOST))return true;
                if(url.equals(SERVER_ORIGIN+"/#roomEntry")) {
                    showSetup();roomInput.setText("");videoUrlInput.setText("");return true;
                }
                if(url.equals(SERVER_ORIGIN+"/") || url.equals(SERVER_ORIGIN+"/discover")) {
                    view.evaluateJavascript("window.TogetherWatchCatalogNavigation?.home()",null);return true;
                }
                ProgramPolicy.Selection selection=ProgramPolicy.handoff(url,SERVER_ORIGIN);
                if(selection!=null){chooseSelection(selection);return true;}
                if(!UrlPolicy.normalizeHttpsUrl(url).isEmpty())openFinderPage(url);
                return true;
            }
            return UrlPolicy.normalizeHttpsUrl(url).isEmpty();
        }
        @Override public void onPageFinished(WebView view,String url) {
            if(!catalogue && finding && originalFinderActive && !pageLayoutScript.isEmpty())view.evaluateJavascript(pageLayoutScript,null);
        }
        @Override public void onPageStarted(WebView view,String url,Bitmap icon) {
            if(catalogue && catalogMetadata!=null)catalogMetadata.navigation();
        }
        @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error) {
            if(finding && request.isForMainFrame())reportError("找片页面加载失败，可返回上一步或稍后重试。");
        }
        @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,android.net.http.SslError error) {handler.cancel();}
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
            if(finding && request.isForMainFrame() && request.hasGesture()
                    && UrlPolicy.isTrustedServerUrl(view.getUrl(),SERVER_HOST)
                    && uri.toString().equals(SERVER_ORIGIN+"/")) {
                showFinder();return true;
            }
            if(finding && request.isForMainFrame() && request.hasGesture()
                    && UrlPolicy.isTrustedServerUrl(view.getUrl(),SERVER_HOST)
                    && uri.toString().equals(SERVER_ORIGIN+"/#roomEntry")) {
                showSetup();roomInput.setText("");videoUrlInput.setText("");
                setStatus("粘贴朋友的邀请链接或房间号，确认后加入同一个房间。");return true;
            }
            ProgramPolicy.Selection selected=ProgramPolicy.handoff(uri.toString(),SERVER_ORIGIN);
            if(request.isForMainFrame() && selected!=null) {
                if(finding && request.hasGesture() && UrlPolicy.isTrustedServerUrl(view.getUrl(),SERVER_HOST))chooseSelection(selected);
                else reportError("请在找片页点击具体集数后创建房间。");
                return true;
            }
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
            finishPlayerHold(false);
            videoLoading=true;
            videoPageGeneration += 1;
            protectedPage = false;
            mediaCandidates.clear();
            lastActiveCandidate = "";
            activeCandidateCount = 0;
            if(!finding)sourcePageUrl = url;
            destroyCompanion();
            if(!finding)setStatus("网页加载中…");
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if(!url.equals(view.getUrl()))return;
            videoLoading=false;
            if(!pageLayoutScript.isEmpty())view.evaluateJavascript(pageLayoutScript,null);
            if(finding)return;
            if (!sessionActive || nativePlayer.isActive() || !UrlPolicy.isHttpsWebUrl(url)) return;
            int generation = videoPageGeneration;
            if(programRevision>0){
                if(awaitingEpisode && currentProgramPage())episodeStarted=System.currentTimeMillis();
                setStatus("网页已打开，正在确认房间片源与播放器…");return;
            }
            // Both room types use the local timing bridge; no bookmarklet popup.
            setStatus("网页已打开，正在识别播放器并连接房间同步…");
            discoverMedia();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (!finding && request.isForMainFrame()) {
                statusText.setVisibility(View.VISIBLE);
                setStatus("网页加载失败，可返回找片重试：" + error.getDescription());
            }
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, android.net.http.SslError error) {
            handler.cancel();
            if(finding)return;
            statusText.setVisibility(View.VISIBLE);
            setStatus("网页证书异常，已停止访问");
        }
    }

    private final class RoomPageClient extends WebViewClient {
        @Override public void onPageStarted(WebView view,String url,Bitmap favicon) {
            cancelPendingMicrophone();appliedProgramRevision=0;
            super.onPageStarted(view,url,favicon);
        }
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            String path=request.getUrl().getPath();
            if (UrlPolicy.isTrustedServerUrl(url, SERVER_HOST)
                && (("/mobile-room/"+activeRoom).equals(path) || (roomBootstrapPending && "/".equals(path)))) return false;
            if(!UrlPolicy.normalizeHttpsUrl(url).isEmpty() && request.hasGesture())openExternal(url);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if(sessionActive && foreground && trustedRoomPage() && url.equals(view.getUrl())) {
                final int generation=++bridgeGeneration;
                mainHandler.post(()->tickBridge(generation));
            }
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
        @Override public void onPermissionRequest(PermissionRequest request) {runOnUiThread(request::deny);}
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            if(finding || programRevision>0) {
                if(!isUserGesture)return false;
                final boolean wasFinding=finding;
                final boolean trustedOrigin=UrlPolicy.isTrustedServerUrl(view.getUrl(),SERVER_HOST);
                final int popupGeneration=videoPageGeneration;
                closeRoutingPopup();
                WebView popup=new WebView(MainActivity.this);
                routingPopup=popup;
                configureWebView(popup,false);
                // No third-party JS runs in this temporary routing window.
                popup.getSettings().setJavaScriptEnabled(false);
                popup.setWebViewClient(new WebViewClient(){
                    private boolean routed;
                    private void route(String url){
                        if(routed || "about:blank".equals(url))return;routed=true;
                        if(destroyed || routingPopup!=popup || popupGeneration!=videoPageGeneration){mainHandler.post(()->{if(routingPopup==popup)closeRoutingPopup();});return;}
                        ProgramPolicy.Selection selected=ProgramPolicy.handoff(url,SERVER_ORIGIN);
                        if(wasFinding && finding && trustedOrigin && selected!=null)chooseSelection(selected);
                        else if(!UrlPolicy.normalizeHttpsUrl(url).isEmpty() && selected==null) {
                            if(wasFinding && finding)openFinderPage(url);else if(!wasFinding)videoWebView.loadUrl(url);
                        }
                        mainHandler.post(()->{if(routingPopup==popup)closeRoutingPopup();});
                    }
                    @Override public boolean shouldOverrideUrlLoading(WebView w,WebResourceRequest r){route(r.getUrl().toString());return true;}
                    @Override public void onPageStarted(WebView w,String url,Bitmap icon){w.stopLoading();route(url);}
                    @Override public void onReceivedSslError(WebView w,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();}
                });
                WebView.WebViewTransport transport=(WebView.WebViewTransport)resultMsg.obj;
                transport.setWebView(popup);resultMsg.sendToTarget();
                mainHandler.postDelayed(()->{if(routingPopup==popup)closeRoutingPopup();},15000);return true;
            }
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
        if (!foreground || !sessionActive || !trustedRoomPage() || !UrlPolicy.isTrustedServerUrl(request.getOrigin().toString(), SERVER_HOST)) {
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
        cancelPendingMicrophone();pendingAudioPermission = request;
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
        if (foreground && sessionActive && trustedRoomPage()
            && UrlPolicy.isTrustedServerUrl(request.getOrigin().toString(),SERVER_HOST)
            && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            request.deny();
            Toast.makeText(this, "未取得当前房间的麦克风授权。可到系统设置 → 应用 → 一起看 → 权限开启麦克风，再点加入语音。", Toast.LENGTH_LONG).show();
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
                        setStatus("同步助手下载失败，可在「更多 → 播放方式与故障处理」中重试");
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
        if (destroyed || !foreground || finding || programRevision>0 || !sessionActive || nativePlayer.isActive() || generation != videoPageGeneration) return;
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

    private void closeRoutingPopup() {
        if(routingPopup==null)return;
        WebView old=routingPopup;routingPopup=null;old.stopLoading();old.destroy();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private boolean containsTouch(View view, float x, float y) {
        if (view == null || !view.isShown()) return false;
        android.graphics.Rect r = new android.graphics.Rect();
        return view.getGlobalVisibleRect(r) && r.contains((int)x, (int)y);
    }

    private boolean touchesPlayerControl(View view, float x, float y) {
        if (!containsTouch(view,x,y)) return false;
        if (view instanceof Button || view instanceof android.widget.ImageButton || view instanceof android.widget.SeekBar
                || view instanceof androidx.media3.ui.DefaultTimeBar) return true;
        if (view instanceof ViewGroup) {
            ViewGroup group=(ViewGroup)view;
            for(int i=0;i<group.getChildCount();i++) if(touchesPlayerControl(group.getChildAt(i),x,y))return true;
        }
        return false;
    }

    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        int action=event.getActionMasked();
        if(action==MotionEvent.ACTION_DOWN) {
            finishPlayerHold(false);
            playerTouchConsumed=false;
            holdX=event.getRawX();holdY=event.getRawY();holdDownTime=event.getDownTime();
            holdNativeMode=nativePlayer!=null && nativePlayer.isActive();
            holdTouchTarget=fullscreenView!=null?fullscreenView:holdNativeMode?nativePlayerView:videoWebView;
            touchCandidate=foreground && sessionActive && !finding && !awaitingEpisode && !videoLoading
                && containsTouch(holdTouchTarget,holdX,holdY) && !containsTouch(fullscreenControls,holdX,holdY)
                && !(holdNativeMode && touchesPlayerControl(nativePlayerView,holdX,holdY));
            if(touchCandidate) {
                int[] location=new int[2];holdTouchTarget.getLocationOnScreen(location);
                holdNx=(holdX-location[0])/Math.max(1,holdTouchTarget.getWidth());
                holdNy=(holdY-location[1])/Math.max(1,holdTouchTarget.getHeight());
                // Keep the seek bar / native fullscreen controls available for dragging.
                if((holdNativeMode || fullscreenView!=null) && holdNy>.80f)touchCandidate=false;
            }
            if(touchCandidate) {
                final int token=holdToken;
                if(!holdNativeMode)videoWebView.evaluateJavascript(webHoldScript("canHold"),result->{
                    if(token==holdToken && touchCandidate)webHoldEligible="true".equals(result);
                });
                mainHandler.postDelayed(startPlayerHold,450);
            }
        } else if(action==MotionEvent.ACTION_POINTER_DOWN || action==MotionEvent.ACTION_CANCEL) {
            boolean consumed=playerTouchConsumed;finishPlayerHold(false);
            if(action==MotionEvent.ACTION_CANCEL)playerTouchConsumed=false;
            if(consumed)return true;
        } else if(action==MotionEvent.ACTION_MOVE && touchCandidate) {
            if(Math.hypot(event.getRawX()-holdX,event.getRawY()-holdY)>ViewConfiguration.get(this).getScaledTouchSlop()*2) {
                boolean consumed=playerTouchConsumed;finishPlayerHold(false);if(consumed)return true;
            }
        } else if(action==MotionEvent.ACTION_UP) {
            boolean consumed=playerTouchConsumed, tap=touchCandidate;
            finishPlayerHold(holdGestureActive);
            playerTouchConsumed=false;
            if(consumed)return true;
            boolean handled=super.dispatchTouchEvent(event);
            if(tap && fullscreenView!=null) {
                if(fullscreenControls!=null && fullscreenControls.getVisibility()==View.VISIBLE)hideFullscreenUi.run();
                else showFullscreenControls();
            }
            return handled;
        }
        return playerTouchConsumed || super.dispatchTouchEvent(event);
    }

    private String webHoldScript(String method) {
        return "window.__twAndroidPage?.holdAt("+js(method)+","+holdNx+","+holdNy+","+(fullscreenView!=null)+")";
    }

    private void startPlayerHold() {
        if(!touchCandidate || destroyed || !foreground || (!holdNativeMode && !webHoldEligible))return;
        holdRequested=true;playerTouchConsumed=true;
        final int token=holdToken;
        MotionEvent cancel=MotionEvent.obtain(holdDownTime,android.os.SystemClock.uptimeMillis(),MotionEvent.ACTION_CANCEL,holdX,holdY,0);
        super.dispatchTouchEvent(cancel);cancel.recycle();
        if(holdNativeMode) {
            if(nativePlayer.beginHold())activatePlayerHold();else finishPlayerHold(false);
        } else videoWebView.evaluateJavascript(webHoldScript("beginHold"),result->{
            if(token!=holdToken)return;
            if("true".equals(result))activatePlayerHold();else finishPlayerHold(false);
        });
    }

    private void activatePlayerHold() {
        holdGestureActive=true;holdObserved=false;mainHandler.removeCallbacks(hideFullscreenUi);hideFullscreenUi.run();
        nativePlayerView.hideController();
        holdSpeedHint=new TextView(this);holdSpeedHint.setText("▶▶ 临时倍速中 · 松手恢复");
        holdSpeedHint.setTextColor(0xffffffff);holdSpeedHint.setTextSize(13);holdSpeedHint.setPadding(dp(12),dp(6),dp(12),dp(6));
        holdSpeedHint.setBackgroundColor(0x99000000);holdSpeedHint.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        FrameLayout host=(nativeFullscreen || fullscreenView!=null)?fullscreenContainer:videoContainer;
        FrameLayout.LayoutParams layout=new FrameLayout.LayoutParams(-2,-2,Gravity.TOP|Gravity.CENTER_HORIZONTAL);
        layout.topMargin=dp(10);host.addView(holdSpeedHint,layout);
    }

    private void finishPlayerHold(boolean commit) {
        mainHandler.removeCallbacks(startPlayerHold);
        boolean requested=holdRequested, active=holdGestureActive;
        touchCandidate=false;holdRequested=false;holdGestureActive=false;webHoldEligible=false;holdToken++;
        if(nativePlayer!=null)nativePlayer.endHold(commit && active);
        if(requested && !holdNativeMode && videoWebView!=null && !destroyed)
            videoWebView.evaluateJavascript("window.__twAndroidPage?.endHold("+(commit && active)+")",null);
        if(holdSpeedHint!=null && holdSpeedHint.getParent() instanceof ViewGroup)((ViewGroup)holdSpeedHint.getParent()).removeView(holdSpeedHint);
        holdSpeedHint=null;
    }

    private void showFullscreenVideo(View view, WebChromeClient.CustomViewCallback callback) {
        finishPlayerHold(false);
        exitNativeFullscreen();
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
        enterImmersive();
        webFullscreenDanmaku=new DanmakuView(this,()->danmakuTime+(danmakuPlaying?Math.min(1.5,(android.os.SystemClock.elapsedRealtime()-danmakuSampleAt)/1000.0)*danmakuSpeed:0),()->0);
        fullscreenContainer.addView(webFullscreenDanmaku,new FrameLayout.LayoutParams(-1,-1));
        webFullscreenDanmaku.update(lastDanmakuPacket);
        addFullscreenControls(false);
    }

    private void hideFullscreenVideo() {
        if (fullscreenView == null) return;
        finishPlayerHold(false);
        fullscreenContainer.removeView(fullscreenView);
        if(webFullscreenDanmaku!=null){webFullscreenDanmaku.update(null);fullscreenContainer.removeView(webFullscreenDanmaku);webFullscreenDanmaku=null;}
        removeFullscreenControls();
        fullscreenContainer.setVisibility(View.GONE);
        fullscreenView = null;
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
        leaveImmersive();
        mainContent.setVisibility(View.VISIBLE);
    }

    private void enterWebFullscreen() {
        // This requests the page's real video fullscreen, not a larger WebView
        // containing menus, adverts and empty page margins.
        videoWebView.evaluateJavascript("(function(){const v=Array.from(document.querySelectorAll('video')).sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];if(!v||!v.requestFullscreen)return false;v.requestFullscreen().catch(()=>{});return true;})()", result -> {
            // WebView may reject a scripted request for lack of a browser user
            // gesture. Verify the actual callback instead of claiming success.
            mainHandler.postDelayed(() -> {
                if (!destroyed && sessionActive && fullscreenView == null && !nativeFullscreen) {
                    Toast.makeText(this, "请点原网页播放器里的全屏按钮；网页未允许直接全屏", Toast.LENGTH_LONG).show();
                }
            }, 800);
        });
    }

    private void enterNativeFullscreen() {
        if (nativeFullscreen || !nativePlayer.isActive()) return;
        finishPlayerHold(false);
        hideFullscreenVideo();
        nativeFullscreen = true;
        ((ViewGroup) nativePlayerView.getParent()).removeView(nativePlayerView);
        fullscreenContainer.addView(nativePlayerView, new FrameLayout.LayoutParams(-1, -1));
        mainContent.setVisibility(View.GONE);
        fullscreenContainer.setVisibility(View.VISIBLE);
        nativePlayerView.setResizeMode(cropFullscreen ? AspectRatioFrameLayout.RESIZE_MODE_ZOOM : AspectRatioFrameLayout.RESIZE_MODE_FIT);
        nativePlayerView.setFullscreenButtonState(true);
        enterImmersive();
        addFullscreenControls(true);
        nativePlayerView.showController();
    }

    private void exitNativeFullscreen() {
        if (!nativeFullscreen) return;
        finishPlayerHold(false);
        nativeFullscreen = false;
        fullscreenContainer.removeView(nativePlayerView);
        removeFullscreenControls();
        videoContainer.addView(nativePlayerView, new FrameLayout.LayoutParams(-1, -1));
        nativePlayerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        nativePlayerView.setFullscreenButtonState(false);
        fullscreenContainer.setVisibility(View.GONE);
        mainContent.setVisibility(View.VISIBLE);
        leaveImmersive();
    }

    private void addFullscreenControls(boolean nativeMode) {
        removeFullscreenControls();
        fullscreenControls = new LinearLayout(this);
        fullscreenControls.setOrientation(LinearLayout.HORIZONTAL);
        Button exit = new Button(this);
        exit.setText("‹ 返回");
        exit.setContentDescription("退出全屏");
        styleFullscreenButton(exit);
        exit.setOnClickListener(v -> { if (nativeFullscreen) exitNativeFullscreen(); else hideFullscreenVideo(); });
        fullscreenControls.addView(exit);
        if (nativeMode) {
            Button crop = new Button(this);
            styleFullscreenButton(crop);
            crop.setText(cropFullscreen ? "显示完整画面" : "铺满屏幕（裁边）");
            crop.setOnClickListener(v -> {
                cropFullscreen = !cropFullscreen;
                nativePlayerView.setResizeMode(cropFullscreen ? AspectRatioFrameLayout.RESIZE_MODE_ZOOM : AspectRatioFrameLayout.RESIZE_MODE_FIT);
                crop.setText(cropFullscreen ? "显示完整画面" : "铺满屏幕（裁边）");
                showFullscreenControls();
            });
            fullscreenControls.addView(crop);
        }
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START);
        params.setMargins(dp(12), dp(8), dp(12), 0);
        fullscreenContainer.addView(fullscreenControls, params);
        showFullscreenControls();
    }

    private void styleFullscreenButton(Button button) {
        button.setTextSize(13);button.setTextColor(0xffffffff);button.setAllCaps(false);
        button.setBackgroundColor(0x66000000);button.setMinWidth(0);button.setMinimumWidth(0);
        button.setMinHeight(0);button.setMinimumHeight(0);button.setPadding(dp(12),0,dp(12),0);
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-2,dp(48));p.setMarginEnd(dp(8));button.setLayoutParams(p);
    }

    private void showFullscreenControls() {
        if(fullscreenControls==null || holdGestureActive)return;
        fullscreenControls.setVisibility(View.VISIBLE);
        mainHandler.removeCallbacks(hideFullscreenUi);mainHandler.postDelayed(hideFullscreenUi,2500);
    }

    private void removeFullscreenControls() {
        mainHandler.removeCallbacks(hideFullscreenUi);
        if (fullscreenControls != null) fullscreenContainer.removeView(fullscreenControls);
        fullscreenControls = null;
    }

    private void enterImmersive() {
        hideKeyboard();
        orientationBeforeFullscreen = getRequestedOrientation();
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        applyImmersive(true);
    }

    private void leaveImmersive() {
        applyImmersive(false);
        setRequestedOrientation(orientationBeforeFullscreen);
    }

    private void applyImmersive(boolean fullscreen) {
        View root = findViewById(R.id.root);
        root.setFitsSystemWindows(!fullscreen);
        if (fullscreen) root.setPadding(0, 0, 0, 0);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), !fullscreen);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), root);
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        if (fullscreen) bars.hide(WindowInsetsCompat.Type.systemBars());
        else bars.show(WindowInsetsCompat.Type.systemBars());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode = fullscreen
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            getWindow().setAttributes(attributes);
        }
        root.requestApplyInsets();
    }

    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if(!focused) { finishPlayerHold(false);mainHandler.removeCallbacks(hideFullscreenUi);hideFullscreenUi.run(); }
        if (focused && (nativeFullscreen || fullscreenView != null)) { applyImmersive(true);showFullscreenControls(); }
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
        if(requestBusy || backPending)return;
        if (nativeFullscreen) { showVideoTab(); return; }
        if (fullscreenView != null) {
            hideFullscreenVideo();
            return;
        }
        if(setupPanel.getVisibility()==View.VISIBLE){showPreviousFinder();return;}
        if (videoContainer.getVisibility() != View.VISIBLE) {
            showVideoTab();
            return;
        }
        if(finding && originalFinderActive && originalFinderWebView!=null) {
            if(originalFinderWebView.canGoBack())originalFinderWebView.goBack();else showFinder();
            return;
        }
        if(finding) {
            backPending=true;
            final int epoch=flowGeneration;
            catalogWebView.evaluateJavascript("window.TogetherWatchCatalogNavigation?.back() === true", handled->{
                backPending=false;
                if(destroyed || epoch!=flowGeneration || !finding || originalFinderActive || "true".equals(handled))return;
                if(sessionActive)resumePlayback();
                else new AlertDialog.Builder(this).setTitle("退出一起看？")
                    .setMessage("已经在推荐首页。退出后，本次搜索位置不会保留。")
                    .setNegativeButton("继续找片",null).setPositiveButton("退出",(dialog,which)->finish()).show();
            });
            return;
        }
        showPreviousFinder();
    }

    @Override
    protected void onStop() {
        finishPlayerHold(false);
        mainHandler.removeCallbacks(hideFullscreenUi);
        hideFullscreenUi.run();
        foreground = false;
        if(catalogMetadata!=null)catalogMetadata.flush();
        cancelPendingMicrophone();
        closeRoutingPopup();
        ++bridgeGeneration;
        if (nativePlayer != null) nativePlayer.pauseLocally();
        if(videoWebView!=null)videoWebView.evaluateJavascript("window.__twAndroidPage?.pause();document.querySelectorAll('video,audio').forEach(v=>v.pause())",null);
        pauseFinder(originalFinderWebView);
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
        finishPlayerHold(false);
        destroyed = true;
        if(catalogMetadata!=null)catalogMetadata.close();
        sessionActive = false;
        ++bridgeGeneration;
        mainHandler.removeCallbacksAndMessages(null);
        nativePlayer.release();
        cancelPendingMicrophone();
        destroyCompanion();
        closeRoutingPopup();
        if (videoWebView != null) videoWebView.destroy();
        if (catalogWebView != null) catalogWebView.destroy();
        if (originalFinderWebView != null) originalFinderWebView.destroy();
        if (roomWebView != null) roomWebView.destroy();
        networkExecutor.shutdownNow();
        super.onDestroy();
    }
}
