package cloud.watchtogethernow.mobile;

import android.app.Activity;
import android.app.Dialog;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.RenderProcessGoneDetail;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Button;
import org.json.JSONObject;
import java.util.concurrent.Executor;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.Supplier;

/** A first-party episode drawer above the existing player, not a finder tab.
 * Opening/closing does not pause, release, reparent or navigate the player. */
final class EpisodePickerController {
    private final Activity activity;
    private final String origin,adapters,bridge;
    private final BooleanSupplier foreground;
    private final Consumer<WebView> configure;
    private final Consumer<ProgramPolicy.Selection> choose;
    private final Consumer<String> error;
    private final Executor disk;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private Dialog dialog;
    private WebView page;
    private CatalogMetadataController metadata;
    private ProgramPolicy.Selection selection;
    private int generation;
    private final String nextScript;
    private boolean quick,checking;
    private boolean failed;
    private TextView loading;
    private final PickerLoadState loadState=new PickerLoadState();
    private final PickerDocumentState documentState=new PickerDocumentState();
    private String probe="";
    private String playingDirectory="";
    private final Supplier<WebView> playingPage;
    private final EpisodeDirectoryCache directoryCache;
    private boolean freshDirectory;

    EpisodePickerController(Activity activity,String origin,String adapters,String bridge,String nextScript,BooleanSupplier foreground,
                            Consumer<WebView> configure,Consumer<ProgramPolicy.Selection> choose,Consumer<String> error,Executor disk,Supplier<WebView> playingPage,EpisodeDirectoryCache directoryCache) {
        this.activity=activity;this.origin=origin;this.adapters=adapters;this.bridge=bridge;this.foreground=foreground;
        this.configure=configure;this.choose=choose;this.error=error;this.disk=disk;this.nextScript=nextScript;
        this.playingPage=playingPage;
        this.directoryCache=directoryCache;
        try(java.io.InputStream input=activity.getAssets().open("episode-picker-probe.js")) {
            java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();
            byte[] buffer=new byte[4096];int count;
            while((count=input.read(buffer))!=-1)bytes.write(buffer,0,count);
            probe=bytes.toString("UTF-8");
        }catch(java.io.IOException ignored){}
        try(java.io.InputStream input=activity.getAssets().open("playing-directory.js")) {
            java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();
            byte[] buffer=new byte[4096];int count;
            while((count=input.read(buffer))!=-1)bytes.write(buffer,0,count);
            playingDirectory=bytes.toString("UTF-8");
        }catch(java.io.IOException ignored){}
    }
    boolean isOpen(){return dialog!=null;}
    private boolean live(int epoch){return epoch==generation && dialog!=null && page!=null && !failed;}
    static boolean supported(ProgramPolicy.Selection p){return p!=null && p.exact() && p.source.matches("cupfox|yhdmoe|huarw|kanju|pkavi|233dm");}
    void show(ProgramPolicy.Selection program) {show(program,false);}
    private void show(ProgramPolicy.Selection program,boolean advance) {
        if(isOpen())return;
        if(program==null || !program.source.matches("cupfox|yhdmoe|huarw|kanju|pkavi|233dm")) {
            error.accept("此链接没有可用剧集目录，可到「更多」换片或使用原网页选集。");return;
        }
        quick=advance;checking=false;failed=false;selection=program;final int epoch=++generation;
        loadState.start(SystemClock.elapsedRealtime());
        documentState.start();
        dialog=new Dialog(activity);dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout shell=new LinearLayout(activity);shell.setOrientation(LinearLayout.VERTICAL);shell.setBackgroundColor(0xff171b25);
        LinearLayout toolbar=new LinearLayout(activity);toolbar.setGravity(Gravity.CENTER_VERTICAL);
        TextView heading=new TextView(activity);heading.setText("选集 / 换源");heading.setTextColor(0xffedf3ff);heading.setTextSize(16);
        heading.setPadding(dp(16),0,0,0);toolbar.addView(heading,new LinearLayout.LayoutParams(0,dp(52),1));heading.setGravity(Gravity.CENTER_VERTICAL);
        Button retry=toolbarButton("重试");retry.setContentDescription("重新从原站读取最新集数");
        retry.setOnClickListener(v->{close();freshDirectory=true;show(program,false);});toolbar.addView(retry);
        Button dismiss=toolbarButton("关闭");dismiss.setOnClickListener(v->close());toolbar.addView(dismiss);
        shell.addView(toolbar,new LinearLayout.LayoutParams(-1,dp(52)));
        FrameLayout host=new FrameLayout(activity);host.setBackgroundColor(0xff171b25);
        shell.addView(host,new LinearLayout.LayoutParams(-1,0,1));
        page=new WebView(activity);configure.accept(page);page.setBackgroundColor(0xff171b25);
        page.getSettings().setMediaPlaybackRequiresUserGesture(true);
        page.setWebChromeClient(new WebChromeClient(){@Override public void onPermissionRequest(PermissionRequest request){request.deny();}});
        host.addView(page,new FrameLayout.LayoutParams(-1,-1));
        loading=new TextView(activity);loading.setText("正在打开选集面板…\n当前影片不会切换");
        loading.setTextColor(0xffdce2ed);loading.setTextSize(13);loading.setGravity(Gravity.CENTER);
        loading.setPadding(dp(16),dp(10),dp(16),dp(10));loading.setBackgroundColor(0xff171b25);
        loading.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        // Keep the WebView drawable/touchable. A full opaque loading sibling
        // can occlude the very content/compositor we are waiting to observe.
        shell.addView(loading,1,new LinearLayout.LayoutParams(-1,-2));
        metadata=new CatalogMetadataController(activity,page,host,adapters,bridge,origin,()->live(epoch) && foreground.getAsBoolean(),configure,disk);
        if(!freshDirectory && !advance)metadata.preferPlayingPage(playingPage,playingDirectory);
        metadata.useDirectories(directoryCache,!freshDirectory && !advance);
        freshDirectory=false;
        page.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request) {
                String asset=PickerAssets.asset(request.getUrl().toString(),origin);
                if(asset==null || !"GET".equals(request.getMethod()))return null;
                try {
                    return new WebResourceResponse(PickerAssets.mime(asset),"UTF-8",200,"OK",
                        java.util.Collections.singletonMap("Cache-Control","no-store"),activity.getAssets().open(asset));
                }catch(java.io.IOException missing) {
                    // Missing packaged UI must not silently fall back to an
                    // incompatible server homepage or stale HTTP cache.
                    return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",java.util.Collections.emptyMap(),
                        new java.io.ByteArrayInputStream(new byte[0]));
                }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) {
                if(!request.isForMainFrame())return !"https".equals(request.getUrl().getScheme());
                if(!live(epoch) || !request.hasGesture() || !CatalogMetadataPolicy.catalogue(view.getUrl(),origin))return true;
                ProgramPolicy.Selection next=ProgramPolicy.pickerSelection(request.getUrl().toString(),origin,program);
                if(next!=null){quick=false;choose.accept(next);}
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon) {
                if(!live(epoch))return;
                if(!CatalogMetadataPolicy.catalogue(url,origin)){fail("选集页面跳转异常，已停止加载。可重试或关闭面板。");return;}
                documentState.start();
                metadata.navigation();
            }
            @Override public void onPageCommitVisible(WebView view,String url) {
                if(live(epoch) && CatalogMetadataPolicy.catalogue(url,origin))documentState.commit();
            }
            @Override public void onPageFinished(WebView view,String url) {
                // Some WebView builds defer visual callbacks until drawing.
                // The JS probe still validates origin, readiness and geometry.
                if(live(epoch) && CatalogMetadataPolicy.catalogue(url,origin))documentState.commit();
            }
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError e) {
                if(live(epoch) && request.isForMainFrame())fail("选集页面网络连接失败。请重试；当前影片未切换。");
            }
            @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response) {
                if(live(epoch) && request.isForMainFrame())fail("选集服务返回 HTTP "+response.getStatusCode()+"。请稍后重试。");
            }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler h,android.net.http.SslError e){
                h.cancel();if(live(epoch))fail("选集页面的安全连接失败。请检查网络或稍后重试。");
            }
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail) {
                if(live(epoch)){page=null;fail("选集网页组件已中断，请点「重试」重新打开。");}
                if(view.getParent() instanceof android.view.ViewGroup)((android.view.ViewGroup)view.getParent()).removeView(view);
                if(page==view)page=null;view.destroy();return true;
            }
        });
        dialog.setContentView(shell);dialog.setCanceledOnTouchOutside(true);dialog.setOnDismissListener(ignored->close());
        dialog.show();resize();page.loadUrl(origin+PickerAssets.ENTRY);
        handler.post(()->watchLoad(epoch));
        handler.post(()->open(epoch,0));
    }
    private int dp(int value){return Math.round(value*activity.getResources().getDisplayMetrics().density);}
    private Button toolbarButton(String title) {
        Button b=new Button(activity);b.setText(title);b.setTextColor(0xffedf3ff);b.setTextSize(14);b.setAllCaps(false);
        b.setMinWidth(0);b.setMinimumWidth(0);b.setBackgroundColor(Color.TRANSPARENT);b.setPadding(dp(14),0,dp(14),0);
        b.setLayoutParams(new LinearLayout.LayoutParams(-2,dp(48)));return b;
    }
    void resize() {
        if(dialog==null || dialog.getWindow()==null)return;
        Window window=dialog.getWindow();window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);window.setDimAmount(.25f);
        android.util.DisplayMetrics metrics=activity.getResources().getDisplayMetrics();
        boolean landscape=activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE;
        window.setLayout(landscape?Math.min(metrics.widthPixels,(int)(380*metrics.density)):-1,
            landscape?-1:(int)(metrics.heightPixels*.78));
        window.setGravity(landscape?Gravity.END:Gravity.BOTTOM);
    }
    private void fail(String message){
        if(failed || dialog==null)return;
        failed=true;quick=false;checking=false;handler.removeCallbacksAndMessages(null);
        if(metadata!=null){metadata.close();metadata=null;}
        if(page!=null)page.stopLoading();
        if(loading!=null){loading.setText(message);loading.setVisibility(View.VISIBLE);loading.bringToFront();}
    }
    private void watchLoad(int epoch) {
        if(!live(epoch))return;
        String problem=loadState.failure(SystemClock.elapsedRealtime());
        if(!problem.isEmpty()){fail(problem);return;}
        handler.postDelayed(()->watchLoad(epoch),250);
    }
    private void open(int epoch,int attempt) {
        if(!live(epoch))return;
        if(attempt>=60){fail("本机选集组件未能就绪（P04）。可重试；不需要更新服务器。\n安卓 "+BuildConfig.VERSION_NAME);return;}
        if(!documentState.canProbe() || !CatalogMetadataPolicy.catalogue(page.getUrl(),origin)){handler.postDelayed(()->open(epoch,attempt+1),250);return;}
        if(probe.isEmpty()){fail("选集组件缺失，请重新安装完整 APK。");return;}
        String program="{source:"+JSONObject.quote(selection.source)+",item:"+JSONObject.quote(selection.item)+",episode:"+JSONObject.quote(selection.episode)+"}";
        // Wait for the Android metadata bridge too; otherwise dynamic sites
        // accidentally fall back to the server before the local reader is ready.
        loadState.request(SystemClock.elapsedRealtime());
        final int document=documentState.token();
        page.evaluateJavascript(probe.trim()+"("+program+","+JSONObject.quote(origin)+")",raw->{
            if(!live(epoch))return;
            if(!documentState.accepts(document)){
                loadState.reply("waiting",SystemClock.elapsedRealtime());
                handler.postDelayed(()->open(epoch,attempt+1),250);return;
            }
            String state=PickerDocumentState.state(raw);loadState.reply(state,SystemClock.elapsedRealtime());
            if("closed".equals(state))close();
            else if("waiting".equals(state))handler.postDelayed(()->open(epoch,attempt+1),250);
            else if(showProbe(state)){watchClose(epoch);}
            else fail(PickerDocumentState.failure(state)+"\n安卓 "+BuildConfig.VERSION_NAME+" · "+selection.source);
        });
    }
    private boolean showProbe(String state) {
        if(!state.matches("ready|notice|loading|verifying"))return false;
        boolean waiting=state.equals("loading");
        loading.setText("正在读取集数…\n当前影片不会切换；上方可重试或关闭");
        loading.setVisibility(waiting?View.VISIBLE:View.GONE);
        if(state.equals("ready") && quick && !checking){checking=true;advanceDrawer(generation,0);}
        return true;
    }
    private void readNext(WebView web,ProgramPolicy.Selection p,boolean expand,Consumer<String> result) {
        if(!CatalogMetadataPolicy.catalogue(web.getUrl(),origin) || nextScript.isEmpty()){result.accept("missing");return;}
        String args=JSONObject.quote(origin)+",{source:"+JSONObject.quote(p.source)+",item:"+JSONObject.quote(p.item)+",episode:"+JSONObject.quote(p.episode)+"}";
        web.evaluateJavascript(nextScript.trim()+"(document,"+args+","+expand+")",raw->{
            String value="missing";
            try {Object parsed=new org.json.JSONTokener(raw).nextValue();if(parsed instanceof String)value=(String)parsed;}catch(Exception ignored){}
            result.accept(value);
        });
    }
    private ProgramPolicy.Selection validatedNext(String value,ProgramPolicy.Selection p) {
        ProgramPolicy.Selection n=ProgramPolicy.handoff(value,origin);
        return n!=null && n.source.equals(p.source) && n.item.equals(p.item) && !n.episode.equals(p.episode)?n:null;
    }
    void next(ProgramPolicy.Selection program,WebView catalogue) {
        if(!supported(program) || checking || isOpen())return;
        checking=true;final int epoch=++generation;
        readNext(catalogue,program,false,value->{
            if(epoch!=generation)return;
            checking=false;if(!foreground.getAsBoolean())return;
            ProgramPolicy.Selection n=validatedNext(value,program);
            if(n!=null)choose.accept(n);
            else show(program,true); // Re-read even a cached last episode: a new one may be available.
        });
    }
    private void advanceDrawer(int epoch,int attempt) {
        if(!live(epoch) || !quick)return;
        readNext(page,selection,true,value->{
            if(!live(epoch) || !quick || !foreground.getAsBoolean())return;
            ProgramPolicy.Selection n=validatedNext(value,selection);
            if(n!=null){close();choose.accept(n);return;}
            if(("waiting".equals(value) || "more".equals(value)) && attempt<180){
                handler.postDelayed(()->advanceDrawer(epoch,attempt+1),250);return;
            }
            quick=false;
            if("end".equals(value)){close();error.accept("当前线路的目录里没有下一集，继续播放本集。");return;}
            error.accept("未能确认下一集，当前影片没有切换。可以在目录里手动选择。");
        });
    }
    private void watchClose(int epoch) {
        if(!live(epoch))return;
        if(!documentState.canProbe()){handler.postDelayed(()->open(epoch,0),250);return;}
        loadState.request(SystemClock.elapsedRealtime());
        final int document=documentState.token();
        String program="{source:"+JSONObject.quote(selection.source)+",item:"+JSONObject.quote(selection.item)+",episode:"+JSONObject.quote(selection.episode)+"}";
        page.evaluateJavascript(probe.trim()+"("+program+","+JSONObject.quote(origin)+")",raw->{
            if(!live(epoch))return;
            if(!documentState.accepts(document)){
                loadState.reply("waiting",SystemClock.elapsedRealtime());
                handler.postDelayed(()->open(epoch,0),250);return;
            }
            String state=PickerDocumentState.state(raw);loadState.reply(state,SystemClock.elapsedRealtime());
            if("closed".equals(state))close();
            else if(showProbe(state))handler.postDelayed(()->watchClose(epoch),300);
            else if("waiting".equals(state))handler.postDelayed(()->watchClose(epoch),300);
            else fail(PickerDocumentState.failure(state)+"\n安卓 "+BuildConfig.VERSION_NAME+" · "+selection.source);
        });
    }
    void close() {
        quick=false;checking=false;
        ++generation;handler.removeCallbacksAndMessages(null);
        if(metadata!=null){metadata.close();metadata=null;}
        Dialog old=dialog;dialog=null;
        if(old!=null){old.setOnDismissListener(null);old.dismiss();}
        if(page!=null){page.stopLoading();page.destroy();page=null;}
        selection=null;loading=null;
    }
}
