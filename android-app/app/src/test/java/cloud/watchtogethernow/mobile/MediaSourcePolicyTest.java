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
    @Test public void extensionlessCdnUrlNeedsConfirmedPlayerEvidenceOnBothEntryPaths() {
        String url="https://cdn.example/opaqueVideo?ttl=123&sig=abc";
        assertFalse(MediaSourcePolicy.isMedia(url));
        assertFalse(MediaSourcePolicy.playable(url,false));
        assertTrue(MediaSourcePolicy.playable(url,true));
        assertTrue(MediaSourcePolicy.playable("https://cdn.example/opaque.v1.image",true));
        assertFalse(MediaSourcePolicy.playable("https://cdn.example/opaque.v1.image",false));
        for(String rejected:new String[]{"http://cdn.example/id","https://user@cdn.example/id",
            "https://cdn.example/","https://cdn.example/frame.html","https://cdn.example/part.m4s",
            "https://cdn.example/key%2Ebin","blob:https://cdn.example/id"})
            assertFalse(rejected,MediaSourcePolicy.playable(rejected,true));
    }
    @Test public void omitsCredentialsFromDisplayAndReferer() {
        String url = "https://media.example/watch/a.mp4?token=secret#private";
        assertEquals("https://media.example/", MediaSourcePolicy.origin(url));
        assertFalse(MediaSourcePolicy.displayName(url).contains("secret"));
        assertFalse(MediaSourcePolicy.displayName(url).contains("private"));
    }
    @Test public void manifestMimeFromBoundHlsInstanceAllowsNonstandardFilenameOnlyWhenConfirmed() {
        assertTrue(MediaSourcePolicy.playable("https://cdn.example/playlist.php?id=5",true,true));
        assertFalse(MediaSourcePolicy.playable("https://cdn.example/playlist.php?id=5",false,true));
        assertFalse(MediaSourcePolicy.playable("https://user:pass@cdn.example/playlist.php",true,true));
        assertFalse(MediaSourcePolicy.playable("blob:https://cdn.example/a",true,true));
    }
}
