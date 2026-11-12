package cloud.watchtogethernow.mobile;

/** Native clock, independent of WebView callbacks or provider metadata. */
final class PickerLoadState {
    private long started, pendingAt, contentStarted;
    private boolean ready,pending,panelSeen,interactive;
    void start(long now){started=now;contentStarted=-1;ready=false;pending=false;panelSeen=false;interactive=false;}
    void request(long now){if(!pending){pending=true;pendingAt=now;}}
    void reply(String state,long now){
        pending=false;
        boolean resolved=state.equals("ready") || state.equals("notice");
        if(state.equals("loading") || state.equals("verifying")) {
            if(ready || contentStarted<0)contentStarted=now;
            panelSeen=true;interactive=state.equals("verifying");
        } else if(resolved)panelSeen=true;
        else if(state.equals("waiting") && panelSeen && (ready || contentStarted<0)) {
            // Rotation/navigation may temporarily remove a rendered drawer.
            // Allow recovery, but do not leave a permanently blank panel alive.
            contentStarted=now;interactive=false;
        }
        ready=resolved;
    }
    boolean isReady(){return ready;}
    boolean isPending(){return pending;}
    String failure(long now){
        if(pending && now-pendingAt>=8000)return "选集页面没有响应。可点上方「重试」，或关闭面板继续观看。";
        if(!panelSeen && now-started>=20000)return "选集面板加载超时。可重试；关闭面板不会切换当前影片。";
        if(panelSeen && !ready && contentStarted>=0 && now-contentStarted>=(interactive?185000:45000))
            return "集数仍未读到。请重试或关闭面板继续观看，当前影片未切换。";
        return "";
    }
}
