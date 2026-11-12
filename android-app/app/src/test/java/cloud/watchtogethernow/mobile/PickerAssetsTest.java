package cloud.watchtogethernow.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class PickerAssetsTest {
    private final String origin="https://watchtogethernow.cloud";
    @Test public void exactEntryAndPackagedScriptsDoNotNeedServer() {
        assertEquals("episode-picker.html",PickerAssets.asset(origin+PickerAssets.ENTRY,origin));
        assertEquals("picker/catalog-browser.js",PickerAssets.asset(origin+PickerAssets.PREFIX+"catalog-browser.js",origin));
        assertEquals("catalog-metadata-bridge.js",PickerAssets.asset(origin+PickerAssets.PREFIX+"catalog-metadata-bridge.js",origin));
        assertEquals("text/html",PickerAssets.mime("episode-picker.html"));
        assertEquals("text/css",PickerAssets.mime("episode-picker.css"));
    }
    @Test public void cannotInterceptOtherOriginsOrArbitraryFiles() {
        for(String url:new String[]{"https://www.kanju.ai"+PickerAssets.ENTRY,"http://watchtogethernow.cloud"+PickerAssets.ENTRY,
            origin+"/discover?picker=1",origin+"/api/discover/detail",origin+PickerAssets.PREFIX+"../secret",
            origin+PickerAssets.PREFIX+"%2e%2e/secret",origin+PickerAssets.PREFIX+"unknown.js",
            origin+PickerAssets.PREFIX+"catalog-browser.js?x=1",origin+PickerAssets.ENTRY+"#fragment",
            "https://user@watchtogethernow.cloud"+PickerAssets.ENTRY})assertNull(url,PickerAssets.asset(url,origin));
    }
}
