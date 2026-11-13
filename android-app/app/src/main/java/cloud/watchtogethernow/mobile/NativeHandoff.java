package cloud.watchtogethernow.mobile;

/** Keep the source document until this exact room revision renders a native frame. */
final class NativeHandoff {
    private int page = -1;
    private long revision = -1;
    void begin(int page, long revision) { this.page = page; this.revision = revision; }
    boolean matches(int page, long revision) { return this.page >= 0 && this.page == page && this.revision == revision; }
    boolean commit(int page, long revision) {
        if (!matches(page, revision)) return false;
        clear(); return true;
    }
    void clear() { page = -1; revision = -1; }
}
