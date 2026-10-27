package cloud.watchtogethernow.mobile;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.JSONArray;
import org.json.JSONObject;
public class DanmakuPacketTest {
    @Test public void boundedPlainTextAndSession() throws Exception {
        JSONObject raw=new JSONObject().put("session","web-2-3").put("enabled",true).put("html","evil")
            .put("items",new JSONArray().put(new JSONObject().put("time",4).put("text","<b>hello</b>").put("lane",0).put("url","secret")));
        assertNull(DanmakuPacket.clean(raw,"web-1-3"));
        JSONObject clean=DanmakuPacket.clean(raw,"web-2-3");
        assertFalse(clean.has("html"));assertFalse(clean.getJSONArray("items").getJSONObject(0).has("url"));
        assertEquals("<b>hello</b>",clean.getJSONArray("items").getJSONObject(0).getString("text"));
    }
    @Test public void dropsBadLaneAndCapsLength() throws Exception {
        JSONArray rows=new JSONArray();for(int i=0;i<12;i++)rows.put(new JSONObject().put("time",4).put("text","x".repeat(200)).put("lane",i));
        JSONObject clean=DanmakuPacket.clean(new JSONObject().put("session",3).put("enabled",true).put("items",rows),3);
        assertEquals(6,clean.getJSONArray("items").length());assertEquals(80,clean.getJSONArray("items").getJSONObject(0).getString("text").length());
    }
}
