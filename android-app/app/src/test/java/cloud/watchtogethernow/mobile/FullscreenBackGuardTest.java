package cloud.watchtogethernow.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class FullscreenBackGuardTest {
    private static final class Fake implements FullscreenBackGuard.Registration {
        int added,removed,exits;Runnable callback;
        public void register(Runnable back){added++;callback=back;}
        public void unregister(){removed++;}
        final FullscreenBackGuard guard=new FullscreenBackGuard(this,()->{exits++;guardExit();});
        void guardExit(){guard.update(false,true);}
    }
    @Test public void fullScreenBackOnlyExitsOneLayer() {
        Fake f=new Fake();f.guard.update(true,true);Runnable back=f.callback;
        back.run();assertEquals(1,f.exits);assertEquals(1,f.removed);
        back.run();assertEquals(1,f.exits); // A late callback cannot leave the room or app.
    }
    @Test public void noCaptureOutsideFullscreenOrInBackground() {
        Fake f=new Fake();f.guard.update(false,true);f.guard.update(true,false);
        assertEquals(0,f.added);
        f.guard.update(true,true);Runnable old=f.callback;
        f.guard.update(true,false);old.run();assertEquals(0,f.exits);
        f.guard.update(true,true);assertEquals(2,f.added);
        old.run();assertEquals(0,f.exits);f.callback.run();assertEquals(1,f.exits);
    }
    @Test public void repeatedLayoutAndFocusDoNotDuplicateRegistration() {
        Fake f=new Fake();for(int i=0;i<10;i++)f.guard.update(true,true);
        assertEquals(1,f.added);f.guard.close();f.guard.close();assertEquals(1,f.removed);
        f.callback.run();assertEquals(0,f.exits);
    }
    @Test public void returningToFullscreenStartsAFreshBackTarget() {
        Fake f=new Fake();f.guard.update(true,true);Runnable old=f.callback;
        f.guard.update(false,true);f.guard.update(true,true);
        old.run();assertEquals(0,f.exits);f.callback.run();assertEquals(1,f.exits);
    }
}
