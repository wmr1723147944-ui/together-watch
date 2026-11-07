package cloud.watchtogethernow.mobile;

/** One finger, one locked direction. Seeking is only committed on release. */
final class PlayerSwipe {
    static final int NONE=0, SEEK=1, VOLUME=2, BRIGHTNESS=3, NOT_SEEKABLE=4;
    int mode, session;
    boolean armed;
    double target, value, startTime, duration, startVolume, startBrightness;
    private double x, y, width, height, threshold;
    private boolean seekable;

    boolean begin(int session, double x, double y, double width, double height, double threshold,
                  double time, double duration, boolean seekable, double volume, double brightness) {
        reset();
        for(double n:new double[]{x,y,width,height,threshold,time,duration,volume,brightness})
            if(!Double.isFinite(n))return false;
        if(width<=0 || height<=0 || x<0 || x>width || y<0 || y>height || threshold<=0)return false;
        this.session=session;this.x=x;this.y=y;this.width=width;this.height=height;this.threshold=threshold;
        this.startTime=Math.max(0,time);this.duration=Math.max(0,duration);
        this.seekable=seekable && duration>0;
        startVolume=clamp(volume,0,1);startBrightness=clamp(brightness,.05,1);
        target=startTime;armed=true;return true;
    }
    int move(double currentX,double currentY) {
        if(!armed || !Double.isFinite(currentX) || !Double.isFinite(currentY))return mode;
        double dx=currentX-x,dy=currentY-y;
        if(mode==NONE) {
            if(Math.max(Math.abs(dx),Math.abs(dy))<threshold)return NONE;
            if(Math.abs(dx)>Math.abs(dy)*1.2)mode=seekable?SEEK:NOT_SEEKABLE;
            else if(Math.abs(dy)>Math.abs(dx)*1.2)mode=x<width/2?VOLUME:BRIGHTNESS;
            else return NONE; // Wait for a clear direction rather than guessing diagonals.
        }
        if(mode==SEEK)target=clamp(startTime+dx/width*Math.min(duration,120),0,duration);
        else if(mode==VOLUME)value=clamp(startVolume-dy/(height*.7),0,1);
        else if(mode==BRIGHTNESS)value=clamp(startBrightness-dy/(height*.7),.05,1);
        return mode;
    }
    double seekOnRelease(int currentSession,boolean commit) {
        double result=armed && mode==SEEK && session==currentSession && commit?target:Double.NaN;
        reset();return result;
    }
    void reset(){armed=false;mode=NONE;}
    static double clamp(double value,double min,double max){return Math.max(min,Math.min(max,value));}
}
