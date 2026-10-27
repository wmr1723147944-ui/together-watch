package cloud.watchtogethernow.mobile;

import org.json.JSONArray;
import org.json.JSONObject;

/** The room may provide bounded plain text, never HTML or executable content. */
final class DanmakuPacket {
    static JSONObject clean(JSONObject raw, Object session) throws Exception {
        if(raw==null || session==null || !String.valueOf(session).equals(raw.optString("session")))return null;
        JSONArray items=new JSONArray(),input=raw.optJSONArray("items");
        if(input==null)return null;
        for(int i=0;i<Math.min(6,input.length());i++) {
            JSONObject r=input.optJSONObject(i);if(r==null || !(r.opt("text") instanceof String))continue;
            double time=r.optDouble("time",-1);int lane=r.optInt("lane",-1);
            if(!Double.isFinite(time)||time<0||time>604800||lane<0||lane>=6||r.optDouble("lane")!=lane)continue;
            String text=r.optString("text");
            items.put(new JSONObject().put("text",text.substring(0,Math.min(80,text.length())))
                .put("time",time).put("lane",lane).put("kind","room".equals(r.optString("kind"))?"room":"public"));
        }
        return new JSONObject().put("enabled",raw.optBoolean("enabled")).put("opacity",.85).put("size",22).put("items",items);
    }
}
