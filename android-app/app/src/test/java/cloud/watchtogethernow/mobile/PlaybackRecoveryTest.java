package cloud.watchtogethernow.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackRecoveryTest {
    @Test public void startupAndLaterBufferingHaveTheSameBoundedDeadline() {
        PlaybackRecovery p=new PlaybackRecovery();
        p.loading(1000);p.loading(29000);
        assertFalse(p.expired(30999));assertTrue(p.expired(31000));
        p.ready();assertFalse(p.expired(40000));
        p.loading(60000);assertTrue(p.expired(90000));
    }
    @Test public void readyFlappingCannotRenewTheRetryBudget() {
        PlaybackRecovery p=new PlaybackRecovery();
        PlaybackRecovery.Failure f=new PlaybackRecovery.Failure(2002,0);
        assertEquals(1000,p.retryDelay(f));
        p.ready();p.loading(1000);
        assertEquals(2500,p.retryDelay(f));
        p.ready();p.loading(3000);
        assertEquals(-1,p.retryDelay(f));
        p.reset();assertEquals(1000,p.retryDelay(f));
    }
    @Test public void retriesTransientFailuresNotAuthRateLimitOrIncompatibleFormats() {
        for(int code:new int[]{2000,2001,2002})
            assertTrue(new PlaybackRecovery.Failure(code,0).transientFailure());
        for(int http:new int[]{408,500,502,503,504})
            assertTrue(new PlaybackRecovery.Failure(2004,http).transientFailure());
        for(int http:new int[]{401,403,404,410,429})
            assertFalse(new PlaybackRecovery.Failure(2001,http).transientFailure());
        for(int code:new int[]{2003,2004,2007,3001,3002,4001,4003,5001,6006,1000})
            assertFalse(new PlaybackRecovery.Failure(code,0).transientFailure());
    }
    @Test public void staleExactKanjuEpisodeCanReloadOnlyOnce() {
        PlaybackRecovery.PageRefresh b=new PlaybackRecovery.PageRefresh();
        PlaybackRecovery.Failure f=new PlaybackRecovery.Failure(2004,403);
        assertFalse(b.claim(f,false,"kanju"));assertFalse(b.claim(f,true,"other"));
        assertTrue(b.claim(f,true,"kanju"));assertFalse(b.claim(f,true,"kanju"));
        b.reset();assertTrue(b.claim(new PlaybackRecovery.Failure(2004,410),true,"kanju"));
    }
    @Test public void loginDrmAndFormatFailuresNeverReloadAutomatically() {
        PlaybackRecovery.PageRefresh b=new PlaybackRecovery.PageRefresh();
        for(PlaybackRecovery.Failure f:new PlaybackRecovery.Failure[]{
            new PlaybackRecovery.Failure(2004,401),new PlaybackRecovery.Failure(2004,429),
            new PlaybackRecovery.Failure(4003,0),new PlaybackRecovery.Failure(6006,0),
            new PlaybackRecovery.Failure(2002,0)})assertFalse(b.claim(f,true,"kanju"));
    }
    @Test public void safeDiagnosticsDistinguishFailuresWithoutIncludingAddresses() {
        assertTrue(new PlaybackRecovery.Failure(2004,403).message().contains("HTTP 403"));
        assertTrue(new PlaybackRecovery.Failure(2002,0).message().contains("超时"));
        assertTrue(new PlaybackRecovery.Failure(4001,0).message().contains("解码"));
        assertTrue(new PlaybackRecovery.Failure(3002,0).message().contains("格式"));
        assertTrue(new PlaybackRecovery.Failure(6006,0).message().contains("授权"));
        assertFalse(new PlaybackRecovery.Failure(2004,403).message().contains("https://"));
    }
}
