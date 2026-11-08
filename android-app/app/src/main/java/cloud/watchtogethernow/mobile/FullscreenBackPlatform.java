package cloud.watchtogethernow.mobile;

import android.app.Activity;
import android.os.Build;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import androidx.annotation.RequiresApi;

final class FullscreenBackPlatform {
    private FullscreenBackPlatform(){}
    static FullscreenBackGuard.Registration create(Activity activity) {
        if(Build.VERSION.SDK_INT>=33)return new Api33(activity);
        // Older devices already route buttons and edge gestures through AndroidX.
        return new FullscreenBackGuard.Registration(){
            public void register(Runnable back){}
            public void unregister(){}
        };
    }
    @RequiresApi(33)
    private static final class Api33 implements FullscreenBackGuard.Registration {
        private final OnBackInvokedDispatcher dispatcher;
        private OnBackInvokedCallback callback;
        Api33(Activity activity){dispatcher=activity.getOnBackInvokedDispatcher();}
        public void register(Runnable back) {
            callback=back::run;
            // The video is an activity overlay, above the retained WebViews.
            dispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_OVERLAY,callback);
        }
        public void unregister() {
            if(callback!=null)dispatcher.unregisterOnBackInvokedCallback(callback);
            callback=null;
        }
    }
}
