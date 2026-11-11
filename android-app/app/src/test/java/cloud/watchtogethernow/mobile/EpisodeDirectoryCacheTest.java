package cloud.watchtogethernow.mobile;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;
public class EpisodeDirectoryCacheTest {
    private JSONObject req(String item)throws Exception{return new JSONObject().put("kind","detail").put("source","kanju").put("item",item).put("url","https://www.kanju.ai/player/"+item);}
    private JSONObject data(String item)throws Exception{return new JSONObject("{\"status\":\"ok\",\"source_id\":\"kanju\",\"item_id\":\""+item+"\",\"page_url\":\"https://www.kanju.ai/player/"+item+"\",\"episodes\":[{\"id\":\"ep-one\",\"title\":\"第1集\",\"cookie\":\"private\"},{\"id\":\"ep-two\",\"title\":\"第2集\"}],\"token\":\"private\"}");}
    @Test public void readOnceReuseForSameFilmWithoutAnotherNetworkRequest()throws Exception{
        EpisodeDirectoryCache c=new EpisodeDirectoryCache();c.remember(req("drama"),data("drama"),1000);
        JSONObject value=c.get(req("drama"),2000);assertEquals(2,value.getJSONArray("episodes").length());
        assertFalse(value.toString().contains("private"));value.remove("episodes");assertTrue(c.get(req("drama"),3000).has("episodes"));
    }
    @Test public void differentFilmsAndSourcesNeverMix()throws Exception{
        EpisodeDirectoryCache c=new EpisodeDirectoryCache();c.remember(req("drama"),data("drama"),0);
        assertNull(c.get(req("other"),1));assertNull(c.get(req("drama").put("source","pkavi"),1));
        c.remember(req("wrong"),data("drama"),1);assertNull(c.get(req("wrong"),2));
    }
    @Test public void expiresAndEmptyErrorsDoNotReplaceGoodDirectory()throws Exception{
        EpisodeDirectoryCache c=new EpisodeDirectoryCache();c.remember(req("drama"),data("drama"),0);
        c.remember(req("drama"),new JSONObject().put("status","unavailable"),100);
        assertNotNull(c.get(req("drama"),200));assertNull(c.get(req("drama"),900001));
    }
    @Test public void boundedMemoryEvictsOldestFilm()throws Exception{
        EpisodeDirectoryCache c=new EpisodeDirectoryCache();for(int i=0;i<9;i++)c.remember(req("film"+i),data("film"+i),i);
        assertNull(c.get(req("film0"),10));assertNotNull(c.get(req("film8"),10));
    }
}
