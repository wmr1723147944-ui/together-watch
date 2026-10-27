package cloud.watchtogethernow.mobile;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.view.View;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.function.DoubleSupplier;

/** Drawn inside PlayerView's overlay, so native full-screen keeps the same layer. */
@android.annotation.SuppressLint("ViewConstructor") // Created programmatically with the active player's clock.
final class DanmakuView extends View {
    private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
    private final DoubleSupplier position,aspect;
    private JSONArray items=new JSONArray();
    private boolean enabled;
    DanmakuView(Context context,DoubleSupplier position,DoubleSupplier aspect){
        super(context);this.position=position;this.aspect=aspect;
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);setClickable(false);setFocusable(false);
    }
    void update(JSONObject packet){
        enabled=packet!=null&&packet.optBoolean("enabled");items=packet==null?null:packet.optJSONArray("items");
        invalidate();
    }
    @Override protected void onDraw(Canvas canvas){
        super.onDraw(canvas);if(!enabled||items==null||items.length()==0)return;
        float width=getWidth(),height=getHeight(),left=0,top=0;
        double ratio=aspect.getAsDouble();
        if(ratio>0){if(width/height>ratio){float w=(float)(height*ratio);left=(width-w)/2;width=w;}
            else{float h=(float)(width/ratio);top=(height-h)/2;height=h;}}
        float size=Math.max(13,Math.min(22*getResources().getDisplayMetrics().scaledDensity,height/14));
        paint.setTextSize(size);paint.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        paint.setShadowLayer(3,1,1,Color.BLACK);double time=position.getAsDouble();
        canvas.save();canvas.clipRect(left,top,left+width,top+height);
        boolean active=false;
        for(int i=0;i<items.length();i++){
            JSONObject item=items.optJSONObject(i);if(item==null)continue;
            double age=time-item.optDouble("time");if(age<0||age>=8)continue;active=true;
            String text=item.optString("text");float x=left+width-(width+paint.measureText(text))*(float)(age/8);
            float y=top+8+size+item.optInt("lane")*(size+8);
            paint.setColor("room".equals(item.optString("kind"))?0xff9feaff:Color.WHITE);paint.setAlpha(217);
            canvas.drawText(text,x,y,paint);
        }
        canvas.restore();if(active)postInvalidateDelayed(32);
    }
}
