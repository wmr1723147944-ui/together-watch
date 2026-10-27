package cloud.watchtogethernow.mobile;

import android.content.Context;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Collections;

/** One local player. The room receives timing only, never its media URI. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class NativePlayerController {
    interface StatusListener { void onStatus(String message); }
    private final Context context;
    private final PlayerView view;
    private final StatusListener listener;
    private ExoPlayer player;
    private JSONArray events = new JSONArray();
    private int session;
    private long appliedCommand;
    private JSONObject pendingState;
    private String error = "";
    private final DanmakuView danmaku;

    NativePlayerController(Context context, PlayerView view, StatusListener listener) {
        this.context = context;
        this.view = view;
        this.listener = listener;
        view.setShowFastForwardButton(false);
        view.setShowRewindButton(false);
        danmaku=new DanmakuView(context,()->player==null?0:player.getCurrentPosition()/1000.0,()->{
            if(player==null || view.getResizeMode()==androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM)return 0;
            androidx.media3.common.VideoSize size=player.getVideoSize();return size.height>0?(double)size.width*size.pixelWidthHeightRatio/size.height:0;
        });
        if(view.getOverlayFrameLayout()!=null)view.getOverlayFrameLayout().addView(danmaku,new android.widget.FrameLayout.LayoutParams(-1,-1));
    }

    void open(String url, String referer, String userAgent, double initialPosition) {
        release();
        session++;
        error = "";
        appliedCommand = 0;
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
            .setUserAgent(userAgent).setConnectTimeoutMs(15000).setReadTimeoutMs(15000);
        if (!referer.isEmpty()) http.setDefaultRequestProperties(Collections.singletonMap("Referer", referer));
        player = new ExoPlayer.Builder(context)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(http)).build();
        ExoPlayer current = player;
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if (current != player) return;
                if (state == Player.STATE_READY) {
                    if (pendingState != null) apply(pendingState);
                    listener.onStatus("内置播放已就绪 · 下方可聊天和通话");
                } else if (state == Player.STATE_BUFFERING) listener.onStatus("视频缓冲中…");
            }
            @Override public void onPlayerError(PlaybackException exception) {
                if (current != player) return;
                error = "这个来源暂时无法内置播放，请点「播放方式」返回网页或换一条线路";
                listener.onStatus(error);
            }
        });
        // UI calls go through this wrapper; remote commands use ExoPlayer
        // directly. This separates user intent from asynchronous media events.
        view.setPlayer(new ForwardingPlayer(player) {
            @Override public void play() { super.play(); event("play"); }
            @Override public void pause() { super.pause(); event("pause"); }
            @Override public void setPlayWhenReady(boolean value) {
                super.setPlayWhenReady(value); event(value ? "play" : "pause");
            }
            @Override public void seekTo(long position) { super.seekTo(position); event("seek"); }
            @Override public void seekTo(int index, long position) { super.seekTo(index, position); event("seek"); }
            @Override public void setPlaybackParameters(PlaybackParameters parameters) {
                super.setPlaybackParameters(parameters); event("speed");
            }
            @Override public void setPlaybackSpeed(float speed) { super.setPlaybackSpeed(speed); event("speed"); }
        });
        player.setMediaItem(MediaItem.fromUri(url));
        if (Double.isFinite(initialPosition) && initialPosition > 0) player.seekTo((long) (initialPosition * 1000));
        player.prepare();
        // The confirmed room state decides whether to play, including on join.
        listener.onStatus("正在加载内置播放器…");
    }

    boolean isActive() { return player != null; }
    void overlay(JSONObject packet) { danmaku.update(packet); }
    void pauseLocally() {
        pendingState = null;
        events = new JSONArray();
        if (player != null) player.pause();
    }
    private void event(String type) {
        if (player == null) return;
        pendingState = null;
        if (events.length() >= 16) events = new JSONArray();
        JSONObject event = new JSONObject();
        put(event, "type", type); put(event, "time", player.getCurrentPosition() / 1000.0);
        put(event, "speed", player.getPlaybackParameters().speed);
        events.put(event);
    }

    JSONObject sample() {
        JSONObject result = new JSONObject();
        put(result, "active", player != null);
        put(result, "session", session);
        if (player == null) return result;
        put(result, "time", player.getCurrentPosition() / 1000.0);
        long duration = player.getDuration();
        put(result, "duration", duration == C.TIME_UNSET ? 0 : Math.max(0, duration) / 1000.0);
        put(result, "speed", player.getPlaybackParameters().speed);
        put(result, "playing", player.getPlayWhenReady() && player.getPlaybackState() != Player.STATE_ENDED);
        put(result, "ready", player.getPlaybackState() == Player.STATE_READY || player.getPlaybackState() == Player.STATE_ENDED);
        put(result, "seeking", pendingState != null);
        put(result, "appliedCommand", appliedCommand);
        put(result, "error", error);
        put(result, "events", events);
        events = new JSONArray();
        return result;
    }

    void apply(JSONObject command) {
        if (player == null || command.optInt("session", -1) != session) return;
        if ("volume".equals(command.optString("type"))) {
            player.setVolume((float) Math.max(0, Math.min(1, command.optDouble("value", 1))));
            return;
        }
        if (!"state".equals(command.optString("type"))) return;
        long id = command.optLong("id");
        if (id < appliedCommand) return;
        if (player.getPlaybackState() != Player.STATE_READY && player.getPlaybackState() != Player.STATE_ENDED) {
            pendingState = command;
            return;
        }
        pendingState = null;
        double speed = command.optDouble("speed", 1);
        double time = command.optDouble("time", 0);
        if (!Double.isFinite(time) || !Double.isFinite(speed) || time < 0) return;
        boolean playing = command.optBoolean("playing");
        if (playing) time += Math.max(0, Math.min(15, (System.currentTimeMillis() - command.optDouble("issuedAt", System.currentTimeMillis())) / 1000)) * speed;
        if (command.optBoolean("seek")) {
            long duration = player.getDuration();
            long position = (long) (time * 1000);
            if (duration != C.TIME_UNSET) position = Math.min(position, duration);
            player.seekTo(Math.max(0, position));
        }
        player.setPlaybackSpeed((float) Math.max(0.25, Math.min(4, speed)));
        player.setPlayWhenReady(playing);
        appliedCommand = id;
    }

    void release() {
        danmaku.update(null);
        pendingState = null;
        events = new JSONArray();
        view.setPlayer(null);
        if (player != null) { ExoPlayer previous = player; player = null; previous.release(); }
    }
    private static void put(JSONObject object, String key, Object value) {
        try { object.put(key, value); } catch (JSONException ignored) { }
    }
}
