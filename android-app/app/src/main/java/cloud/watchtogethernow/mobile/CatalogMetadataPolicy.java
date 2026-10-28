package cloud.watchtogethernow.mobile;

import org.json.JSONObject;
import java.net.URI;
import java.net.URLEncoder;
import java.text.Normalizer;
import java.util.Iterator;

/** Fixed public metadata requests only: no supplied headers, cookies or private URLs. */
final class CatalogMetadataPolicy {
    static String host(String source) {
        if("pkavi".equals(source))return "www.pkavi.com";
        if("233dm".equals(source))return "www.233dm.com";
        if("kanju".equals(source))return "www.kanju.ai";
        if("huarw".equals(source))return "huarw.com";
        return "";
    }
    static boolean allowed(String source,String url) {
        try {
            URI u=new URI(url);
            return !host(source).isEmpty() && "https".equals(u.getScheme()) && host(source).equals(u.getHost())
                && u.getUserInfo()==null && u.getPort()==-1;
        } catch(Exception ignored){return false;}
    }
    static boolean catalogue(String url,String origin) {
        try {URI u=new URI(url);return origin.equals(u.getScheme()+"://"+u.getRawAuthority()) && u.getUserInfo()==null
            && ("/".equals(u.getPath()) || "/discover".equals(u.getPath()));}catch(Exception ignored){return false;}
    }
    static boolean only(JSONObject object,String... keys) {
        for(Iterator<String> it=object.keys();it.hasNext();) {
            String key=it.next();boolean ok=false;for(String k:keys)if(k.equals(key))ok=true;
            if(!ok)return false;
        }
        return true;
    }
    static String normalizeQuery(String value) {
        // Android uses ICU regex, not the desktop JDK engine. Keep this path
        // regex-free: an unsupported inline flag used to reject every search.
        String normalized=Normalizer.normalize(value,Normalizer.Form.NFKC);
        StringBuilder result=new StringBuilder();
        boolean space=false;
        for(int i=0;i<normalized.length();) {
            int point=normalized.codePointAt(i);i+=Character.charCount(point);
            if(point<=0x20 || point==0x7f || point==0x85
                || point>=0x202a && point<=0x202e || point>=0x2066 && point<=0x2069
                || Character.isWhitespace(point) || Character.isSpaceChar(point)) {
                space=result.length()>0;
            } else {
                if(space)result.append(' ');
                result.appendCodePoint(point);space=false;
            }
        }
        if(result.codePointCount(0,result.length())>80)result.setLength(result.offsetByCodePoints(0,80));
        return result.toString().trim();
    }
    static JSONObject request(String kind,JSONObject payload) {
        try {
            if(payload==null || !(payload.opt("source") instanceof String))return null;
            String source=payload.getString("source"),host=host(source),url,item="",q="";
            if(host.isEmpty())return null;
            if("search".equals(kind)) {
                if(!only(payload,"source","q") || !(payload.opt("q") instanceof String) || payload.getString("q").length()>300)return null;
                q=normalizeQuery(payload.getString("q"));
                if(q.isEmpty())return null;
                String encoded=URLEncoder.encode(q,"UTF-8").replace("+","%20");
                url="https://"+host+(source.equals("kanju")?"/collections/browse?path=%2Fv1%2Fbrowse%2Fcatalog&q="+encoded+"&page=1&limit=12"
                    :source.equals("huarw")?"/search?wd="+encoded
                    :(source.equals("pkavi")?"/vs/":"/search/")+"-------------.html?wd="+encoded);
            } else if("detail".equals(kind)) {
                if(!only(payload,"source","page_url") || !(payload.opt("page_url") instanceof String))return null;
                url=payload.getString("page_url");if(url.length()>1024 || !allowed(source,url))return null;
                URI u=new URI(url);
                if(source.equals("kanju")) {
                    ProgramPolicy.Selection s=ProgramPolicy.fromPage(url);
                    if(s==null || !s.source.equals(source))return null;
                    item=s.item;url=ProgramPolicy.create(source,item,"page").page;
                } else {
                    if(u.getRawQuery()!=null || u.getRawFragment()!=null)return null;
                    String pattern=source.equals("huarw")?"/movie/([0-9]{1,20})":source.equals("pkavi")?"/mv/([1-9][0-9]{0,19})\\.html":"/anime/([a-f0-9]{24})\\.html";
                    java.util.regex.Matcher m=java.util.regex.Pattern.compile(pattern).matcher(u.getRawPath());
                    if(!m.matches())return null;item=m.group(1);
                }
            } else return null;
            JSONObject req=new JSONObject().put("kind",kind).put("source",source).put("url",url);
            return req.put(kind.equals("search")?"q":"item",kind.equals("search")?q:item);
        }catch(Exception ignored){return null;}
    }
}
