package cloud.watchtogethernow.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class RoomPageLoadTest {
    private static final String BOOT="https://watchtogethernow.cloud/__tw_room_bootstrap/one";
    private static final String ROOM="https://watchtogethernow.cloud/mobile-room/room-one";
    @Test public void bootstrapNeverRevealsHomeAndRequiresBothAcknowledgements(){
        RoomPageLoad s=new RoomPageLoad();int epoch=s.begin(BOOT,ROOM,0);
        assertFalse(s.expected("https://watchtogethernow.cloud/"));
        assertFalse(s.expected("https://watchtogethernow.cloud/discover"));
        assertFalse(s.ready(epoch,s.document()));
        assertTrue(s.initialized(epoch,s.document(),200));
        assertEquals(RoomPageLoad.Phase.ROOM,s.phase());assertTrue(s.expected(ROOM));assertFalse(s.expected(BOOT));
        assertTrue(s.started(ROOM,300));assertTrue(s.ready(epoch,s.document()));
        assertEquals(RoomPageLoad.Phase.READY,s.phase());
    }
    @Test public void oldRoomAndOldDocumentCallbacksCannotFinishNewRoom(){
        RoomPageLoad s=new RoomPageLoad();int old=s.begin(BOOT,ROOM,0),doc=s.document();
        int next=s.begin(BOOT+"two",ROOM+"two",100);
        assertFalse(s.initialized(old,doc,200));assertFalse(s.ready(old,doc));
        doc=s.document();s.started(BOOT+"two",300);
        assertFalse(s.initialized(next,doc,400));
        assertTrue(s.initialized(next,s.document(),400));
        s.close();assertFalse(s.ready(next,s.document()));assertEquals(RoomPageLoad.Phase.CLOSED,s.phase());
    }
    @Test public void missingJavascriptReplyIsBoundedAndLateReplyCannotClearFailure(){
        RoomPageLoad s=new RoomPageLoad();int epoch=s.begin(BOOT,ROOM,0),doc=s.document();
        assertFalse(s.timedOut(14999));assertTrue(s.timedOut(15000));
        assertFalse(s.initialized(epoch,doc,15001));assertFalse(s.current(epoch));
        int retry=s.begin(BOOT+"new",ROOM,16000);assertTrue(s.initialized(retry,s.document(),16010));
        assertTrue(s.timedOut(36010));assertFalse(s.ready(retry,s.document()));
    }
    @Test public void readyPageReloadIsHiddenUntilNewBridgeAcknowledgement(){
        RoomPageLoad s=new RoomPageLoad();int epoch=s.begin(BOOT,ROOM,0);
        s.initialized(epoch,s.document(),100);s.ready(epoch,s.document());int old=s.document();
        s.started(ROOM,200);assertEquals(RoomPageLoad.Phase.ROOM,s.phase());assertFalse(s.ready(epoch,old));
        assertTrue(s.ready(epoch,s.document()));assertFalse(s.timedOut(999999));
    }
    @Test public void foregroundResumeDoesNotCreateOrChangeRoom(){
        RoomPageLoad s=new RoomPageLoad();int epoch=s.begin(BOOT,ROOM,0);
        s.initialized(epoch,s.document(),100);int old=s.document();s.resume(60000);
        assertFalse(s.ready(epoch,old));
        assertEquals(epoch,s.epoch());assertTrue(s.expected(ROOM));assertFalse(s.timedOut(79999));
        assertTrue(s.timedOut(80000));
    }
    @Test public void failuresAndUnexpectedNavigationFailClosed(){
        RoomPageLoad s=new RoomPageLoad();int epoch=s.begin(BOOT,ROOM,0);
        s.initialized(epoch,s.document(),100);
        assertFalse(s.started("https://watchtogethernow.cloud/",200));
        assertEquals(RoomPageLoad.Phase.FAILED,s.phase());assertFalse(s.ready(epoch,s.document()));
        s.close();s.fail();assertEquals(RoomPageLoad.Phase.CLOSED,s.phase());
    }
}
