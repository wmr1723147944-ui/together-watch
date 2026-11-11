package cloud.watchtogethernow.mobile;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.LinkedHashMap;

/** In-memory public directories already read by this app, never media URLs or cookies. */
final class EpisodeDirectoryCache {
    private static final long TTL=15*60*1000;
    private static final class Entry { final long at;final String json;Entry(long at,String json){this.at=at;this.json=json;} }
    private final LinkedHashMap<String,Entry> entries=new LinkedHashMap<>();
    private static String key(JSONObject req) {return req.optString("source")+"|"+req.optString("item");}
    void remember(JSONObject req,JSONObject data,long now) {
        if(!"detail".equals(req.optString("kind")) || !"ok".equals(data.optString("status"))
            || !req.optString("source").equals(data.optString("source_id"))
            || !req.optString("item").equals(data.optString("item_id")) || !req.optString("url").equals(data.optString("page_url")))return;
        try {
            JSONArray rows=data.optJSONArray("episodes"),clean=new JSONArray();
            if(rows==null)return;
            for(int i=0;i<Math.min(rows.length(),6000);i++) {
                JSONObject row=rows.optJSONObject(i);if(row==null)continue;
                ProgramPolicy.Selection p=ProgramPolicy.create(req.optString("source"),req.optString("item"),row.optString("id"));
                if(p==null || !p.exact())continue;
                String title=row.optString("title");if(title.isEmpty() || title.length()>120)continue;
                clean.put(new JSONObject().put("id",p.episode).put("title",title));
            }
            if(clean.length()==0)return;
            JSONObject saved=new JSONObject().put("source_id",req.optString("source")).put("item_id",req.optString("item"))
                .put("page_url",req.optString("url")).put("status","ok").put("episodes",clean)
                .put("title",data.optString("title").substring(0,Math.min(160,data.optString("title").length())));
            entries.remove(key(req));entries.put(key(req),new Entry(now,saved.toString()));
            while(entries.size()>8)entries.remove(entries.keySet().iterator().next());
        }catch(Exception ignored){}
    }
    JSONObject get(JSONObject req,long now) {
        if(!"detail".equals(req.optString("kind")))return null;
        Entry e=entries.get(key(req));if(e==null)return null;
        if(now<e.at || now-e.at>TTL){entries.remove(key(req));return null;}
        try {JSONObject data=new JSONObject(e.json);return req.optString("url").equals(data.optString("page_url"))?data:null;}
        catch(Exception ignored){return null;}
    }
}
