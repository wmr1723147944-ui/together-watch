package cloud.watchtogethernow.mobile;

import android.net.Uri;
import java.net.URI;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class UrlPolicy {
    private static final Pattern HTTPS_IN_TEXT = Pattern.compile("https://\\S+", Pattern.CASE_INSENSITIVE);

    private UrlPolicy() {}

    static String normalizeHttpsUrl(String rawValue) {
        String value = rawValue == null ? "" : rawValue.trim();
        if (value.isEmpty()) return "";
        if (!value.contains("://")) value = "https://" + value;
        try {
            URI strict = new URI(value);
            if (strict.getHost() == null || strict.getUserInfo() != null
                || strict.getPort() > 65535 || strict.getPort() < -1) return "";
        } catch (Exception ignored) { return ""; }

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
        return RoomInvite.parse(rawValue, serverHost);
    }

    static boolean isTrustedServerUrl(String rawValue, String serverHost) {
        Uri uri = Uri.parse(rawValue == null ? "" : rawValue);
        return "https".equalsIgnoreCase(uri.getScheme())
            && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443)
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
