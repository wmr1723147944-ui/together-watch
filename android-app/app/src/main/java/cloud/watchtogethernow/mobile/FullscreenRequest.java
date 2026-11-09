package cloud.watchtogethernow.mobile;

/** Media3 also reports programmatic button-state changes. Never toggle on an echo. */
final class FullscreenRequest {
    private FullscreenRequest() {}
    static void apply(boolean requested, boolean current, Runnable enter, Runnable exit) {
        if (requested == current) return;
        if (requested) enter.run(); else exit.run();
    }
}
