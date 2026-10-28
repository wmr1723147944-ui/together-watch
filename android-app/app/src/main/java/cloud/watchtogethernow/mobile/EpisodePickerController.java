package cloud.watchtogethernow.mobile;

import android.app.Activity;
import android.app.Dialog;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.util.concurrent.Executor;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

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

    EpisodePickerController(Activity activity,String origin,String adapters,String bridge,BooleanSupplier foreground,
                            Consumer<WebView> configure,Consumer<ProgramPolicy.Selection> choose,Consumer<String> error,Executor disk) {
        this.activity=activity;this.origin=origin;this.adapters=adapters;this.bridge=bridge;this.foreground=foreground;
        this.configure=configure;this.choose=choose;this.error=error;this.disk=disk;
    }
    boolean isOpen(){return dialog!=null;}
    private boolean live(int epoch){return epoch==generation && dialog!=null && page!=null;}
    void show(ProgramPolicy.Selection program) {
        if(isOpen())return;
        if(program==null || !program.source.matches("cupfox|yhdmoe|huarw|kanju|pkavi|233dm")) {
            error.accept("此链接没有可用剧集目录，可到「更多」换片或使用原网页选集。");return;
        }
        selection=program;final int epoch=++generation;
        dialog=new Dialog(activity);dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        FrameLayout host=new FrameLayout(activity);host.setBackgroundColor(0xff171b25);
        page=new WebView(activity);configure.accept(page);page.setBackgroundColor(0xff171b25);
        page.getSettings().setMediaPlaybackRequiresUserGesture(true);
        page.setWebChromeClient(new WebChromeClient(){@Override public void onPermissionRequest(PermissionRequest request){request.deny();}});
        host.addView(page,new FrameLayout.LayoutParams(-1,-1));
        metadata=new CatalogMetadataController(activity,page,host,adapters,bridge,origin,()->live(epoch) && foreground.getAsBoolean(),configure,disk);
        page.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) {
                if(!request.isForMainFrame())return !"https".equals(request.getUrl().getScheme());
                if(!live(epoch) || !request.hasGesture() || !CatalogMetadataPolicy.catalogue(view.getUrl(),origin))return true;
                ProgramPolicy.Selection next=ProgramPolicy.handoff(request.getUrl().toString(),origin);
                if(next!=null && next.source.equals(program.source) && next.item.equals(program.item) && !next.episode.equals(program.episode))choose.accept(next);
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon) {
                if(!live(epoch))return;
                if(!CatalogMetadataPolicy.catalogue(url,origin)){fail("选集页面跳转异常，已关闭面板。");return;}
                metadata.navigation();
            }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,android.net.http.SslError error){handler.cancel();}
        });
        dialog.setContentView(host);dialog.setCanceledOnTouchOutside(true);dialog.setOnDismissListener(ignored->close());
        dialog.show();resize();page.loadUrl(origin+"/discover?picker=1");
        handler.post(()->open(epoch,0));
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
    private void fail(String message){close();error.accept(message);}
    private void open(int epoch,int attempt) {
        if(!live(epoch))return;
        if(attempt>=60){fail("选集入口尚未加载，请检查网络并确认服务器已更新。");return;}
        if(!CatalogMetadataPolicy.catalogue(page.getUrl(),origin)){handler.postDelayed(()->open(epoch,attempt+1),250);return;}
        String program="{source:"+JSONObject.quote(selection.source)+",item:"+JSONObject.quote(selection.item)+",episode:"+JSONObject.quote(selection.episode)+"}";
        // Wait for the Android metadata bridge too; otherwise dynamic sites
        // accidentally fall back to the server before the local reader is ready.
        page.evaluateJavascript("window.TogetherWatchCatalogNavigation?.pickerClosed?.() ? 'closed' : window.__twMetadataQueue && typeof window.TogetherWatchCatalogNavigation?.episodes==='function'?window.TogetherWatchCatalogNavigation.episodes("+program+"):null",raw->{
            if(!live(epoch))return;
            if("\"closed\"".equals(raw))close();
            else if("null".equals(raw))handler.postDelayed(()->open(epoch,attempt+1),250);
            else if("true".equals(raw))watchClose(epoch);
            else fail("此来源没有可用集数目录，可用原网页选集。");
        });
    }
    private void watchClose(int epoch) {
        if(!live(epoch))return;
        page.evaluateJavascript("window.TogetherWatchCatalogNavigation?.pickerClosed?.() === true",raw->{
            if(!live(epoch))return;
            if("true".equals(raw))close();else handler.postDelayed(()->watchClose(epoch),300);
        });
    }
    void close() {
        ++generation;handler.removeCallbacksAndMessages(null);
        if(metadata!=null){metadata.close();metadata=null;}
        Dialog old=dialog;dialog=null;
        if(old!=null){old.setOnDismissListener(null);old.dismiss();}
        if(page!=null){page.stopLoading();page.destroy();page=null;}
        selection=null;
    }
}
