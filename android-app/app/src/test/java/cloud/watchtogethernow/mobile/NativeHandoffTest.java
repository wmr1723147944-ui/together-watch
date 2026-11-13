package cloud.watchtogethernow.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class NativeHandoffTest {
    @Test public void onlyFirstFrameOfCurrentDocumentAndEpisodeCanCommit() {
        NativeHandoff state = new NativeHandoff();
        assertFalse(state.matches(1, 5));
        state.begin(1, 5);
        assertFalse(state.commit(2, 5));
        assertFalse(state.commit(1, 6));
        assertTrue(state.matches(1, 5));
        assertTrue(state.commit(1, 5));
        assertFalse(state.commit(1, 5));
    }
    @Test public void failureRetainsDocumentButNavigationOrLeavingCancelsIt() {
        NativeHandoff state = new NativeHandoff(); state.begin(2, 9);
        assertTrue(state.matches(2, 9)); // failed native player: manual web fallback
        state.clear(); assertFalse(state.matches(2, 9));
        state.begin(3, 10); assertFalse(state.matches(2, 9));
    }
}
