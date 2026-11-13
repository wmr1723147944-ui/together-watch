package cloud.watchtogethernow.mobile;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.Map;

public class PlaybackRequestHeadersTest {
    private final String media="https://cdn.example/movie.m3u8";
    @Test public void observedNoReferrerWinsAndCredentialsAreNeverRetained() {
        PlaybackRequestHeaders h=new PlaybackRequestHeaders();
        h.observe(media,Map.of("Cookie","secret","Authorization","secret","Range","bytes=0-"));
        Map<String,String> result=h.snapshot(media,"https://www.kanju.ai/","UA").forUrl(media);
        assertEquals(Map.of("User-Agent","UA"),result);
    }
    @Test public void segmentContextIsScopedAndSensitiveQueryIsRemoved() {
        PlaybackRequestHeaders h=new PlaybackRequestHeaders();
        h.observe(media,Map.of("referer","https://www.kanju.ai/player/show?token=secret#x","origin","https://www.kanju.ai","user-agent","observed"));
        PlaybackRequestHeaders.Snapshot s=h.snapshot(media,"","UA");
        assertEquals("https://www.kanju.ai/player/show",s.forUrl(media).get("Referer"));
        assertEquals(s.forUrl(media),s.forUrl("https://cdn.example/segment.ts"));
        assertEquals(Map.of("User-Agent","UA"),s.forUrl("https://other.example/segment.ts"));
        h.clear(); assertEquals(s.forUrl(media),s.forUrl("https://cdn.example/segment.ts"));
        assertFalse(h.snapshot(media,"","UA").forUrl(media).containsKey("Referer"));
    }
    @Test public void malformedHeadersAndCredentialUrlsAreRejected() {
        PlaybackRequestHeaders h=new PlaybackRequestHeaders();
        h.observe(media,Map.of("Referer","https://user:secret@example.com/","User-Agent","test\r\nCookie:secret"));
        assertEquals(Map.of("User-Agent","UA"),h.snapshot(media,"","UA").forUrl(media));
    }
}
