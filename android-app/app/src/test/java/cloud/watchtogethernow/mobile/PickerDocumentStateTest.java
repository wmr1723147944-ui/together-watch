package cloud.watchtogethernow.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class PickerDocumentStateTest {
    @Test public void requestedUrlMustNotStartProbeBeforeDocumentCommit() {
        PickerDocumentState s=new PickerDocumentState();s.start();
        assertFalse(s.canProbe());assertFalse(s.accepts(s.token()));
        s.commit();assertTrue(s.canProbe());assertTrue(s.accepts(s.token()));
    }
    @Test public void navigationRejectsLateCallbacksEvenAfterNewCommit() {
        PickerDocumentState s=new PickerDocumentState();s.start();s.commit();int old=s.token();
        s.start();assertFalse(s.canProbe());assertFalse(s.accepts(old));
        s.commit();assertFalse(s.accepts(old));assertTrue(s.accepts(s.token()));
    }
    @Test public void nullAndMalformedResultsWaitRatherThanFailingToOpen() {
        for(String raw:new String[]{null,"null","","{}","[]","12"})assertEquals("waiting",PickerDocumentState.state(raw));
        assertEquals("waiting",PickerDocumentState.state("\"waiting\""));
        assertEquals("ready",PickerDocumentState.state("\"ready\""));
        assertEquals("untrusted",PickerDocumentState.state("\"untrusted\""));
    }
    @Test public void diagnosticsSeparateAddressProgramAndScriptWithoutPageData() {
        assertTrue(PickerDocumentState.failure("untrusted").contains("P01"));
        assertTrue(PickerDocumentState.failure("unsupported").contains("P02"));
        assertTrue(PickerDocumentState.failure("error-TypeError").contains("P03-TypeError"));
        assertFalse(PickerDocumentState.failure("error-secret-url").contains("secret-url"));
    }
}
