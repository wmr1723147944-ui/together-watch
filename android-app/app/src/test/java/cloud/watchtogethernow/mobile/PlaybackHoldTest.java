package cloud.watchtogethernow.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackHoldTest {
    @Test public void roomClockKeepsOriginalSpeedWhileVideoFastForwards() {
        PlaybackHold h=new PlaybackHold();assertTrue(h.begin(10,1));
        assertEquals(2,h.boosted,0);assertEquals(16,h.roomTime(22),0);
        assertFalse(h.begin(22,1));h.reset();assertEquals(22,h.roomTime(22),0);
    }
    @Test public void customSpeedIsPreservedAndHighSpeedIsNotSlowedDown() {
        PlaybackHold h=new PlaybackHold();h.begin(10,1.5);assertEquals(19,h.roomTime(22),0);
        h.reset();h.begin(10,3);assertEquals(3,h.boosted,0);assertEquals(22,h.roomTime(22),0);
    }
    @Test public void invalidTimingCannotStartAndBufferingDoesNotAdvanceClock() {
        PlaybackHold h=new PlaybackHold();assertFalse(h.begin(Double.NaN,1));assertFalse(h.begin(-1,1));
        assertFalse(h.begin(5,Double.POSITIVE_INFINITY));assertFalse(h.begin(5,8));
        h.begin(5,1);assertEquals(5,h.roomTime(5),0);assertEquals(5,h.roomTime(3),0);
    }
}
