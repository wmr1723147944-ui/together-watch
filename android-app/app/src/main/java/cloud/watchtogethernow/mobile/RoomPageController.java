package cloud.watchtogethernow.mobile;

import android.app.Activity;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import java.util.UUID;
import java.util.function.Consumer;

/** Local, resource-free bootstrap. The catalogue is never loaded in the room WebView. */
final class RoomPageController {
    private final WebView web;
    private final View cover;
    private final TextView message;
    private final View retry;
    private final String origin;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final RoomPageLoad state=new RoomPageLoad();
    private final Runnable ready,navigation;
    private final Consumer<String> external;
    private String room="",nickname="",legal="",target="",bootstrap="",token="";
    private boolean pending,paused;
    RoomPageController(Activity activity,WebView web,FrameLayout host,String origin,Runnable ready,Runnable navigation,Consumer<String> external){
        this.web=web;this.origin=origin;this.ready=ready;this.navigation=navigation;this.external=external;
        cover=activity.getLayoutInflater().inflate(R.layout.room_loading,host,false);
        message=cover.findViewById(R.id.roomLoadMessage);retry=cover.findViewById(R.id.roomLoadRetry);
        host.addView(cover,new FrameLayout.LayoutParams(-1,-1));
        retry.setOnClickListener(v->{if(state.phase()!=RoomPageLoad.Phase.CLOSED)open(room,nickname,legal);});
        web.setWebViewClient(new Client());web.setVisibility(View.INVISIBLE);
    }
    void open(String room,String nickname,String legal){
        handler.removeCallbacksAndMessages(null);navigation.run();web.stopLoading();
        this.room=room;this.nickname=nickname;this.legal=legal;
        token=UUID.randomUUID().toString();bootstrap=origin+"/__tw_room_bootstrap/"+token;
        target=origin+"/mobile-room/"+Uri.encode(room);
        int epoch=state.begin(bootstrap,target,SystemClock.elapsedRealtime());pending=false;
        loading();
        // Same HTTPS origin preserves local account/storage. No homepage images,
        // scripts or external content run before entering the requested room.
        web.loadDataWithBaseURL(bootstrap,RoomPageScripts.document(token),"text/html","UTF-8",bootstrap);
        watch(epoch);
    }
    boolean isReady(){return state.phase()==RoomPageLoad.Phase.READY && target.equals(web.getUrl());}
    void close(){state.close();handler.removeCallbacksAndMessages(null);pending=false;navigation.run();web.stopLoading();web.setVisibility(View.INVISIBLE);web.loadUrl("about:blank");}
    void pause(){paused=true;handler.removeCallbacksAndMessages(null);}
    void resume(){paused=false;pending=false;state.resume(SystemClock.elapsedRealtime());handler.removeCallbacksAndMessages(null);watch(state.epoch());}
    private void loading(){web.setVisibility(View.INVISIBLE);cover.setVisibility(View.VISIBLE);retry.setVisibility(View.GONE);message.setText("正在连接房间，聊天与同步准备好后自动显示…");}
    private void fail(String text){
        if(state.phase()==RoomPageLoad.Phase.CLOSED || state.phase()==RoomPageLoad.Phase.FAILED)return;
        state.fail();showFailure(text);
    }
    private void showFailure(String text){
        handler.removeCallbacksAndMessages(null);pending=false;navigation.run();web.stopLoading();web.setVisibility(View.INVISIBLE);
        cover.setVisibility(View.VISIBLE);retry.setVisibility(View.VISIBLE);message.setText(text+"\n当前影片不会切换，无需重新建房。");
    }
    private void watch(int epoch){
        if(paused || !state.current(epoch) || state.phase()==RoomPageLoad.Phase.READY)return;
        if(state.timedOut(SystemClock.elapsedRealtime())){showFailure("房间页面连接超时（R01），请重试。");return;}
        // Watchdog is independent of JS replies: a stuck renderer cannot leave
        // this cover waiting forever. Do not queue unbounded evaluations.
        handler.postDelayed(()->watch(epoch),500);
        if(pending)return;
        pending=true;int document=state.document();
        boolean boot=state.phase()==RoomPageLoad.Phase.BOOTSTRAP;
        String script=boot?RoomPageScripts.initialize(bootstrap,token,room,nickname,legal):RoomPageScripts.probe(target,room);
        web.evaluateJavascript(script,raw->{
            if(!state.accepts(epoch,document))return;
            pending=false;
            if("\"storage-error\"".equals(raw)){fail("房间初始化失败（R02），本机存储暂不可用。");return;}
            if("\"legal\"".equals(raw)){fail("网站使用说明已变化（R03），请返回首页确认新版说明或更新 APP。");return;}
            if(boot && "\"initialized\"".equals(raw) && state.initialized(epoch,document,SystemClock.elapsedRealtime()))web.loadUrl(target);
            else if(!boot && "\"ready\"".equals(raw) && target.equals(web.getUrl()) && state.ready(epoch,document)){
                handler.removeCallbacksAndMessages(null);cover.setVisibility(View.GONE);web.setVisibility(View.VISIBLE);ready.run();
            }
        });
    }
    private final class Client extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
            if(!request.isForMainFrame())return true;
            String url=request.getUrl().toString();
            if(state.current(state.epoch()) && state.expected(url))return false;
            if(request.hasGesture()){
                if(!UrlPolicy.normalizeHttpsUrl(url).isEmpty())external.accept(url);
            }else if(state.phase()!=RoomPageLoad.Phase.CLOSED){
                fail(request.getUrl().getQueryParameter("notice")!=null?"网站使用说明需要重新确认（R03）。":"房间页面发生异常跳转（R04），已阻止显示其他页面。");
            }
            return true;
        }
        @Override public void onPageStarted(WebView view,String url,Bitmap icon){
            if(state.phase()==RoomPageLoad.Phase.CLOSED || state.phase()==RoomPageLoad.Phase.FAILED)return;
            // An abandoned about:blank/old bootstrap callback may arrive after
            // open(). It must not advance or invalidate the new initialization.
            if(!state.expected(url)){
                if(state.phase()==RoomPageLoad.Phase.READY)fail("房间页面地址不匹配（R04），请重试。");
                return;
            }
            navigation.run();pending=false;
            if(!state.started(url,SystemClock.elapsedRealtime())){
                if(state.phase()==RoomPageLoad.Phase.FAILED)showFailure("房间页面地址不匹配（R04），请重试。");
                return;
            }
            loading();handler.removeCallbacksAndMessages(null);watch(state.epoch());
        }
        @Override public void onReceivedError(WebView view,WebResourceRequest req,WebResourceError error){
            if(req.isForMainFrame() && state.expected(req.getUrl().toString()))fail("房间页面无法连接（R05 / "+error.getErrorCode()+"），请检查网络后重试。");
        }
        @Override public void onReceivedHttpError(WebView view,WebResourceRequest req,WebResourceResponse response){
            if(req.isForMainFrame() && state.expected(req.getUrl().toString()))fail("房间服务器返回错误（R06 / "+response.getStatusCode()+"），请重试或检查服务器。");
        }
        @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,android.net.http.SslError error){
            handler.cancel();if(state.expected(error.getUrl()))fail("房间网站证书异常（R07），已停止连接。");
        }
    }
}
