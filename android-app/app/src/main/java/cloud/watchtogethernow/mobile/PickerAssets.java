package cloud.watchtogethernow.mobile;

import java.net.URI;

/** Fixed APK resources in this drawer only. Never a general file/URL proxy. */
final class PickerAssets {
    static final String ENTRY="/discover?picker=1&native=1";
    static final String PREFIX="/static/android-picker/";
    static String asset(String url,String origin) {
        try {
            URI uri=new URI(url);
            if(!origin.equals(uri.getScheme()+"://"+uri.getRawAuthority()) || uri.getUserInfo()!=null || uri.getRawFragment()!=null)return null;
            if((origin+ENTRY).equals(url))return "episode-picker.html";
            if(uri.getRawQuery()!=null)return null;
            String path=uri.getRawPath();
            if(!path.startsWith(PREFIX))return null;
            String name=path.substring(PREFIX.length());
            switch(name) {
                case "episode-picker.css":case "episode-picker-boot.js":case "catalog-metadata-bridge.js":return name;
                case "catalog-adapters.js":case "watch-history.js":case "source-discovery.js":case "catalog-browser.js":return "picker/"+name;
                default:return null;
            }
        }catch(Exception ignored){return null;}
    }
    static String mime(String name){return name.endsWith(".html")?"text/html":name.endsWith(".css")?"text/css":"application/javascript";}
}
