package cloud.watchtogethernow.mobile;

import android.net.Uri;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class UrlPolicy {
    private static final Pattern ROOM_PATTERN = Pattern.compile("^[\\p{L}\\p{N}_-]{4,64}$");
    private static final Pattern ROOM_PATH_PATTERN = Pattern.compile("^/room/([^/?#]+)$");
    private static final Pattern HTTPS_IN_TEXT = Pattern.compile("https://\\S+", Pattern.CASE_INSENSITIVE);

    private UrlPolicy() {}

    static String normalizeHttpsUrl(String rawValue) {
        String value = rawValue == null ? "" : rawValue.trim();
        if (value.isEmpty()) return "";
        if (!value.contains("://")) value = "https://" + value;

        Uri uri = Uri.parse(value);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (!"https".equalsIgnoreCase(scheme) || host == null || host.trim().isEmpty()) return "";
        if (isLocalOrPrivateHost(host)) return "";
        return uri.toString();
    }

    static boolean isHttpsWebUrl(String rawValue) {
        return !normalizeHttpsUrl(rawValue).isEmpty();
    }

    static String extractFirstHttpsUrl(String rawValue) {
        String normalized = normalizeHttpsUrl(rawValue);
        if (!normalized.isEmpty()) return normalized;
        Matcher matcher = HTTPS_IN_TEXT.matcher(rawValue == null ? "" : rawValue);
        if (!matcher.find()) return "";
        String candidate = matcher.group();
        while (!candidate.isEmpty() && ")]}>，。；！？".indexOf(candidate.charAt(candidate.length() - 1)) >= 0) {
            candidate = candidate.substring(0, candidate.length() - 1);
        }
        return normalizeHttpsUrl(candidate);
    }

    static String extractRoom(String rawValue, String serverHost) {
        String value = rawValue == null ? "" : rawValue.trim();
        if (ROOM_PATTERN.matcher(value).matches()) return value;

        String inviteUrl = extractFirstHttpsUrl(value);
        Uri uri = Uri.parse(inviteUrl);
        if (!"https".equalsIgnoreCase(uri.getScheme())) return "";
        if (uri.getHost() == null || !uri.getHost().equalsIgnoreCase(serverHost)) return "";
        Matcher matcher = ROOM_PATH_PATTERN.matcher(uri.getPath() == null ? "" : uri.getPath());
        if (!matcher.matches()) return "";
        String candidate = Uri.decode(matcher.group(1));
        return ROOM_PATTERN.matcher(candidate).matches() ? candidate : "";
    }

    static boolean isTrustedServerUrl(String rawValue, String serverHost) {
        Uri uri = Uri.parse(rawValue == null ? "" : rawValue);
        return "https".equalsIgnoreCase(uri.getScheme())
            && uri.getHost() != null
            && uri.getHost().equalsIgnoreCase(serverHost);
    }

    private static boolean isLocalOrPrivateHost(String rawHost) {
        String host = rawHost.toLowerCase(Locale.ROOT).replace("[", "").replace("]", "");
        if (host.equals("localhost") || host.equals("::1") || host.endsWith(".local")) return true;
        if (host.equals("0.0.0.0") || host.startsWith("127.") || host.startsWith("10.")) return true;
        if (host.startsWith("192.168.")) return true;
        if (host.startsWith("169.254.")) return true;
        if (host.startsWith("100.")) {
            String[] parts = host.split("\\.");
            if (parts.length > 1) {
                try {
                    int second = Integer.parseInt(parts[1]);
                    if (second >= 64 && second <= 127) return true;
                } catch (NumberFormatException ignored) {
                    return true;
                }
            }
        }
        if (host.contains(":")) {
            return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8")
                || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb");
        }
        if (host.matches("^\\d+$")) return true;
        if (host.startsWith("172.")) {
            String[] parts = host.split("\\.");
            if (parts.length > 1) {
                try {
                    int second = Integer.parseInt(parts[1]);
                    if (second >= 16 && second <= 31) return true;
                } catch (NumberFormatException ignored) {
                    return true;
                }
            }
        }
        return false;
    }
}
