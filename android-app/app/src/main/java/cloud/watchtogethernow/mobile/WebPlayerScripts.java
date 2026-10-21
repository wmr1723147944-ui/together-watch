package cloud.watchtogethernow.mobile;

/** APP-owned source compiled by WebView, not by a source page's eval(). */
final class WebPlayerScripts {
    private WebPlayerScripts() { }

    static String sample(String wrapper, String agent) {
        // Bind the shared agent's globals to each accessible frame. Calling this
        // function does not require unsafe-eval and does not relax same-origin.
        return wrapper + ";window.__twAndroidPage.sample(function(target){"
            + "const window=target,document=target.document;\n"
            + agent + "\n})";
    }

    static String diagnostic(String reason) {
        switch (reason) {
            case "cross_origin_frame":
                return "尚未接入同步：存在无法访问的跨域子页面。可试「播放方式」；当前不保证该播放器兼容。";
            case "adapter_error":
                return "播放器适配未成功，尚未接入同步。请刷新重试；若仍失败，请反馈此页面。";
            case "no_video":
                return "尚未找到视频播放器，未接入同步。请在原站点播放并等待视频出现。";
            default:
                return "播放器尚未就绪，未接入同步。";
        }
    }
}
