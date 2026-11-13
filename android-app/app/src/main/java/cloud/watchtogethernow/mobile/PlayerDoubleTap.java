package cloud.watchtogethernow.mobile;

/** Recognize two completed taps, never a swipe, hold or tap across episodes. */
final class PlayerDoubleTap {
    private long previousUp=-1;
    private int previousSession;
    private float previousX,previousY;
    void reset(){previousUp=-1;}
    boolean tap(int session,long down,long up,float x,float y,long timeout,float distance){
        if(down<0 || up<down || up-down>timeout || timeout<=0 || distance<=0 || !Float.isFinite(x) || !Float.isFinite(y)){
            reset();return false;
        }
        boolean paired=previousUp>=0 && previousSession==session && down>=previousUp && down-previousUp<=timeout
            && Math.hypot(x-previousX,y-previousY)<=distance;
        if(paired){reset();return true;}
        previousUp=up;previousSession=session;previousX=x;previousY=y;return false;
    }
}
