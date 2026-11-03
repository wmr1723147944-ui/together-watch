package cloud.watchtogethernow.mobile;

/** Monotonic time budget per film, independent of the room connection.
 * A page gets one load, confirmation and scan window; redirects cannot
 * continually renew them. Only an explicit retry starts another attempt. */
final class PlaybackPreparation {
    static final int LOAD=0, CONFIRM=1, SCAN=2;
    private int phase;
    private long deadline, limit;

    void start(long now) {phase=LOAD;deadline=now+24000;limit=now+60000;}
    boolean active(long now) {return now<deadline;}
    void advance(int next,long now) {
        if(!active(now) || next<=phase)return;
        phase=next;
        deadline=Math.min(limit,now+(next==CONFIRM?20000:24000));
    }
    void stop(){deadline=0;}
}
