package cloud.watchtogethernow.mobile;

/** Bounded recovery, shared by initial loading and rebuffering. No URLs or credentials. */
final class PlaybackRecovery {
    static final long LOAD_TIMEOUT_MS = 30000;
    private int retries;
    private long deadline;

    void loading(long now) { if (deadline == 0) deadline = now + LOAD_TIMEOUT_MS; }
    void ready() { deadline = 0; } // READY is not evidence that a whole stream is healthy.
    boolean expired(long now) { return deadline > 0 && now >= deadline; }
    long remaining(long now) { return Math.max(0, deadline - now); }
    long retryDelay(Failure failure) {
        deadline = 0;
        if (!failure.transientFailure() || retries >= 2) return -1;
        return ++retries == 1 ? 1000 : 2500;
    }
    void reset() { retries = 0; deadline = 0; }

    static final class Failure {
        // Media3 PlaybackException codes; the policy itself is JVM-testable.
        final int code, http;
        Failure(int code, int http) { this.code = code; this.http = http; }
        boolean transientFailure() {
            if (http > 0) return http == 408 || http >= 500 && http <= 599;
            return code == 2000 || code == 2001 || code == 2002;
        }
        boolean staleAddress() { return http == 403 || http == 404 || http == 410; }
        String message() {
            String reason;
            if (http == 401) reason = "线路要求登录，请手动打开原网页检查";
            else if (http == 403) reason = "线路拒绝访问，可能已过期或需要原站验证";
            else if (http == 404 || http == 410) reason = "这条视频地址已失效或不存在";
            else if (http == 429) reason = "原站请求过于频繁，请稍后再试";
            else if (http >= 500) reason = "视频线路服务器暂时不可用";
            else if (code >= 4000 && code < 6000) reason = "手机无法解码这条线路的音视频格式，请换源";
            else if (code >= 6000 && code < 7000) reason = "这条视频需要原站授权播放";
            else if (code == 2007) reason = "线路使用了不安全的 HTTP 地址，未放行";
            else if (code == 2003 || code >= 3000 && code < 4000) reason = "线路返回的内容不是可读取的视频，或格式不兼容";
            else if (code == 2002) reason = "视频加载超时，请检查网络或换源";
            else reason = "视频线路加载失败，请重新识别或换源";
            return reason + "（" + (http > 0 ? "HTTP " + http + " · " : "") + "错误码 " + code + "）";
        }
    }

    /** Only one normal page reload for an exact Kanju episode, never a login/DRM bypass. */
    static final class PageRefresh {
        private boolean used;
        void reset() { used = false; }
        boolean claim(Failure failure, boolean exact, String source) {
            if (used || !exact || !"kanju".equals(source) || !failure.staleAddress()) return false;
            used = true;
            return true;
        }
    }
}
