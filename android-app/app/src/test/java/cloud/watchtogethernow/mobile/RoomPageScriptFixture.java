package cloud.watchtogethernow.mobile;

import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/** The Chromium regression executes these exact production Java-generated scripts. */
public class RoomPageScriptFixture {
    public static void main(String[] args) throws Exception {
        String origin="https://watchtogethernow.cloud",token="1234-abcd",room="fixture-room";
        String boot=origin+"/__tw_room_bootstrap/"+token,target=origin+"/mobile-room/"+room;
        String payload=new JSONObject().put("document",RoomPageScripts.document(token))
            .put("bootstrap",boot).put("room",target)
            .put("initialize",RoomPageScripts.initialize(boot,token,room,"观影者\"<test>","2026-07-28"))
            .put("probe",RoomPageScripts.probe(target,room)).toString();
        System.out.print(Base64.getEncoder().encodeToString(payload.getBytes(StandardCharsets.UTF_8)));
    }
}
