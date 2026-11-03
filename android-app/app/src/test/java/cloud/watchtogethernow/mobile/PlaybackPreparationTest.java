package cloud.watchtogethernow.mobile;

import static org.junit.Assert.*;
import org.junit.Test;

public class PlaybackPreparationTest {
    @Test public void slowPageAndConfirmationStillLeaveRoomForTwoScans() {
        PlaybackPreparation p=new PlaybackPreparation();
        p.start(1000);
        p.advance(PlaybackPreparation.CONFIRM,24000);
        p.advance(PlaybackPreparation.SCAN,43000);
        assertTrue(p.active(47000));
        assertFalse(p.active(61000));
    }
    @Test public void repeatedScansCannotKeepPreparationAlive() {
        PlaybackPreparation p=new PlaybackPreparation();
        p.start(0);p.advance(PlaybackPreparation.SCAN,1000);
        p.advance(PlaybackPreparation.SCAN,24000);
        assertFalse(p.active(25000));
        p.advance(PlaybackPreparation.CONFIRM,26000);
        assertFalse(p.active(26001));
    }
    @Test public void neverReadyAndFailedAttemptsEndUntilExplicitRetry() {
        PlaybackPreparation p=new PlaybackPreparation();
        p.start(0);p.advance(PlaybackPreparation.SCAN,25000);
        assertFalse(p.active(25001));
        p.start(26000);assertTrue(p.active(26001));
        p.stop();assertFalse(p.active(27000));
    }
}
