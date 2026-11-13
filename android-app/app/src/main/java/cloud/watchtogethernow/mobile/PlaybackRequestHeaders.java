package cloud.watchtogethernow.mobile;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;

/** Bounded, document-local public request context. Never stores Cookie or Authorization. */
final class PlaybackRequestHeaders {
    private final LinkedHashMap<String, Map<String,String>> observations = new LinkedHashMap<>();
    void clear() { observations.clear(); }
    void observe(String url, Map<String,String> headers) {
        if (origin(url).isEmpty()) return;
        Map<String,String> safe = new LinkedHashMap<>();
        headers.forEach((name,value) -> {
            if (value == null || value.length() > 2048 || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) return;
            if (name.equalsIgnoreCase("User-Agent")) safe.put("User-Agent",value);
            else if (name.equalsIgnoreCase("Origin") && !origin(value).isEmpty()) safe.put("Origin",origin(value));
            else if (name.equalsIgnoreCase("Referer")) {
                try {
                    URI u = URI.create(value);
                    if (!origin(value).isEmpty()) safe.put("Referer",new URI(u.getScheme(),null,u.getHost(),u.getPort(),u.getPath(),null,null).toString());
                } catch (Exception ignored) { }
            }
        });
        observations.remove(url); observations.put(url,safe);
        while (observations.size() > 256) observations.remove(observations.keySet().iterator().next());
    }
    Snapshot snapshot(String media, String referer, String userAgent) {
        Map<String,String> fallback = new LinkedHashMap<>();
        if (!referer.isEmpty()) fallback.put("Referer",referer);
        fallback.put("User-Agent",userAgent);
        Map<String,String> selected = observations.get(media);
        if (selected != null) { fallback = new LinkedHashMap<>(selected); fallback.putIfAbsent("User-Agent",userAgent); }
        return new Snapshot(media, userAgent, fallback, new LinkedHashMap<>(observations));
    }
    static String origin(String url) {
        try {
            URI u=URI.create(url);
            if (!"https".equalsIgnoreCase(u.getScheme()) || u.getHost()==null || u.getUserInfo()!=null) return "";
            return new URI("https",null,u.getHost(),u.getPort(),null,null,null).toString();
        } catch(Exception e) { return ""; }
    }
    static final class Snapshot {
        final String media, userAgent;
        final Map<String,String> selected;
        final Map<String,Map<String,String>> observed;
        Snapshot(String media, String userAgent, Map<String,String> selected, Map<String,Map<String,String>> observed) {
            this.media=media; this.userAgent=userAgent; this.selected=selected; this.observed=observed;
        }
        Map<String,String> forUrl(String url) {
            Map<String,String> result=new LinkedHashMap<>();
            // An observed absence is significant (Kanju uses no-referrer).
            if (observed.containsKey(url)) result.putAll(observed.get(url));
            else if (!origin(media).isEmpty() && origin(media).equals(origin(url))) result.putAll(selected);
            result.putIfAbsent("User-Agent",userAgent);
            return result;
        }
    }
}
