package cloud.watchtogethernow.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class WebPlayerScriptsTest {
    @Test public void installerIsCompiledCodeWithFrameLocalGlobals() {
        String agent="window.__twDesktopPlayer={sample:()=>document.title};";
        String script=WebPlayerScripts.sample("/* wrapper */",agent);
        assertTrue(script.contains("sample(function(target){"));
        assertTrue(script.contains("const window=target,document=target.document;"));
        assertTrue(script.contains(agent));
        assertFalse(script.contains(".eval("));
        assertFalse(script.contains("new Function"));
    }

    @Test public void diagnosticsAreFixedMessagesNotPageControlledText() {
        assertTrue(WebPlayerScripts.diagnostic("cross_origin_frame").contains("跨域"));
        assertTrue(WebPlayerScripts.diagnostic("adapter_error").contains("适配"));
        assertTrue(WebPlayerScripts.diagnostic("no_video").contains("未找到"));
        assertFalse(WebPlayerScripts.diagnostic("secret-account-data").contains("secret"));
    }
}
