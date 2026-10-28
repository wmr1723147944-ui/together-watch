package cloud.watchtogethernow.mobile;
import org.junit.Test;
import org.json.JSONObject;
import static org.junit.Assert.*;

public final class CatalogMetadataPolicyTest {
    @Test public void allAndroidSourcesBuildChineseSearchRequests() throws Exception {
        for(String source:new String[]{"huarw","kanju","233dm","pkavi"}) {
            JSONObject request=CatalogMetadataPolicy.request("search",new JSONObject().put("source",source).put("q","元气少女"));
            assertNotNull(source,request);
            assertEquals("元气少女",request.getString("q"));
            assertTrue(CatalogMetadataPolicy.allowed(source,request.getString("url")));
            assertTrue(request.getString("url").contains("%E5%85%83%E6%B0%94%E5%B0%91%E5%A5%B3"));
        }
    }
    @Test public void queryNormalizationHandlesUnicodeWithoutPlatformSpecificRegex() {
        assertEquals("元气 少女 ABC",CatalogMetadataPolicy.normalizeQuery(" \t元气\u3000\u00a0少女\u202fＡＢＣ\n"));
        for(int separator:new int[]{0,9,10,31,32,127,133,160,0x1680,0x2000,0x2003,0x2007,
                0x2028,0x2029,0x202a,0x202e,0x202f,0x205f,0x2066,0x2069,0x3000}) {
            String s=new String(Character.toChars(separator));
            assertEquals(Integer.toHexString(separator),"元气 少女",CatalogMetadataPolicy.normalizeQuery(s+"元气"+s+s+"少女"+s));
        }
        assertEquals("",CatalogMetadataPolicy.normalizeQuery("\t\n\u00a0\u202a\u2069"));
        assertEquals("Re:从零开始 Part.2",CatalogMetadataPolicy.normalizeQuery("Re:从零开始 Part.2"));
    }
    @Test public void queryLimitPreservesSupplementaryCharactersAndRejectsEmptyRequests() throws Exception {
        String emoji=new String(Character.toChars(0x1f3ac));
        StringBuilder longQuery=new StringBuilder();
        for(int i=0;i<81;i++)longQuery.append(emoji);
        String q=CatalogMetadataPolicy.normalizeQuery(longQuery.toString());
        assertEquals(80,q.codePointCount(0,q.length()));
        assertEquals(160,q.length());
        assertTrue(q.endsWith(emoji));
        assertNotNull(CatalogMetadataPolicy.request("search",new JSONObject().put("source","kanju").put("q",longQuery.toString())));
        assertNull(CatalogMetadataPolicy.request("search",new JSONObject().put("source","kanju").put("q","\t\u3000\u202e")));
        for(int i=0;i<151;i++)longQuery.append('a');
        assertNull(CatalogMetadataPolicy.request("search",new JSONObject().put("source","kanju").put("q",longQuery.toString())));
    }
    @Test public void fixedSearchAndDetailIdentities() throws Exception {
        assertEquals("https://huarw.com/search?wd=a%20b",CatalogMetadataPolicy.request("search",new JSONObject().put("source","huarw").put("q","a b")).getString("url"));
        assertEquals("123",CatalogMetadataPolicy.request("detail",new JSONObject().put("source","huarw").put("page_url","https://huarw.com/movie/123")).getString("item"));
        for(String url:new String[]{"https://huarw.com.evil.test/movie/1","https://huarw.com/movie/1?token=x","https://huarw.com/play/1-1","https://user@huarw.com/movie/1"})
            assertNull(CatalogMetadataPolicy.request("detail",new JSONObject().put("source","huarw").put("page_url",url)));
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
