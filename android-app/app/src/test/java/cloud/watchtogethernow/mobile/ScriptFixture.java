package cloud.watchtogethernow.mobile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/** Used by Chromium tests: execute the production Java builder, not a JS reimplementation. */
public final class ScriptFixture {
    private static String read(Path path) throws Exception {return new String(Files.readAllBytes(path),StandardCharsets.UTF_8);}
    public static void main(String[] args) throws Exception {
        Path root=Path.of(args[0]);
        String adapters=read(root.resolve("static/js/catalog-adapters.js"));
        String guard=read(root.resolve("android-app/app/src/main/assets/episode-media-guard.js"));
        String scan=read(root.resolve("android-app/app/src/main/assets/media-discovery.js"));
        String generated=WebPlayerScripts.mediaScan(adapters,guard,scan,args[1]);
        System.out.print(Base64.getEncoder().encodeToString(generated.getBytes(StandardCharsets.UTF_8)));
    }
}
