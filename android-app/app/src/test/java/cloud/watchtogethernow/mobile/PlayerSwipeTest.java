package cloud.watchtogethernow.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class PlayerSwipeTest {
    private PlayerSwipe begin(double x,boolean seekable,double duration) {
        PlayerSwipe p=new PlayerSwipe();
        assertTrue(p.begin(7,x,200,1000,500,20,60,duration,seekable,.4,.5));return p;
    }
    @Test public void rightAndLeftSeekFromTheInitialPositionOnlyOnRelease() {
        PlayerSwipe p=begin(400,true,600);
        assertEquals(PlayerSwipe.SEEK,p.move(650,205));assertEquals(90,p.target,.001);
        assertEquals(PlayerSwipe.SEEK,p.move(150,210));assertEquals(30,p.target,.001);
        assertEquals(30,p.seekOnRelease(7,true),.001);
        assertTrue(Double.isNaN(p.seekOnRelease(7,true))); // one event only
    }
    @Test public void timeClampsAtBothEndsAndShortClipsUseTheirDuration() {
        PlayerSwipe p=begin(500,true,90);
        p.move(5000,200);assertEquals(90,p.target,.001);
        p.move(-5000,200);assertEquals(0,p.target,.001);
        p=begin(500,true,90);p.move(750,200);assertEquals(82.5,p.target,.001);
    }
    @Test public void leftUpAndDownControlVolumeAndNeverChangeToBrightness() {
        PlayerSwipe p=begin(200,true,600);
        assertEquals(PlayerSwipe.VOLUME,p.move(205,130));assertEquals(.6,p.value,.001);
        p.move(900,270);assertEquals(PlayerSwipe.VOLUME,p.mode);assertEquals(.2,p.value,.001);
        p.move(200,2000);assertEquals(0,p.value,.001);
        p.move(200,-2000);assertEquals(1,p.value,.001);
        assertTrue(Double.isNaN(p.seekOnRelease(7,true)));
    }
    @Test public void rightUpAndDownControlBrightnessWithoutBlackout() {
        PlayerSwipe p=begin(800,true,600);
        assertEquals(PlayerSwipe.BRIGHTNESS,p.move(795,130));assertEquals(.7,p.value,.001);
        p.move(100,2000);assertEquals(PlayerSwipe.BRIGHTNESS,p.mode);assertEquals(.05,p.value,.001);
        p.move(800,-2000);assertEquals(1,p.value,.001);
    }
    @Test public void smallMovementsAndAmbiguousDiagonalsStayUnclaimed() {
        PlayerSwipe p=begin(400,true,600);
        assertEquals(PlayerSwipe.NONE,p.move(410,205));
        assertEquals(PlayerSwipe.NONE,p.move(440,240));
        assertEquals(PlayerSwipe.SEEK,p.move(500,240));
        assertEquals(PlayerSwipe.SEEK,p.move(405,400)); // direction remains locked
    }
    @Test public void cancelMultiTouchOrChangedEpisodeCannotCommitASeek() {
        PlayerSwipe p=begin(400,true,600);p.move(700,200);
        assertTrue(Double.isNaN(p.seekOnRelease(7,false)));
        p=begin(400,true,600);p.move(700,200);
        assertTrue(Double.isNaN(p.seekOnRelease(8,true)));
        p=begin(400,true,600);p.move(700,200);p.reset();
        assertTrue(Double.isNaN(p.seekOnRelease(7,true)));
    }
    @Test public void liveAndUnknownDurationCanAdjustVolumeButCannotSeek() {
        PlayerSwipe p=begin(200,false,600);
        assertEquals(PlayerSwipe.NOT_SEEKABLE,p.move(500,200));
        assertTrue(Double.isNaN(p.seekOnRelease(7,true)));
        p=begin(200,true,0);assertEquals(PlayerSwipe.NOT_SEEKABLE,p.move(500,200));
        p=begin(200,false,0);assertEquals(PlayerSwipe.VOLUME,p.move(200,100));
    }
    @Test public void invalidInputAndStaleMovesAreIgnored() {
        PlayerSwipe p=new PlayerSwipe();
        assertFalse(p.begin(1,100,100,0,500,10,0,600,true,.5,.5));
        assertFalse(p.begin(1,100,100,1000,500,10,Double.NaN,600,true,.5,.5));
        assertEquals(PlayerSwipe.NONE,p.move(400,100));
        p=begin(400,true,600);assertEquals(PlayerSwipe.NONE,p.move(Double.NaN,100));
    }
}
