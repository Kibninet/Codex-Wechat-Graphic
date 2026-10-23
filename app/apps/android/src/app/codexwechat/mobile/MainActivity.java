package app.codexwechat.mobile;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.provider.OpenableColumns;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class MainActivity extends Activity {
  private static final String ASSET_HOST = "app.codexwechat.local";
  private static final long MAX_FILE = 100L * 1024 * 1024;
  private static final int PICK_FILES = 41;
  private final ExecutorService worker = Executors.newFixedThreadPool(4);
  private final Map<String, SelectedFile> selections = new ConcurrentHashMap<>();
  private WebView view;
  private SharedPreferences preferences;
  private String pickerRequest;
  private String pendingPairLink;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    preferences = getSharedPreferences("connection", MODE_PRIVATE);
    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Color.rgb(245,246,242));
    view = new WebView(this);
    view.setBackgroundColor(Color.rgb(245,246,242));
    view.getSettings().setJavaScriptEnabled(true);
    view.getSettings().setDomStorageEnabled(true);
    view.getSettings().setAllowFileAccess(false);
    view.getSettings().setAllowContentAccess(false);
    view.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    view.addJavascriptInterface(new NativeApi(), "Native");
    root.addView(view, new FrameLayout.LayoutParams(-1,-1));
    root.setOnApplyWindowInsetsListener((v,insets) -> {
      if (Build.VERSION.SDK_INT >= 30) {
        android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
        v.setPadding(bars.left,bars.top,bars.right,bars.bottom);
      } else { v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom()); }
      return insets;
    });
    setContentView(root);
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    view.setWebViewClient(new WebViewClient() {
      @Override public WebResourceResponse shouldInterceptRequest(WebView web, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!ASSET_HOST.equals(uri.getHost())) return emptyResponse();
        String file = uri.getPath();
        if (file == null || file.equals("/")) file = "/index.html";
        if (!file.equals("/index.html") && !file.equals("/style.css") && !file.equals("/app.js") && !file.equals("/controls.js") && !file.equals("/render.js") && !(file.startsWith("/vendor/") && file.matches("/[A-Za-z0-9_./-]+") && !file.contains(".."))) return emptyResponse();
        try {
          String mime = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "application/javascript" : file.endsWith(".woff2") ? "font/woff2" : file.endsWith(".woff") ? "font/woff" : file.endsWith(".ttf") ? "font/ttf" : "text/html";
          return new WebResourceResponse(mime,"UTF-8",getAssets().open(file.substring(1)));
        } catch (Exception e) { return emptyResponse(); }
      }
      @Override public boolean shouldOverrideUrlLoading(WebView web, WebResourceRequest request) {
        // The JavaScript bridge exists only in our bundled frontend.
        return !ASSET_HOST.equals(request.getUrl().getHost());
      }
      @Override public void onPageFinished(WebView web, String url) {
        if (pendingPairLink != null) {
          String link = pendingPairLink; pendingPairLink = null;
          view.evaluateJavascript("window.acceptPairLink("+JSONObject.quote(link)+")",null);
        }
      }
    });
    readIntent(getIntent());
    view.loadUrl("https://"+ASSET_HOST+"/index.html");
  }
  private WebResourceResponse emptyResponse() {
    return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
  }
  @Override protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent); readIntent(intent);
    if (pendingPairLink != null) { String link=pendingPairLink; pendingPairLink=null; view.evaluateJavascript("window.acceptPairLink("+JSONObject.quote(link)+")",null); }
  }
  private void readIntent(Intent intent) {
    Uri uri=intent.getData();
    if(uri!=null && "codexwechat".equals(uri.getScheme()) && "pair".equals(uri.getHost())) pendingPairLink=uri.toString();
  }
  private void result(String id, Object data) {
    try { JSONObject out=new JSONObject();out.put("ok",true);out.put("data",data);deliver(id,out); } catch(Exception ignored){}
  }
  private void error(String id,String message,int status) {
    try { JSONObject out=new JSONObject();out.put("ok",false);out.put("error",message);out.put("status",status);deliver(id,out); } catch(Exception ignored){}
  }
  private void deliver(String id,JSONObject value) {
    runOnUiThread(()->{if(!isFinishing()) view.evaluateJavascript("window.__nativeDone("+JSONObject.quote(id)+","+value.toString()+")",null);});
  }
  private String checkedServer(String input) throws Exception {
    URL url=new URL(input);
    String host=url.getHost();
    if(host.isEmpty() || url.getUserInfo()!=null || url.getQuery()!=null || url.getRef()!=null || !(url.getPath().isEmpty()||url.getPath().equals("/"))) throw new Exception("电脑地址格式无效");
    boolean local=host.equals("localhost") || host.equals("127.0.0.1") || host.equals("[::1]") || host.matches("(?:10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|192\\.168\\.\\d{1,3}\\.\\d{1,3}|172\\.(?:1[6-9]|2[0-9]|3[01])\\.\\d{1,3}\\.\\d{1,3})");
    if(!url.getProtocol().equals("https") && !(url.getProtocol().equals("http") && local)) throw new Exception("外网连接需要 HTTPS 地址");
    return url.getProtocol()+"://"+url.getAuthority();
  }
  private SecretKey vaultKey() throws Exception {
    KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
    if(!store.containsAlias("codex-wechat-session")) {
      KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
      generator.init(new KeyGenParameterSpec.Builder("codex-wechat-session",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey();
    }
    return (SecretKey)store.getKey("codex-wechat-session",null);
  }
  private String seal(String value) throws Exception {
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,vaultKey());
    return Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
  }
  private String cookie() {
    try {
      String[] parts=preferences.getString("session","").split(":");if(parts.length!=2)return "";
      Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,vaultKey(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
      return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
    }catch(Exception ignored){return "";}
  }
  private HttpURLConnection connection(String server,String path,String method,boolean auth) throws Exception {
    if(!path.matches("^/api/(mobile/[^\\r\\n]*|auth/pair)$") || path.contains("..") || path.contains("\\")) throw new Exception("不支持这个请求");
    if(!method.equals("GET")&&!method.equals("POST"))throw new Exception("不支持这个操作");
    HttpURLConnection c=(HttpURLConnection)new URL(server+path).openConnection();
    c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(60000);c.setRequestMethod(method);c.setRequestProperty("Accept","application/json");c.setRequestProperty("Origin",server);
    if(auth)c.setRequestProperty("Cookie",cookie());
    return c;
  }
  private JSONObject response(HttpURLConnection c) throws Exception {
    int status=c.getResponseCode();
    InputStream input=status>=400?c.getErrorStream():c.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();
    if(input!=null)try(InputStream stream=input){byte[] b=new byte[8192];int n;while((n=stream.read(b))!=-1){if(bytes.size()+n>16*1024*1024)throw new Exception("返回内容过大，请切换会话后重试");bytes.write(b,0,n);}}
    JSONObject json;
    try{json=new JSONObject(bytes.toString("UTF-8"));}catch(Exception e){throw new Exception("电脑未返回有效内容，请检查连接地址");}
    if(status>=300)throw new HttpFailure(json.optString("error","请求失败"),status);
    return json;
  }
  private static final class HttpFailure extends Exception { final int status;HttpFailure(String s,int n){super(s);status=n;} }
  private static final class SelectedFile {Uri uri;String name,mime;long size;}

  public final class NativeApi {
    @JavascriptInterface public void haptic(String id,String kind) {
      runOnUiThread(()->{view.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP);result(id,new JSONObject());});
    }
    @JavascriptInterface public void openWeChat(String id) {
      runOnUiThread(()->{Intent intent=getPackageManager().getLaunchIntentForPackage("com.tencent.mm");if(intent==null){error(id,"手机尚未安装微信",0);return;}startActivity(intent);result(id,new JSONObject());});
    }
    @JavascriptInterface public void config(String id) {
      worker.execute(()->{try{JSONObject c=new JSONObject();c.put("connected",!cookie().isEmpty());c.put("server",preferences.getString("server",""));result(id,c);}catch(Exception e){error(id,"无法读取连接设置",0);}});
    }
    @JavascriptInterface public void connect(String id,String link) {
      worker.execute(()->{HttpURLConnection c=null;try{
        Uri uri=Uri.parse(link.trim());if(!"codexwechat".equals(uri.getScheme())||!"pair".equals(uri.getHost()))throw new Exception("请使用电脑生成的 Codex-Wechat 配对链接");
        String server=checkedServer(uri.getQueryParameter("server"));String code=uri.getQueryParameter("code");if(code==null||!code.matches("[A-Za-z0-9_-]{43}"))throw new Exception("配对码格式无效");
        c=connection(server,"/api/auth/pair","POST",false);c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");JSONObject body=new JSONObject();body.put("code",code);try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}response(c);
        String session=c.getHeaderField("Set-Cookie");if(session==null)throw new Exception("电脑没有返回配对凭据");session=session.split(";",2)[0];
        preferences.edit().putString("server",server).putString("session",seal(session)).apply();JSONObject ok=new JSONObject();ok.put("connected",true);result(id,ok);
      }catch(Exception e){error(id,e instanceof HttpFailure?e.getMessage():"无法连接电脑。请确认配对链接有效、电脑在线且当前网络可达。",e instanceof HttpFailure?((HttpFailure)e).status:0);}finally{if(c!=null)c.disconnect();}});
    }
    @JavascriptInterface public void request(String id,String method,String path,String body) {
      worker.execute(()->{HttpURLConnection c=null;try{
        if(cookie().isEmpty())throw new HttpFailure("请先配对电脑",401);String server=checkedServer(preferences.getString("server",""));
        if(body.length()>500000)throw new Exception("文字内容过长");c=connection(server,path,method,true);
        if(method.equals("POST")){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(body.getBytes(StandardCharsets.UTF_8));}}
        result(id,response(c));
      }catch(Exception e){error(id,e instanceof HttpFailure?e.getMessage():"连接未完成，请确认电脑在线后重试",e instanceof HttpFailure?((HttpFailure)e).status:0);}finally{if(c!=null)c.disconnect();}});
    }
    @JavascriptInterface public void pickFiles(String id) {
      runOnUiThread(()->{if(pickerRequest!=null){error(id,"文件选择器已打开",0);return;}pickerRequest=id;Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT);pick.addCategory(Intent.CATEGORY_OPENABLE);pick.setType("*/*");pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);pick.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);try{startActivityForResult(pick,PICK_FILES);}catch(Exception e){pickerRequest=null;error(id,"无法打开系统文件选择器",0);}});
    }
    @JavascriptInterface public void upload(String id,String fileId) {
      worker.execute(()->{HttpURLConnection c=null;try{SelectedFile f=selections.get(fileId);if(f==null)throw new Exception("请重新选择这个文件");if(f.size>MAX_FILE)throw new Exception("文件超过 100 MiB");
        c=connection(checkedServer(preferences.getString("server","")),"/api/mobile/files?name="+URLEncoder.encode(f.name,"UTF-8"),"POST",true);c.setReadTimeout(300000);c.setDoOutput(true);c.setRequestProperty("Content-Type",f.mime);if(f.size>=0)c.setFixedLengthStreamingMode(f.size);else c.setChunkedStreamingMode(65536);
        try(InputStream input=getContentResolver().openInputStream(f.uri);OutputStream out=c.getOutputStream()){if(input==null)throw new Exception("无法读取文件");byte[] buffer=new byte[65536];int n;long size=0;while((n=input.read(buffer))!=-1){size+=n;if(size>MAX_FILE)throw new Exception("文件超过 100 MiB");out.write(buffer,0,n);}}
        JSONObject result=response(c);selections.remove(fileId);result(id,result);
      }catch(Exception e){error(id,e instanceof HttpFailure?e.getMessage():"文件上传失败，文字和其他附件仍保留，请重新选择文件",e instanceof HttpFailure?((HttpFailure)e).status:0);}finally{if(c!=null)c.disconnect();}});
    }
  }
  @Override protected void onActivityResult(int request,int status,Intent data) {
    super.onActivityResult(request,status,data);if(request!=PICK_FILES)return;String callback=pickerRequest;pickerRequest=null;if(callback==null)return;
    try{JSONArray files=new JSONArray();if(status==RESULT_OK&&data!=null){int count=data.getClipData()!=null?data.getClipData().getItemCount():data.getData()!=null?1:0;
      for(int i=0;i<Math.min(count,20);i++){Uri uri=data.getClipData()!=null?data.getClipData().getItemAt(i).getUri():data.getData();SelectedFile f=new SelectedFile();f.uri=uri;f.name="attachment";f.size=-1;f.mime=getContentResolver().getType(uri);if(f.mime==null)f.mime="application/octet-stream";
        try(Cursor cursor=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE},null,null,null)){if(cursor!=null&&cursor.moveToFirst()){int name=cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME),size=cursor.getColumnIndex(OpenableColumns.SIZE);if(name>=0)f.name=cursor.getString(name);if(size>=0&&!cursor.isNull(size))f.size=cursor.getLong(size);}}
        String id=UUID.randomUUID().toString();selections.put(id,f);JSONObject info=new JSONObject();info.put("id",id);info.put("name",f.name);info.put("size",f.size);files.put(info);
      }}result(callback,files);
    }catch(Exception e){error(callback,"未能读取所选文件，请重新选择",0);}
  }
  @Override public void onBackPressed(){view.evaluateJavascript("(function(){var dialogs=document.querySelectorAll('dialog[open]');if(dialogs.length){dialogs[dialogs.length-1].close();return true;}var drawer=document.getElementById('drawer');if(!drawer.hidden){drawer.hidden=true;document.getElementById('drawer-shade').hidden=true;return true;}return false;})()",handled->{if(!"true".equals(handled))moveTaskToBack(true);});}
  @Override protected void onDestroy(){worker.shutdownNow();if(view!=null){view.removeJavascriptInterface("Native");view.destroy();}super.onDestroy();}
}
