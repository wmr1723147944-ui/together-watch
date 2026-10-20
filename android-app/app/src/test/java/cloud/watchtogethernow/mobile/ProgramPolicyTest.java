package cloud.watchtogethernow.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class ProgramPolicyTest {
    private final String server="https://watchtogethernow.cloud";
    @Test public void invitationHandoffCarriesOnlyPublicEpisodeIdentity() {
        ProgramPolicy.Selection s=ProgramPolicy.handoff(server+"/discover/play/kanju/abc/ep-part%3A2",server);
        assertNotNull(s);assertEquals("https://www.kanju.ai/player/abc?episode=part%3A2",s.page);
        assertTrue(s.exact());assertTrue(s.needsConfirmation());
        assertNull(ProgramPolicy.handoff("https://evil.example/discover/play/kanju/abc/ep-2",server));
        assertNull(ProgramPolicy.handoff(server+"/discover/play/kanju/abc/ep-2?token=secret",server));
        assertNull(ProgramPolicy.handoff(server+"/discover/play/kanju/abc/ep-2#secret",server));
        assertNull(ProgramPolicy.handoff(server+"/discover/play/kanju/abc%2Fdef/ep-2",server));
    }
    @Test public void supportedPublicPagesRoundTrip() {
        String[][] fixtures={
            {"sample","sintel","video"},{"sample","bunny","video"},
            {"kanju","abc:123","ep-part:5"},{"kanju","abc","page"},
            {"huarw","39057471","39057471-1"},{"yhdmoe","123","EP5"},
            {"fcma","123-2","4"},{"ddys","test-movie","page"},
            {"blender","12345678-1234-1234-1234-123456789abc","video"},
            {"233dm","123456789012345678901234","1-3"},{"pkavi","23","1-4"}
        };
        for(String[] f:fixtures){
            ProgramPolicy.Selection s=ProgramPolicy.create(f[0],f[1],f[2]);assertNotNull(s);
            ProgramPolicy.Selection actual=ProgramPolicy.fromPage(s.page);assertNotNull(s.page,actual);
            assertEquals(s.source,actual.source);assertEquals(s.item,actual.item);assertEquals(s.episode,actual.episode);
        }
        assertTrue(ProgramPolicy.create("cupfox","123","ep3").needsConfirmation());
        assertFalse(ProgramPolicy.create("ddys","movie","page").exact());
    }
    @Test public void rejectCredentialsUnknownRoutesAndMalformedEpisodeIds() {
        for(String url:new String[]{"http://www.kanju.ai/player/abc","https://user:secret@www.kanju.ai/player/abc",
            "https://www.kanju.ai:8443/player/abc","https://www.kanju.ai.evil.example/player/abc",
            "https://www.kanju.ai/player/abc?token=secret","https://www.kanju.ai/player/abc?episode=1&episode=2",
            "https://www.kanju.ai/player/abc?episode=%2Fprivate","https://www.kanju.ai/player/abc#secret",
            "https://www.pkavi.com/py/1-1-2.html?token=private"})assertNull(url,ProgramPolicy.fromPage(url));
        assertNull(ProgramPolicy.create("kanju","../x","ep-1"));
        assertNull(ProgramPolicy.create("unknown","x","page"));
        assertNull(ProgramPolicy.create("pkavi","123","0-2"));
    }
    @Test public void publicNavigationHintsAreRemovedFromInvitations() {
        ProgramPolicy.Selection s=ProgramPolicy.fromPage("https://kanju.ai/player/abc?episode=3&line=2&from=search&resume=25&adult=false");
        assertNotNull(s);assertEquals("https://www.kanju.ai/player/abc?episode=3",s.page);
    }
}
