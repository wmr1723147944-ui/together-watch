package cloud.watchtogethernow.mobile;

/** A temporary local fast-forward; the room keeps its ordinary clock until release. */
final class PlaybackHold {
    boolean active;
    double start, speed = 1, boosted = 2;
    boolean begin(double position, double rate) {
        if (active || !Double.isFinite(position) || position < 0 || !Double.isFinite(rate) || rate < .25 || rate > 4) return false;
        active = true; start = position; speed = rate; boosted = Math.max(2, rate);
        return true;
    }
    double roomTime(double actual) { return active ? start + Math.max(0, actual - start) * speed / boosted : actual; }
    void reset() { active = false; }
}
