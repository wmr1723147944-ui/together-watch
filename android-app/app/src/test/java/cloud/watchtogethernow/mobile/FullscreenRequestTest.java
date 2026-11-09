package cloud.watchtogethernow.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class FullscreenRequestTest {
    // Models Media3 1.8: setFullscreenButtonState synchronously calls the listener.
    static final class Player {
        boolean fullscreen, button;
        int enters, exits;
        void callback(boolean desired) { FullscreenRequest.apply(desired,fullscreen,this::enter,this::exit); }
        void buttonState(boolean desired) {
            if(button==desired)return;
            button=desired;callback(desired);
        }
        void enter() { if(fullscreen)return;fullscreen=true;enters++;buttonState(true); }
        void exit() { if(!fullscreen)return;fullscreen=false;exits++;buttonState(false); }
    }
    @Test public void toolbarEnterAndBackExitDoNotReenterOnProgrammaticEcho() {
        Player p=new Player();
        for(int i=0;i<20;i++){p.enter();assertTrue(p.fullscreen);p.exit();assertFalse(p.fullscreen);}
        assertEquals(20,p.enters);assertEquals(20,p.exits);
    }
    @Test public void media3ButtonAndSystemBackCanBeMixed() {
        Player p=new Player();p.buttonState(true);p.exit();p.enter();p.buttonState(false);
        assertFalse(p.fullscreen);assertFalse(p.button);assertEquals(2,p.enters);assertEquals(2,p.exits);
    }
    @Test public void duplicateCallbacksAndBackOnlyDismissOneLayer() {
        Player p=new Player();p.callback(true);p.callback(true);p.exit();p.callback(false);p.exit();
        assertEquals(1,p.enters);assertEquals(1,p.exits);assertFalse(p.fullscreen);
    }
}
