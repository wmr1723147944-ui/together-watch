package cloud.watchtogethernow.mobile;

import java.net.URI;
import java.util.Locale;

/** Pure rules, shared by discovery and explicit direct-link handling. */
final class MediaSourcePolicy {
    private static final String[] WEB_PLAYBACK_HOSTS = {
        "iqiyi.com", "youku.com", "qq.com", "mgtv.com", "bilibili.com",
        "youtube.com", "youtu.be", "netflix.com", "disneyplus.com", "douyin.com", "kuaishou.com"
    };
    private MediaSourcePolicy() { }
    static boolean preferWeb(String page) {
        try {
            String host = URI.create(page).getHost();
            if (host == null) return true;
            host = host.toLowerCase(Locale.ROOT);
            if (host.endsWith(".")) host = host.substring(0,host.length()-1);
            for (String domain : WEB_PLAYBACK_HOSTS) {
                if (host.equals(domain) || host.endsWith("." + domain)) return true;
            }
            return false;
        } catch (IllegalArgumentException error) { return true; }
    }
    static boolean isMedia(String value) {
        try {
            URI uri = URI.create(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null) return false;
            String path = uri.getPath();
            return path != null && path.toLowerCase(Locale.ROOT).matches(".*\\.(mp4|m4v|webm|m3u8|mpd)$");
        } catch (IllegalArgumentException error) { return false; }
    }
    // Only DOM discovery of a loaded video can opt in to an opaque CDN
    // path or ".image" alias. Ordinary image traffic is never a candidate.
    static boolean playable(String value, boolean confirmed) {
        if(isMedia(value))return true;
        if(!confirmed)return false;
        try {
            URI u=URI.create(value);
            if(!"https".equalsIgnoreCase(u.getScheme()) || u.getHost()==null || u.getUserInfo()!=null)return false;
            String path=u.getPath(), leaf=path.substring(path.lastIndexOf('/')+1);
            return !leaf.isEmpty() && (!leaf.contains(".") || leaf.toLowerCase(Locale.ROOT).endsWith(".image"));
        }catch(RuntimeException ignored){return false;}
    }
    static String origin(String value) {
        try {
            URI uri = URI.create(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) return "";
            return new URI("https", null, uri.getHost(), uri.getPort(), "/", null, null).toString();
        } catch (Exception error) { return ""; }
    }
    static String displayName(String value) {
        try {
            URI uri = URI.create(value);
            String path = uri.getPath();
            String name = path.substring(path.lastIndexOf('/') + 1);
            return uri.getHost() + " / " + (name.length() > 55 ? name.substring(0, 55) + "…" : name);
        } catch (Exception error) { return "视频来源"; }
    }
}
