package cloud.watchtogethernow.mobile;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class PlaybackBoundaryTest {
    private JSONObject sample() throws Exception {
        return new JSONObject().put("active",true).put("area",300).put("session",2)
            .put("time",23).put("duration",600).put("speed",1).put("ready",true);
    }
    @Test public void onlyTimingCrossesThePageBoundary() throws Exception {
        JSONObject input=sample().put("url","https://media.example/v?secret=private")
            .put("cookie","account=private").put("token","private")
            .put("events",new JSONArray().put(new JSONObject().put("type","seek").put("time",40).put("token","private")));
        JSONObject output=PlaybackBoundary.sample(input,5);
        assertTrue(output.getBoolean("active"));assertEquals("web-5-2",output.getString("session"));
        assertFalse(output.toString().contains("private"));assertFalse(output.has("url"));
        assertEquals("seek",output.getJSONArray("events").getJSONObject(0).getString("type"));
    }
    @Test public void hiddenOrInvalidPlayersStayInactive() throws Exception {
        assertFalse(PlaybackBoundary.sample(sample().put("area",0),5).optBoolean("active"));
        assertFalse(PlaybackBoundary.sample(sample().put("time",-1),5).optBoolean("active"));
        assertFalse(PlaybackBoundary.sample(sample().put("session",-1),5).optBoolean("active"));
        assertFalse(PlaybackBoundary.sample(null,5).optBoolean("active"));
    }
    @Test public void eventCountIsBoundedAndBlockedAutoplayIsNotReady() throws Exception {
        JSONArray events=new JSONArray();for(int i=0;i<100;i++)events.put(new JSONObject().put("type","play").put("time",i));
        JSONObject output=PlaybackBoundary.sample(sample().put("blocked",true).put("events",events),3);
        assertFalse(output.getBoolean("ready"));assertEquals(16,output.getJSONArray("events").length());
        assertEquals(4,PlaybackBoundary.sample(sample().put("speed",100),3).getDouble("speed"),0);
    }
    @Test public void bothPageAndPlayerSessionMustMatchBeforeApplyingACommand() throws Exception {
        JSONObject command=new JSONObject().put("type","state").put("id",123).put("session","web-5-2").put("time",20).put("speed",1).put("url","private");
        assertNull(PlaybackBoundary.command(command,4,2));assertNull(PlaybackBoundary.command(command,5,3));
        JSONObject clean=PlaybackBoundary.command(command,5,2);assertNotNull(clean);
        assertEquals(2,clean.getLong("session"));assertFalse(clean.has("url"));
        assertNull(PlaybackBoundary.command(command.put("id",-1),5,2));
    }
    @Test public void rejectNonPlaybackCommandsAndClampVolume() throws Exception {
        JSONObject command=new JSONObject().put("session","web-5-2").put("type","navigate").put("url","private");
        assertNull(PlaybackBoundary.command(command,5,2));
        assertEquals(1,PlaybackBoundary.command(command.put("type","volume").put("value",9),5,2).getDouble("value"),0);
    }
}
