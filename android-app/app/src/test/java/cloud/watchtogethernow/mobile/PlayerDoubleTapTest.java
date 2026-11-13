package cloud.watchtogethernow.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class PlayerDoubleTapTest {
    @Test public void doubleTapFiresOnceOnSecondRelease(){
        PlayerDoubleTap d=new PlayerDoubleTap();
        assertFalse(d.tap(1,0,60,100,100,300,50));
        assertTrue(d.tap(1,170,230,105,100,300,50));
        assertFalse(d.tap(1,260,290,105,100,300,50));
    }
    @Test public void separatedTapsAndDifferentLocationsDoNotPause(){
        PlayerDoubleTap d=new PlayerDoubleTap();d.tap(1,0,50,100,100,300,50);
        assertFalse(d.tap(1,500,550,100,100,300,50));
        assertFalse(d.tap(1,600,650,300,300,300,50));
    }
    @Test public void episodeChangeCannotCompleteOldTap(){
        PlayerDoubleTap d=new PlayerDoubleTap();d.tap(1,0,50,100,100,300,50);
        assertFalse(d.tap(2,100,150,100,100,300,50));
    }
    @Test public void swipeMultitouchAndControlsCancelPendingPair(){
        PlayerDoubleTap d=new PlayerDoubleTap();d.tap(1,0,50,100,100,300,50);d.reset();
        assertFalse(d.tap(1,100,150,100,100,300,50));
    }
    @Test public void longPressAndInvalidTimingCannotToggle(){
        PlayerDoubleTap d=new PlayerDoubleTap();d.tap(1,0,50,100,100,300,50);
        assertFalse(d.tap(1,100,600,100,100,300,50));
        assertFalse(d.tap(1,700,750,100,100,300,50));
        assertFalse(d.tap(1,800,790,100,100,300,50));
    }
}
