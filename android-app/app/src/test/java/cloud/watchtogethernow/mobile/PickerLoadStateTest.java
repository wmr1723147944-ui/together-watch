package cloud.watchtogethernow.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class PickerLoadStateTest {
    @Test public void missingJavascriptCallbackStillTimesOut() {
        PickerLoadState s=new PickerLoadState();s.start(0);s.request(1000);
        assertEquals("",s.failure(8999));assertFalse(s.failure(9000).isEmpty());
    }
    @Test public void repeatedRequestsCannotExtendAHungCallback() {
        PickerLoadState s=new PickerLoadState();s.start(0);s.request(1000);s.request(7000);
        assertFalse(s.failure(9000).isEmpty());
    }
    @Test public void repliesWithoutVisibleContentDoNotDeclareSuccess() {
        PickerLoadState s=new PickerLoadState();s.start(1000);
        for(int i=1;i<60;i++){s.request(i*250);s.reply("waiting",i*250);}
        assertFalse(s.isReady());assertFalse(s.failure(21000).isEmpty());
    }
    @Test public void populatedPanelRemainsOpenButHungRendererStillTimesOut() {
        PickerLoadState s=new PickerLoadState();s.start(0);s.request(1000);s.reply("ready",1000);
        assertEquals("",s.failure(60000));assertTrue(s.isReady());
        s.request(61000);assertFalse(s.failure(69000).isEmpty());
    }
    @Test public void emptyVisiblePanelHasABoundedContentDeadline() {
        PickerLoadState s=new PickerLoadState();s.start(0);s.reply("loading",1000);
        for(int i=2;i<46;i++)s.reply("loading",i*1000);
        assertFalse(s.isReady());assertEquals("",s.failure(45999));assertFalse(s.failure(46000).isEmpty());
    }
    @Test public void sourceChangeGetsANewContentBudgetAndErrorsAreVisible() {
        PickerLoadState s=new PickerLoadState();s.start(0);s.reply("ready",1000);s.reply("loading",90000);
        assertEquals("",s.failure(90001));assertFalse(s.failure(135000).isEmpty());
        s.reply("notice",135001);assertTrue(s.isReady());assertEquals("",s.failure(200000));
    }
    @Test public void explicitVerificationHasTimeToFinishAndRemainsBounded() {
        PickerLoadState s=new PickerLoadState();s.start(0);s.reply("verifying",1000);
        assertEquals("",s.failure(60000));s.reply("verifying",180000);
        assertFalse(s.failure(186000).isEmpty());
    }
    @Test public void explicitRetryStartsANewBudget() {
        PickerLoadState s=new PickerLoadState();s.start(0);s.request(1000);
        s.start(30000);assertFalse(s.isPending());assertFalse(s.isReady());
        assertEquals("",s.failure(30001));assertFalse(s.failure(50000).isEmpty());
    }
    @Test public void vanishedPanelCanRecoverButCannotWaitForever() {
        PickerLoadState s=new PickerLoadState();s.start(0);s.reply("ready",1000);
        s.reply("waiting",2000);s.reply("waiting",3000);
        assertEquals("",s.failure(46999));assertFalse(s.failure(47000).isEmpty());
        s.reply("ready",47001);assertEquals("",s.failure(90000));
    }
}
