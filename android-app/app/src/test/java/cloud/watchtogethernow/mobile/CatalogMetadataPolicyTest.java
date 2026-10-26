package cloud.watchtogethernow.mobile;
import org.junit.Test;
import org.json.JSONObject;
import static org.junit.Assert.*;

public final class CatalogMetadataPolicyTest {
    @Test public void fixedSearchAndDetailIdentities() throws Exception {
        assertEquals("https://www.pkavi.com/vs/-------------.html?wd=%E6%B5%8B%E8%AF%95",CatalogMetadataPolicy.request("search",new JSONObject().put("source","pkavi").put("q","测试")).getString("url"));
        assertEquals("https://www.233dm.com/search/-------------.html?wd=a%20b",CatalogMetadataPolicy.request("search",new JSONObject().put("source","233dm").put("q"," a  b ")).getString("url"));
        assertEquals("https://www.kanju.ai/collections/browse?path=%2Fv1%2Fbrowse%2Fcatalog&q=test&page=1&limit=12",CatalogMetadataPolicy.request("search",new JSONObject().put("source","kanju").put("q","test")).getString("url"));
        assertEquals("variant:test",CatalogMetadataPolicy.request("detail",new JSONObject().put("source","kanju").put("page_url","https://www.kanju.ai/player/variant%3Atest")).getString("item"));
        assertEquals("12",CatalogMetadataPolicy.request("detail",new JSONObject().put("source","pkavi").put("page_url","https://www.pkavi.com/mv/12.html")).getString("item"));
    }
    @Test public void rejectsArbitraryRequestsAndCredentials() throws Exception {
        assertNull(CatalogMetadataPolicy.request("search",new JSONObject().put("source","pkavi").put("q","x").put("cookie","secret")));
        assertNull(CatalogMetadataPolicy.request("search",new JSONObject().put("source","__proto__").put("q","x")));
        assertNull(CatalogMetadataPolicy.request("search",new JSONObject().put("source","pkavi").put("q",123)));
        for(String url:new String[]{"https://127.0.0.1/mv/1.html","https://www.pkavi.com.evil.test/mv/1.html","https://user@www.pkavi.com/mv/1.html","https://www.pkavi.com:444/mv/1.html","https://www.pkavi.com/mv/1.html?token=secret","http://www.pkavi.com/mv/1.html"})
            assertNull(url,CatalogMetadataPolicy.request("detail",new JSONObject().put("source","pkavi").put("page_url",url)));
        assertFalse(CatalogMetadataPolicy.allowed("kanju","https://evil.test/login"));
        assertFalse(CatalogMetadataPolicy.catalogue("https://watchtogethernow.cloud.evil.test/discover","https://watchtogethernow.cloud"));
        assertFalse(CatalogMetadataPolicy.catalogue("https://watchtogethernow.cloud/mobile-room/123","https://watchtogethernow.cloud"));
        assertTrue(CatalogMetadataPolicy.catalogue("https://watchtogethernow.cloud/discover?q=test","https://watchtogethernow.cloud"));
    }
}
