package cloud.watchtogethernow.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class MediaSourcePolicyTest {
    @Test public void recognizesManifestsButNotSegmentsOrQueryOnlyNames() {
        assertTrue(MediaSourcePolicy.isMedia("https://media.example/a.m3u8?key=private"));
        assertTrue(MediaSourcePolicy.isMedia("https://media.example/a.mpd"));
        assertTrue(MediaSourcePolicy.isMedia("https://media.example/a.MP4"));
        assertFalse(MediaSourcePolicy.isMedia("https://media.example/segment.ts"));
        assertFalse(MediaSourcePolicy.isMedia("https://media.example/page?file=a.mp4"));
        assertFalse(MediaSourcePolicy.isMedia("https://user:password@media.example/a.mp4"));
        assertFalse(MediaSourcePolicy.isMedia("file:///a.mp4"));
    }
    @Test public void keepsMembershipPlatformsInWebMode() {
        assertTrue(MediaSourcePolicy.preferWeb("https://v.qq.com/x/cover/123.html"));
        assertTrue(MediaSourcePolicy.preferWeb("https://www.iqiyi.com/video.html"));
        assertFalse(MediaSourcePolicy.preferWeb("https://v.qq.com.example/video.html"));
    }
    @Test public void omitsCredentialsFromDisplayAndReferer() {
        String url = "https://media.example/watch/a.mp4?token=secret#private";
        assertEquals("https://media.example/", MediaSourcePolicy.origin(url));
        assertFalse(MediaSourcePolicy.displayName(url).contains("secret"));
        assertFalse(MediaSourcePolicy.displayName(url).contains("private"));
    }
}
