package cloud.watchtogethernow.mobile;

/** The room surface may only reveal the current room after its bridge is ready. */
final class RoomPageLoad {
    enum Phase { CLOSED, BOOTSTRAP, ROOM, READY, FAILED }
    private Phase phase=Phase.CLOSED;
    private int epoch,document;
    private long deadline;
    private String bootstrap="",target="";
    int begin(String bootstrap,String target,long now) {
        this.bootstrap=bootstrap;this.target=target;phase=Phase.BOOTSTRAP;
        document++;deadline=now+15000;return ++epoch;
    }
    void close(){epoch++;document++;phase=Phase.CLOSED;}
    int epoch(){return epoch;}
    int document(){return document;}
    Phase phase(){return phase;}
    boolean current(int value){return epoch==value && phase!=Phase.CLOSED && phase!=Phase.FAILED;}
    boolean accepts(int value,int doc){return current(value) && document==doc;}
    boolean expected(String url){return (phase==Phase.BOOTSTRAP?bootstrap:target).equals(url);}
    boolean started(String url,long now){
        if(phase==Phase.CLOSED || phase==Phase.FAILED)return false;
        if(!expected(url)){fail();return false;}
        document++;
        if(phase==Phase.READY){phase=Phase.ROOM;deadline=now+20000;}
        return true;
    }
    boolean initialized(int value,int doc,long now){
        if(!accepts(value,doc) || phase!=Phase.BOOTSTRAP)return false;
        phase=Phase.ROOM;document++;deadline=now+20000;return true;
    }
    boolean ready(int value,int doc){
        if(!accepts(value,doc) || phase!=Phase.ROOM)return false;
        phase=Phase.READY;return true;
    }
    boolean timedOut(long now){
        if((phase==Phase.BOOTSTRAP || phase==Phase.ROOM) && now>=deadline){fail();return true;}
        return false;
    }
    void resume(long now){if(phase==Phase.BOOTSTRAP || phase==Phase.ROOM){document++;deadline=now+20000;}}
    void fail(){if(phase!=Phase.CLOSED){phase=Phase.FAILED;document++;}}
}
