package cloud.watchtogethernow.mobile;

import java.net.URI;
import java.net.URLEncoder;
import java.net.URLDecoder;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Public episode identities only. Never accept a media token as an invitation. */
final class ProgramPolicy {
    static final String PUBLIC_ID = "[A-Za-z0-9_-]{1,160}(?::[A-Za-z0-9_-]{1,80})?";
    static final class Selection {
        final String source, item, episode, page;
        Selection(String source, String item, String episode, String page) {
            this.source=source; this.item=item; this.episode=episode; this.page=page;
        }
        boolean exact() { return !episode.equals("page"); }
        boolean needsConfirmation() { return source.equals("cupfox") || source.equals("yhdmoe") || source.equals("kanju"); }
    }
    private static boolean matches(String value, String pattern) { return value!=null && value.matches(pattern); }
    private static String encode(String value) { try {return URLEncoder.encode(value,"UTF-8").replace("+","%20");} catch(Exception ignored){return "";} }
    private static String decode(String value) { try {return URLDecoder.decode(value,"UTF-8");} catch(Exception ignored){return "";} }
    static Selection create(String source, String item, String episode) {
        if(source==null || item==null || episode==null || item.length()>241 || episode.length()>244) return null;
        String page=null;
        if(source.equals("sample") && matches(item,"sintel|bunny") && episode.equals("video"))
            page="https://media.w3.org/2010/05/"+item+"/trailer.mp4";
        else if(source.equals("kanju") && matches(item,PUBLIC_ID)) {
            if(episode.equals("page")) page="https://www.kanju.ai/player/"+encode(item);
            else if(episode.startsWith("ep-") && matches(episode.substring(3),PUBLIC_ID))
                page="https://www.kanju.ai/player/"+encode(item)+"?episode="+encode(episode.substring(3));
        } else if(source.equals("cupfox") && matches(item,"[0-9]{1,20}") && matches(episode,"ep[0-9]{1,5}"))
            page="https://www.cupfox.in/vod-detail/"+item+".html";
        else if(source.equals("huarw") && matches(item,"[0-9]{1,20}") && matches(episode,Pattern.quote(item)+"(?:-[0-9]{1,5}){1,3}"))
            page="https://huarw.com/play/"+episode;
        else if(source.equals("yhdmoe") && matches(item,"[0-9]{1,20}") && matches(episode,"EP[0-9]{1,5}(?:\\.[0-9]{1,2})?"))
            page="https://yhdmoe.com/watch/"+item+"#play_ep_"+episode;
        else if(source.equals("fcma") && matches(item,"[0-9]{1,20}-[0-9]{1,5}") && matches(episode,"[0-9]{1,20}"))
            page="https://www.fcma.cc/p/"+item.replace('-','/')+"/"+episode;
        else if(source.equals("ddys") && matches(item,"[a-z0-9][a-z0-9-]{0,119}") && episode.equals("page"))
            page="https://ddys.io/movie/"+item;
        else if(source.equals("blender") && matches(item,"[0-9a-f-]{36}") && episode.equals("video"))
            page="https://video.blender.org/videos/watch/"+item;
        else if(matches(episode,"[1-9][0-9]{0,4}-[1-9][0-9]{0,4}")) {
            String[] e=episode.split("-");
            if(source.equals("233dm") && matches(item,"[a-f0-9]{24}")) page="https://www.233dm.com/anime/"+item+"/play/"+e[0]+"/"+e[1]+".html";
            if(source.equals("pkavi") && matches(item,"[1-9][0-9]{0,19}")) page="https://www.pkavi.com/py/"+item+"-"+episode+".html";
        }
        return page==null ? null : new Selection(source,item,episode,page);
    }
    static Selection handoff(String value, String server) {
        try {
            URI u=new URI(value);
            if(!server.equals(u.getScheme()+"://"+u.getRawAuthority()) || u.getRawQuery()!=null || u.getRawFragment()!=null || u.getUserInfo()!=null) return null;
            String[] parts=u.getPath().split("/",-1);
            return parts.length==6 && parts[1].equals("discover") && parts[2].equals("play") ? create(parts[3],parts[4],parts[5]) : null;
        } catch(Exception ignored) {return null;}
    }
    static Selection fromPage(String value) {
        if(value==null || value.length()>2048 || value.contains("\\")) return null;
        for(String item:new String[]{"sintel","bunny"}) {Selection s=create("sample",item,"video");if(s.page.equals(value))return s;}
        try {
            URI u=new URI(value);
            if(!"https".equals(u.getScheme()) || u.getUserInfo()!=null || u.getPort()!=-1) return null;
            if("www.kanju.ai".equals(u.getHost()) || "kanju.ai".equals(u.getHost())) {
                if(u.getFragment()!=null || !u.getPath().startsWith("/player/")) return null;
                String ep="page";java.util.Set<String> seen=new java.util.HashSet<>();
                if(u.getRawQuery()!=null) for(String part:u.getRawQuery().split("&")) {
                    String[] kv=part.split("=",2);String k=decode(kv[0]);
                    if(!matches(k,"episode|line|from|resume|adult") || !seen.add(k)) return null;
                    String v=kv.length==2?decode(kv[1]):"";
                    if((k.equals("episode") || k.equals("line")) && !matches(v,PUBLIC_ID)) return null;
                    if(k.equals("episode")) ep="ep-"+v;
                }
                return create("kanju",u.getPath().substring(8),ep);
            }
            if(u.getRawQuery()!=null) return null;
            String p=u.getPath();Matcher m;
            if("www.233dm.com".equals(u.getHost()) && (m=Pattern.compile("/anime/([a-f0-9]{24})/play/([1-9][0-9]{0,4})/([1-9][0-9]{0,4})\\.html").matcher(p)).matches() && u.getFragment()==null)
                return create("233dm",m.group(1),m.group(2)+"-"+m.group(3));
            if("www.pkavi.com".equals(u.getHost()) && (m=Pattern.compile("/py/([1-9][0-9]{0,19})-([1-9][0-9]{0,4})-([1-9][0-9]{0,4})\\.html").matcher(p)).matches() && u.getFragment()==null)
                return create("pkavi",m.group(1),m.group(2)+"-"+m.group(3));
            if("huarw.com".equals(u.getHost()) && (m=Pattern.compile("/play/(([0-9]{1,20})(?:-[0-9]{1,5}){1,3})").matcher(p)).matches() && u.getFragment()==null)
                return create("huarw",m.group(2),m.group(1));
            if("yhdmoe.com".equals(u.getHost()) && p.matches("/watch/[0-9]{1,20}") && u.getFragment()!=null && u.getFragment().startsWith("play_ep_"))
                return create("yhdmoe",p.substring(7),u.getFragment().substring(8));
            if("www.fcma.cc".equals(u.getHost()) && (m=Pattern.compile("/p/([0-9]{1,20})/([0-9]{1,5})/([0-9]{1,20})").matcher(p)).matches() && u.getFragment()==null)
                return create("fcma",m.group(1)+"-"+m.group(2),m.group(3));
            if("video.blender.org".equals(u.getHost()) && p.startsWith("/videos/watch/") && u.getFragment()==null)
                return create("blender",p.substring(14),"video");
            if("ddys.io".equals(u.getHost()) && p.startsWith("/movie/") && u.getFragment()==null) return create("ddys",p.substring(7),"page");
        } catch(Exception ignored) { /* reject malformed or private identities */ }
        return null;
    }
}
