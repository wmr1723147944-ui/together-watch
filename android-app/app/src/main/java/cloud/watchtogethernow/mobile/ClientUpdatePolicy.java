package cloud.watchtogethernow.mobile;

import org.json.JSONArray;
import org.json.JSONObject;

final class ClientUpdatePolicy {
    private static final String VERSION="(?:0|[1-9]\\d{0,3})\\.(?:0|[1-9]\\d{0,3})\\.(?:0|[1-9]\\d{0,3})";
    static int compare(String a,String b) {
        if(a==null || b==null || !a.matches(VERSION) || !b.matches(VERSION))throw new IllegalArgumentException("version");
        String[] left=a.split("\\."),right=b.split("\\.");
        for(int i=0;i<3;i++){int order=Integer.compare(Integer.parseInt(left[i]),Integer.parseInt(right[i]));if(order!=0)return order;}return 0;
    }
    static final class Result {
        final String state,version,notes;
        Result(String state,String version,String notes){this.state=state;this.version=version;this.notes=notes;}
    }
    static Result parse(String json,String installed,int installedCode) throws Exception {
        if(json==null || json.length()>32768)throw new IllegalArgumentException("size");
        JSONObject data=new JSONObject(json);
        if(!Integer.valueOf(1).equals(data.opt("schema")) || !(data.opt("available") instanceof Boolean))throw new IllegalArgumentException("schema");
        if(!data.getBoolean("available"))return new Result("unpublished","","");
        JSONObject r=data.getJSONObject("release");String version=r.getString("version");
        String filename="TogetherWatch-Android-"+version+".apk";
        Object size=r.opt("size"),code=r.opt("version_code");
        if(!version.matches(VERSION) || !"android".equals(r.getString("platform")) || !filename.equals(r.getString("filename"))
            || !("/downloads/files/"+filename).equals(r.getString("download_path")) || !r.getString("sha256").matches("[0-9a-f]{64}")
            || !(size instanceof Integer || size instanceof Long) || ((Number)size).longValue()<=0 || ((Number)size).longValue()>1073741824L
            || !(code instanceof Integer) || (Integer)code<=0 || (Integer)code>2100000000)throw new IllegalArgumentException("release");
        JSONArray notes=r.getJSONArray("notes");if(notes.length()>8)throw new IllegalArgumentException("notes");
        StringBuilder text=new StringBuilder();
        for(int i=0;i<notes.length();i++) {if(!(notes.get(i) instanceof String) || notes.getString(i).length()>240)throw new IllegalArgumentException("notes");if(i>0)text.append('\n');text.append(notes.getString(i));}
        boolean newer=(Integer)code>installedCode && compare(version,installed)>=0;
        return new Result(newer?"available":"current",version,text.toString());
    }
    static boolean mayNotify(Result result,boolean manual,boolean watching,java.util.Set<String> notifiedVersions) {
        return result!=null && (manual || ("available".equals(result.state) && !watching && !notifiedVersions.contains(result.version)));
    }
}
