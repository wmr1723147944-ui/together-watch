package cloud.watchtogethernow.mobile;

import org.json.JSONArray;
import org.json.JSONObject;

/** Do not forward arbitrary page properties (URLs, cookies or account data). */
final class PlaybackBoundary {
    private static double number(JSONObject o,String key,double fallback,double min,double max) {
        double value=o.optDouble(key,fallback);
        return Double.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
    }
    static JSONObject sample(JSONObject raw,int generation) throws Exception {
        JSONObject result=new JSONObject().put("active",false);
        if(raw==null || !raw.optBoolean("active") || raw.optDouble("area",0)<=0
            || !Double.isFinite(raw.optDouble("time")) || raw.optDouble("time")<0
            || raw.optLong("session",-1)<0)return result;
        result.put("active",true).put("session","web-"+generation+"-"+raw.optLong("session"));
        result.put("time",number(raw,"time",0,0,604800)).put("duration",number(raw,"duration",0,0,604800));
        result.put("speed",number(raw,"speed",1,.25,4)).put("playing",raw.optBoolean("playing"));
        result.put("holding",raw.optBoolean("holding"));
        result.put("visualTime",number(raw,"visualTime",result.optDouble("time"),0,604800));
        result.put("visualSpeed",number(raw,"visualSpeed",result.optDouble("speed"),.25,4));
        result.put("ready",raw.optBoolean("ready")&&!raw.optBoolean("blocked")).put("seeking",raw.optBoolean("seeking"));
        result.put("appliedCommand",Math.max(0,raw.optLong("appliedCommand")));
        JSONArray events=new JSONArray(),incoming=raw.optJSONArray("events");
        if(incoming!=null)for(int i=0;i<Math.min(16,incoming.length());i++){
            JSONObject e=incoming.optJSONObject(i);
            if(e==null || !e.optString("type").matches("play|pause|seek|speed") || !Double.isFinite(e.optDouble("time")))continue;
            events.put(new JSONObject().put("type",e.optString("type")).put("time",number(e,"time",0,0,604800)).put("speed",number(e,"speed",1,.25,4)));
        }
        return result.put("events",events);
    }
    static JSONObject command(JSONObject raw,int generation,long localSession) throws Exception {
        if(raw==null || !raw.optString("session").equals("web-"+generation+"-"+localSession))return null;
        JSONObject result=new JSONObject().put("session",localSession).put("type",raw.optString("type"));
        if(raw.optString("type").equals("volume"))return result.put("value",number(raw,"value",1,0,1));
        if(!raw.optString("type").equals("state") || raw.optLong("id",-1)<0 || !Double.isFinite(raw.optDouble("time")))return null;
        return result.put("id",raw.optLong("id")).put("time",number(raw,"time",0,0,604800))
            .put("speed",number(raw,"speed",1,.25,4)).put("playing",raw.optBoolean("playing"))
            .put("seek",raw.optBoolean("seek")).put("issuedAt",number(raw,"issuedAt",System.currentTimeMillis(),0,9007199254740991L));
    }
}
