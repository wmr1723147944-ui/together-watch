package cloud.watchtogethernow.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.Toast;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BooleanSupplier;

final class ClientUpdateController {
    private final Activity activity;
    private final String origin;
    private final BooleanSupplier watching,foreground;
    private final SharedPreferences preferences;
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private volatile HttpURLConnection connection;
    private boolean closed,busy,prompt;
    private long checkedAt;
    private ClientUpdatePolicy.Result result;
    private AlertDialog dialog;
    ClientUpdateController(Activity activity,String origin,BooleanSupplier watching,BooleanSupplier foreground) {
        this.activity=activity;this.origin=origin;this.watching=watching;this.foreground=foreground;
        preferences=activity.getSharedPreferences("client_updates",Activity.MODE_PRIVATE);
    }
    boolean hasUpdate(){return result!=null && "available".equals(result.state);}
    void check(boolean manual) {
        if(closed || busy || prompt)return;
        if(!manual && System.currentTimeMillis()-checkedAt<6*60*60*1000L){notifyResult(false);return;}
        busy=true;checkedAt=System.currentTimeMillis();
        if(manual)Toast.makeText(activity,"正在检查更新…",Toast.LENGTH_SHORT).show();
        executor.execute(()->{
            ClientUpdatePolicy.Result found;
            try {
                HttpURLConnection request=(HttpURLConnection)new URL(origin+"/api/client-updates/android").openConnection();connection=request;
                request.setInstanceFollowRedirects(false);request.setConnectTimeout(7000);request.setReadTimeout(7000);
                request.setUseCaches(false);request.setRequestProperty("Accept","application/json");
                request.setRequestProperty("User-Agent","TogetherWatchAndroid/"+BuildConfig.VERSION_NAME);
                if(request.getResponseCode()!=200)throw new IllegalStateException("unavailable");
                try(InputStream input=request.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()) {
                    byte[] buffer=new byte[2048];int count;long deadline=System.currentTimeMillis()+10000;
                    while((count=input.read(buffer))!=-1){if(output.size()+count>32768 || System.currentTimeMillis()>deadline)throw new IllegalStateException("size/timeout");output.write(buffer,0,count);}
                    found=ClientUpdatePolicy.parse(new String(output.toByteArray(),StandardCharsets.UTF_8),BuildConfig.VERSION_NAME,BuildConfig.VERSION_CODE);
                }
            } catch(Exception error){found=new ClientUpdatePolicy.Result("offline","","");}
            finally {HttpURLConnection old=connection;connection=null;if(old!=null)old.disconnect();}
            final ClientUpdatePolicy.Result ready=found;
            activity.runOnUiThread(()->{busy=false;if(closed)return;result=ready;notifyResult(manual);});
        });
    }
    private void notifyResult(boolean manual) {
        if(closed || prompt || !foreground.getAsBoolean() || activity.isFinishing() || activity.isDestroyed()
            || !ClientUpdatePolicy.mayNotify(result,manual,watching.getAsBoolean(),preferences.getString("snooze_version",""),preferences.getLong("snooze_until",0),System.currentTimeMillis()))return;
        if(!hasUpdate()) {
            if(manual)Toast.makeText(activity,"current".equals(result.state)?"当前已是最新版本 · "+BuildConfig.VERSION_NAME:
                "unpublished".equals(result.state)?"服务器尚未发布安装包，可以继续使用当前版本":"暂时无法检查更新，可以继续观看，稍后重试",Toast.LENGTH_LONG).show();
            return;
        }
        prompt=true;
        dialog=new AlertDialog.Builder(activity).setTitle("一起看 "+result.version+" 可以下载了")
            .setMessage(result.notes+"\n\n不会自动安装或退出房间。建议看完后下载，并按系统提示覆盖安装；不要先卸载，以免丢失本机历史。")
            .setPositiveButton("打开下载页",(d,w)->{
                snooze();
                try {activity.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(origin+"/downloads")).addCategory(Intent.CATEGORY_BROWSABLE));}
                catch(Exception error){Toast.makeText(activity,"未找到浏览器，请稍后再试",Toast.LENGTH_LONG).show();}
            }).setNegativeButton("稍后提醒",(d,w)->snooze()).create();
        dialog.setOnCancelListener(d->snooze());dialog.setOnDismissListener(d->{prompt=false;dialog=null;});dialog.show();
    }
    private void snooze(){preferences.edit().putString("snooze_version",result.version).putLong("snooze_until",System.currentTimeMillis()+24*60*60*1000L).apply();}
    void close(){closed=true;if(dialog!=null)dialog.dismiss();HttpURLConnection old=connection;if(old!=null)old.disconnect();executor.shutdownNow();}
}
