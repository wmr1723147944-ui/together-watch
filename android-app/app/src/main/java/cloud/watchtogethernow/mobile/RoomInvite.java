package cloud.watchtogethernow.mobile;

import java.net.URI;
import java.net.URLDecoder;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Public room identity only; never navigates an untrusted invitation URL. */
final class RoomInvite {
    private static final Pattern ID = Pattern.compile("[\\p{L}\\p{N}_-]{4,64}");
    private static String cleanId(String text) {
        if (!ID.matcher(text).matches()) return "";
        return text.matches("[A-Fa-f0-9]{24}") ? text.toLowerCase(Locale.ROOT) : text;
    }
    static String parse(String raw, String serverHost) {
        String text = raw == null ? "" : raw.trim();
        if (text.length() > 2048) return "";
        String id = cleanId(text.replaceFirst("^房间(?:号)?[：:\\s]+", "").trim());
        if (!id.isEmpty()) return id;
        Matcher link = Pattern.compile("https://[^\\s<>]+", Pattern.CASE_INSENSITIVE).matcher(text);
        if (!link.find()) return "";
        String value = link.group().replaceFirst("[)\\]}>，。；！？]+$", "");
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                || !uri.getHost().equalsIgnoreCase(serverHost) || uri.getUserInfo() != null
                || (uri.getPort() != -1 && uri.getPort() != 443)) return "";
            Matcher path = Pattern.compile("^/(?:mobile-room|room)/([^/]+)/?$").matcher(uri.getPath());
            if (path.matches()) return cleanId(path.group(1));
            if (!uri.getPath().isEmpty() && !uri.getPath().equals("/")) return "";
            String candidate = null;
            for (String entry : (uri.getRawQuery() == null ? "" : uri.getRawQuery()).split("&")) {
                String[] kv = entry.split("=", 2);
                if (!URLDecoder.decode(kv[0], "UTF-8").equals("room")) continue;
                if (candidate != null || kv.length != 2) return "";
                candidate = URLDecoder.decode(kv[1], "UTF-8");
            }
            return candidate == null ? "" : cleanId(candidate.trim());
        } catch (Exception ignored) { return ""; }
    }
}
