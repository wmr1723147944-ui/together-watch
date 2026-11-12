package cloud.watchtogethernow.mobile;

import org.json.JSONTokener;

/** A requested URL is not proof that WebView has committed that document. */
final class PickerDocumentState {
    private int navigation;
    private boolean committed;
    void start(){navigation++;committed=false;}
    void commit(){committed=true;}
    boolean canProbe(){return committed;}
    int token(){return navigation;}
    boolean accepts(int token){return committed && token==navigation;}

    static String state(String raw) {
        try {Object value=new JSONTokener(raw).nextValue();return value instanceof String?(String)value:"waiting";}
        catch(Exception ignored){return "waiting";}
    }
    static String failure(String state) {
        if("untrusted".equals(state))return "选集页面地址异常（P01）。请关闭后重试；未切换当前影片。";
        if("unsupported".equals(state))return "当前影片的选集入口不匹配（P02）。请重新从搜索结果进入这部影片。";
        String code=state!=null && state.matches("error-(TypeError|ReferenceError|SyntaxError)")?"P03-"+state.substring(6):"P03";
        return "选集页面脚本未能运行（"+code+"）。请将此提示截图反馈；可关闭面板继续观看。";
    }
}
