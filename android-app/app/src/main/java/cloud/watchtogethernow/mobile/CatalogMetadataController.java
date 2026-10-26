package cloud.watchtogethernow.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.concurrent.Executor;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/** Polls only our catalogue main frame; original sites receive no native bridge. */
final class CatalogMetadataController {
    private final Activity activity;
    private final WebView catalogue;
    private final String adapters,bridge,origin;
    private final BooleanSupplier enabled;
    private final Consumer<WebView> configure;
    private final Executor disk;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final LinkedHashMap<String,Page> pages=new LinkedHashMap<>();
    private final LinkedHashMap<String,Job> jobs=new LinkedHashMap<>();
    private String documentToken="";
    private int generation;
    private boolean closed;
    private final Runnable ticker=this::tick;

    CatalogMetadataController(Activity activity,WebView catalogue,String adapters,String bridge,String origin,
                              BooleanSupplier enabled,Consumer<WebView> configure,Executor disk) {
        this.activity=activity;this.catalogue=catalogue;this.adapters=adapters;this.bridge=bridge;this.origin=origin;
        this.enabled=enabled;this.configure=configure;this.disk=disk;
        handler.post(ticker);
    }
    private boolean trusted() {return !closed && CatalogMetadataPolicy.catalogue(catalogue.getUrl(),origin);}
    private String guard() {return "location.origin==="+JSONObject.quote(origin)+" && ['/', '/discover'].includes(location.pathname)";}
    void navigation() {generation++;documentToken="";cancelAll(false);}
    void flush() {try{disk.execute(()->CookieManager.getInstance().flush());}catch(java.util.concurrent.RejectedExecutionException ignored){}}
    void close() {
        if(closed)return;closed=true;generation++;handler.removeCallbacksAndMessages(null);cancelAll(false);flush();
        for(Page page:pages.values())page.view.destroy();pages.clear();
    }
    private void cancelAll(boolean reply) {for(Job job:new ArrayList<>(jobs.values()))finish(job,status("cancelled"),reply);}
    private static JSONObject status(String value) {JSONObject o=new JSONObject();try{o.put("status",value);}catch(Exception ignored){}return o;}
    private void next() {if(!closed)handler.postDelayed(ticker,250);}
    private void tick() {
        if(closed)return;
        if(!enabled.getAsBoolean() || !trusted()){cancelAll(true);next();return;}
        final int epoch=generation;
        if(documentToken.isEmpty()) {
            // Recheck location inside the evaluated script as navigation can
            // race with getUrl(). Never use addJavascriptInterface on a site.
            catalogue.evaluateJavascript("(()=>{if(!("+guard()+"))return null;"+adapters+";"+bridge+";return window.__twMetadataQueue?.token;})()",raw->{
                if(closed)return;
                if(epoch==generation && trusted())try {
                    Object token=new JSONTokener(raw).nextValue();
                    if(token instanceof String && ((String)token).matches("[a-zA-Z0-9-]{1,80}"))documentToken=(String)token;
                }catch(Exception ignored){}
                next();
            });return;
        }
        final String token=documentToken;
        catalogue.evaluateJavascript("(()=>{if(!("+guard()+"))return null;return window.__twMetadataQueue?.drain();})()",raw->{
            if(closed)return;
            if(epoch==generation && trusted() && enabled.getAsBoolean())try {
                if(raw.length()>16384)throw new IllegalArgumentException();
                JSONObject data=new JSONObject(raw);
                if(!token.equals(data.optString("token")))throw new IllegalArgumentException();
                JSONArray cancelled=data.optJSONArray("cancelled");
                if(cancelled!=null)for(int i=0;i<Math.min(16,cancelled.length());i++) {
                    Job job=jobs.get(cancelled.optString(i));if(job!=null)finish(job,status("cancelled"),false);
                }
                JSONArray requests=data.optJSONArray("requests");
                if(requests!=null)for(int i=0;i<Math.min(2,requests.length());i++)start(requests.optJSONObject(i),token,epoch);
            }catch(Exception ignored){if(epoch==generation && trusted() && ("null".equals(raw) || raw==null))navigation();}
            next();
        });
    }
    private void reply(String token,String id,JSONObject result) {
        if(!trusted())return;
        catalogue.evaluateJavascript("(()=>{if("+guard()+")window.__twMetadataQueue?.complete("
            +JSONObject.quote(token)+","+JSONObject.quote(id)+","+result+");})()",null);
    }
    private final class Page {
        final String source;
        final WebView view;
        String requested="";
        long completedAt;
        String resultStatus="";
        Job job;
        boolean dead;
        int navigation;
        Page(String source) {
            this.source=source;view=new WebView(activity);configure.accept(view);
            view.getSettings().setMediaPlaybackRequiresUserGesture(true);
            // Detached query views still need a viewport for responsive DOM
            // and visibility checks. They share the app's own CookieManager.
            int width=activity.getResources().getDisplayMetrics().widthPixels;
            int height=Math.max(width,activity.getResources().getDisplayMetrics().heightPixels);
            view.measure(android.view.View.MeasureSpec.makeMeasureSpec(width,android.view.View.MeasureSpec.EXACTLY),
                android.view.View.MeasureSpec.makeMeasureSpec(height,android.view.View.MeasureSpec.EXACTLY));
            view.layout(0,0,width,height);
            view.setWebChromeClient(new WebChromeClient(){
                @Override public void onPermissionRequest(PermissionRequest request){request.deny();}
            });
            view.setWebViewClient(new WebViewClient(){
                @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r) {
                    boolean allowed=r.isForMainFrame()?CatalogMetadataPolicy.allowed(source,r.getUrl().toString()):"https".equals(r.getUrl().getScheme());
                    if(!allowed && r.isForMainFrame() && job!=null)finish(job,status("unavailable"),true);
                    return !allowed;
                }
                @Override public void onPageStarted(WebView v,String url,Bitmap icon) {
                    navigation++;
                    if(!CatalogMetadataPolicy.allowed(source,url) && job!=null){v.stopLoading();finish(job,status("unavailable"),true);}
                }
                @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError error) {
                    if(r.isForMainFrame() && job!=null && r.getUrl().toString().equals(job.req.optString("url")))finish(job,status("unavailable"),true);
                }
                @Override public void onReceivedSslError(WebView v,SslErrorHandler h,android.net.http.SslError e) {
                    h.cancel();if(job!=null)finish(job,status("unavailable"),true);
                }
                @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail detail) {
                    dead=true;if(job!=null)finish(job,status("unavailable"),true);
                    pages.remove(source);v.destroy();return true;
                }
            });
        }
    }
    private final class Job {
        final String id,token;
        final int epoch;
        final JSONObject req;
        final Page page;
        final boolean interactive;
        final long deadline;
        final Runnable poll=()->read(this);
        AlertDialog dialog;
        Runnable watchdog;
        boolean done,resumed;
        long emptySince;
        String lastStatus="unavailable";
        Job(String id,String token,int epoch,JSONObject req,Page page,boolean interactive) {
            this.id=id;this.token=token;this.epoch=epoch;this.req=req;this.page=page;this.interactive=interactive;
            deadline=SystemClock.elapsedRealtime()+(interactive?178000:10000);
        }
    }
    private void start(JSONObject data,String token,int epoch) {
        if(data==null)return;
        String id=data.optString("id");if(!id.matches("[a-zA-Z0-9_-]{1,80}"))return;
        JSONObject req=CatalogMetadataPolicy.request(data.optString("kind"),data.optJSONObject("payload"));
        if(req==null || !(data.opt("interactive") instanceof Boolean)){reply(token,id,status("unavailable"));return;}
        String source=req.optString("source");Page page=pages.get(source);
        if(jobs.size()>=2 || jobs.containsKey(id) || page!=null && page.job!=null){reply(token,id,status("busy"));return;}
        if(page==null){page=new Page(source);pages.put(source,page);}
        Job job=new Job(id,token,epoch,req,page,data.optBoolean("interactive"));
        jobs.put(id,job);page.job=job;
        page.view.onResume();
        if(job.interactive) {
            // Only an explicit catalogue button can open this dialog. Search
            // background requests never trigger a verification popup.
            String name=source.equals("pkavi")?"七味网":source.equals("kanju")?"看剧 AI":"233 动漫";
            AlertDialog dialog=new AlertDialog.Builder(activity).setTitle("原站登录 / 验证 · "+name)
                .setView(page.view).setNegativeButton("取消",(d,w)->finish(job,status("cancelled"),true))
                .setPositiveButton("已完成，继续",null).create();job.dialog=dialog;
            dialog.setOnCancelListener(d->finish(job,status("cancelled"),true));
            dialog.show();dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
                if(!job.done)job.page.view.loadUrl(job.req.optString("url"));
            });
        }
        String url=req.optString("url");
        if(!url.equals(page.requested) || !CatalogMetadataPolicy.allowed(source,page.view.getUrl())
            || (page.resultStatus.equals("ok") || page.resultStatus.equals("no_episodes")) && SystemClock.elapsedRealtime()-page.completedAt>60000) {
            page.requested=url;page.view.loadUrl(url);
        }
        handler.postDelayed(job.poll,400);
    }
    private boolean current(Job job) {return !closed && !job.done && job.epoch==generation && documentToken.equals(job.token) && trusted() && enabled.getAsBoolean();}
    private void read(Job job) {
        if(!current(job)){finish(job,status("cancelled"),true);return;}
        if(SystemClock.elapsedRealtime()>job.deadline){finish(job,status(job.lastStatus),true);return;}
        Page page=job.page;String at=page.view.getUrl();final int navigation=page.navigation;
        if(!CatalogMetadataPolicy.allowed(page.source,at)){handler.postDelayed(job.poll,500);return;}
        // Never export page HTML, scripts, cookies or a login form. Only the
        // shared adapter's bounded, public title/episode metadata is returned.
        String code="(()=>{if(location.href!=="+JSONObject.quote(at)+" || document.readyState==='loading')return null;"
            +adapters+";const a=window.TogetherWatchCatalogAdapters,r="+job.req+";return {expected:a.expectedPage(r,location.href),data:a.readDocument(document,r)};})()";
        // WebView callbacks can be lost on renderer failure. Keep a deadline
        // watchdog, independent of the JavaScript callback.
        job.watchdog=()->finish(job,status(job.lastStatus),true);
        handler.postDelayed(job.watchdog,Math.max(1,job.deadline-SystemClock.elapsedRealtime()));
        page.view.evaluateJavascript(code,raw->{
            if(job.watchdog!=null)handler.removeCallbacks(job.watchdog);
            if(!current(job))return;
            if(navigation==page.navigation && at.equals(page.view.getUrl()))try {
                if(raw.length()>1024*1024)throw new IllegalArgumentException();
                JSONObject envelope=new JSONObject(raw),result=envelope.getJSONObject("data");
                String state=result.optString("status");
                job.lastStatus=state.equals("verification_required")?state:"unavailable";
                if(state.equals("access_blocked") || state.equals("verification_required") && !job.interactive){finish(job,result,true);return;}
                if(envelope.optBoolean("expected") && (state.equals("ok") || state.equals("no_episodes"))) {
                    boolean empty=state.equals("no_episodes") || job.req.optString("kind").equals("search") && result.optJSONArray("results")!=null && result.optJSONArray("results").length()==0;
                    if(!empty){finish(job,result,true);return;}
                    if(job.emptySince==0)job.emptySince=SystemClock.elapsedRealtime();
                    if(SystemClock.elapsedRealtime()-job.emptySince>2000){finish(job,result,true);return;}
                } else job.emptySince=0;
                if(job.interactive && !job.resumed && !envelope.optBoolean("expected") && state.equals("ok")) {
                    job.resumed=true;page.view.loadUrl(job.req.optString("url"));
                }
            }catch(Exception ignored){}
            if(current(job))handler.postDelayed(job.poll,500);
        });
    }
    private void finish(Job job,JSONObject result,boolean send) {
        if(job.done)return;job.done=true;handler.removeCallbacks(job.poll);jobs.remove(job.id);job.page.job=null;
        job.page.completedAt=SystemClock.elapsedRealtime();job.page.resultStatus=result.optString("status");
        if(job.watchdog!=null)handler.removeCallbacks(job.watchdog);
        if(job.dialog!=null) {
            job.dialog.setOnCancelListener(null);job.dialog.dismiss();
            if(job.page.view.getParent() instanceof ViewGroup)((ViewGroup)job.page.view.getParent()).removeView(job.page.view);
        }
        // Preserve the tab on cancellation too; never reload a half-completed
        // form unless the user chooses a different request.
        if("unavailable".equals(result.optString("status")))job.page.requested="";
        if(!job.page.dead) {
            job.page.view.evaluateJavascript("document.querySelectorAll('video,audio').forEach(v=>v.pause())",null);
            job.page.view.onPause();
        }
        flush();if(send && job.epoch==generation)reply(job.token,job.id,result);
    }
}
