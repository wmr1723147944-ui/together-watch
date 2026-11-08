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
        for(int i=1;i<60;i++){s.request(i*250);s.reply(false);}
        assertFalse(s.isReady());assertFalse(s.failure(21000).isEmpty());
    }
    @Test public void visiblePanelCanKeepLoadingProviderDataWithoutStartupTimeout() {
        PickerLoadState s=new PickerLoadState();s.start(0);s.request(1000);s.reply(true);
        assertEquals("",s.failure(60000));assertTrue(s.isReady());
        s.request(61000);assertFalse(s.failure(69000).isEmpty());
    }
    @Test public void explicitRetryStartsANewBudget() {
        PickerLoadState s=new PickerLoadState();s.start(0);s.request(1000);
        s.start(30000);assertFalse(s.isPending());assertFalse(s.isReady());
        assertEquals("",s.failure(30001));assertFalse(s.failure(50000).isEmpty());
    }
}
