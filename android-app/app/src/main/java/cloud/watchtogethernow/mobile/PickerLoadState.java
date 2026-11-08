package cloud.watchtogethernow.mobile;

/** Native clock, independent of WebView callbacks or provider metadata. */
final class PickerLoadState {
    private long started, pendingAt;
    private boolean ready,pending;
    void start(long now){started=now;ready=false;pending=false;}
    void request(long now){if(!pending){pending=true;pendingAt=now;}}
    void reply(boolean visible){pending=false;ready=visible;}
    boolean isReady(){return ready;}
    boolean isPending(){return pending;}
    String failure(long now){
        if(pending && now-pendingAt>=8000)return "选集页面没有响应。可点上方「重试」，或关闭面板继续观看。";
        if(!ready && now-started>=20000)return "选集面板加载超时。可重试；关闭面板不会切换当前影片。";
        return "";
    }
}
