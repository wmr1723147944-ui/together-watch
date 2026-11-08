package cloud.watchtogethernow.mobile;
import org.junit.Test;
import org.json.JSONObject;
import org.json.JSONArray;
import static org.junit.Assert.*;

public class ClientUpdatePolicyTest {
    private JSONObject release() throws Exception {
        return new JSONObject().put("platform","android").put("version","0.3.29").put("version_code",34)
            .put("filename","TogetherWatch-Android-0.3.29.apk").put("download_path","/downloads/files/TogetherWatch-Android-0.3.29.apk")
            .put("sha256","a".repeat(64)).put("size",123).put("notes",new JSONArray().put("更新说明"));
    }
    private String json(JSONObject r) throws Exception {return new JSONObject().put("schema",1).put("available",true).put("release",r).toString();}
    @Test public void versionsAreNumericAndNeverOfferDowngrade() throws Exception {
        assertTrue(ClientUpdatePolicy.compare("0.3.10","0.3.9")>0);
        assertEquals("available",ClientUpdatePolicy.parse(json(release()),"0.3.28",33).state);
        assertEquals("current",ClientUpdatePolicy.parse(json(release()),"0.3.30",35).state);
        assertEquals("current",ClientUpdatePolicy.parse(json(release().put("version_code",32)),"0.3.28",33).state);
        assertEquals("unpublished",ClientUpdatePolicy.parse("{\"schema\":1,\"available\":false}","0.3.28",33).state);
    }
    @Test public void untrustedPathsMalformedNotesAndBadCodesAreRejected() throws Exception {
        for(JSONObject r:new JSONObject[]{release().put("download_path","https://evil.invalid/a.apk"),release().put("filename","../../other.apk"),
            release().put("version_code",34.5),release().put("size",true),release().put("sha256","bad"),release().put("notes",new JSONArray().put("x".repeat(241)))}) {
            try {ClientUpdatePolicy.parse(json(r),"0.3.28",33);fail("must reject");}catch(IllegalArgumentException expected){}
        }
    }
    @Test public void automaticPromptsRespectWatchingAndOneOfferPerLaunch() {
        ClientUpdatePolicy.Result result=new ClientUpdatePolicy.Result("available","0.3.29","");
        java.util.Set<String> offered=new java.util.HashSet<>();
        assertFalse(ClientUpdatePolicy.mayNotify(result,false,true,offered));
        assertTrue(ClientUpdatePolicy.mayNotify(result,false,false,offered));
        offered.add("0.3.29");
        assertFalse(ClientUpdatePolicy.mayNotify(result,false,false,offered));
        assertTrue(ClientUpdatePolicy.mayNotify(result,true,true,offered));
        assertTrue(ClientUpdatePolicy.mayNotify(result,false,false,new java.util.HashSet<>()));
        assertTrue(ClientUpdatePolicy.mayNotify(new ClientUpdatePolicy.Result("available","0.3.30",""),false,false,offered));
    }
    @Test public void offlineCurrentAndUnpublishedAreSilentAtStartup() {
        for(String state:new String[]{"offline","current","unpublished"})
            assertFalse(ClientUpdatePolicy.mayNotify(new ClientUpdatePolicy.Result(state,"",""),false,false,new java.util.HashSet<>()));
        assertFalse(ClientUpdatePolicy.mayNotify(null,true,false,new java.util.HashSet<>()));
    }
}
