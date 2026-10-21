package cloud.watchtogethernow.mobile;
import org.junit.Test;
import static org.junit.Assert.*;

public class RoomInviteTest {
    private final String host="watchtogethernow.cloud", id="0123456789abcdef01234567";
    @Test public void allInvitationFormatsResolveToTheSameRoom() {
        for(String input:new String[]{id,"  "+id+"\n","房间号："+id,id.toUpperCase(),
            "https://"+host+"/room/"+id,"https://"+host+"/mobile-room/"+id+"/",
            "https://"+host+"/?room="+id,"来一起看：https://"+host+"/room/"+id+"。"})
            assertEquals(input,id,RoomInvite.parse(input,host));
        assertEquals("legacy-Abcd",RoomInvite.parse("legacy-Abcd",host));
    }
    @Test public void invalidOrForeignInvitationsDoNotCreateNewRooms() {
        for(String input:new String[]{"", "123", "a".repeat(65),"https://evil.example/room/"+id,
            "https://user@"+host+"/room/"+id,"https://"+host+":8443/room/"+id,
            "http://"+host+"/room/"+id,"https://"+host+"/?room="+id+"&room=other",
            "https://"+host+"/room/abc%2Fdef","https://"+host+"/other?room="+id})
            assertEquals(input,"",RoomInvite.parse(input,host));
    }
}
