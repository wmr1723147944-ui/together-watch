package cloud.watchtogethernow.mobile;

/** Registers only while the fullscreen overlay is foregrounded. No player or room mutations. */
final class FullscreenBackGuard {
    interface Registration { void register(Runnable back); void unregister(); }
    private final Registration registration;
    private final Runnable exitFullscreen;
    private boolean active;
    private int generation;
    FullscreenBackGuard(Registration registration,Runnable exitFullscreen) {
        this.registration=registration;this.exitFullscreen=exitFullscreen;
    }
    void update(boolean fullscreen,boolean foreground) {
        boolean next=fullscreen && foreground;
        if(next==active)return;
        active=next;final int epoch=++generation;
        if(active)registration.register(()->{if(active && epoch==generation)exitFullscreen.run();});
        else registration.unregister();
    }
    void close(){update(false,false);}
}
