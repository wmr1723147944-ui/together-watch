# 安卓 0.3.38：选集面板启动检查

## 使用

下载 `TogetherWatch-Android-0.3.38.apk`，在手机上覆盖安装，不必卸载。打开软件确认版本为 0.3.38，再播放原来出问题的影片，点击「选集换源」。这批修改仅在安卓客户端，服务器代码和 Windows 无需更新。

尚未在用户手机上复测。如果还失败，请保留错误码和版本号截图：P01 是页面地址异常，P02 是影片入口不匹配，P03 是页面脚本异常。不会显示媒体地址、账号信息或网页异常原文。

## 排查证据与修复

- 用户确认已安装 0.3.37。截图提示「选集界面未能打开」，对应打开阶段的终止分支，不等于原站集数请求超时。
- 只读检查部署中的 `/discover?picker=1`：隔离 Chromium 会话中，看剧 AI、七味网、233 动漫、茶杯狐、樱花动漫五个入口都能进入 loading；该检查只验证入口，不声称这些原站的实时目录或视频均可用。
- 旧版在 `loadUrl()` 后立即探测，未等待新文档提交。初始 `about:blank` 被返回为 untrusted，接着停止页面加载并显示笼统失败。此路径已用本地初始文档回归覆盖；尚无用户设备日志，不能断言它是手机上所有故障的唯一原因。
- 新版等待 `onPageCommitVisible` 或 `onPageFinished`，探针再次验证真实文档的 origin、readyState 和面板几何尺寸。空白初始文档只等待，不调用桥接；非可信站点仍拒绝。
- 使用文档代次忽略导航之前的迟到回调；解析后的 waiting 状态统一重试。已显示面板暂时消失时允许恢复，同时保留超时上限，避免无限空白。
- 保留 0.3.37 的视频识别 JavaScript 组装修复、当前影片目录复用、房主权限与集数身份检查。没有放宽来源校验，没有自动切换到原网页。

Android 对新文档提交和页面完成回调的说明：[WebViewClient API](https://developer.android.com/reference/android/webkit/WebViewClient#onPageCommitVisible(android.webkit.WebView,%20java.lang.String))。

## 验证

- 262 项共享 JavaScript 回归、62 项桌面 JavaScript 回归及 21 项安卓项目约束检查通过。
- 73 项安卓 JVM 回归通过；APK 编译和 lint 通过（0 错误，68 项既有警告保留）。
- Chromium 实际 DOM：初始空白页、解析中页面、打开一次、加载/成功/错误/隐藏状态；真实模板和 CSS 下看剧 AI、七味网、233 动漫的模拟目录正常呈现。
- 生产 Java 生成的视频识别脚本回归：延迟换集、过期视频、自动恢复末集、模糊集数标记。
- 尚未连接安卓真机；本地验证不等同于用户网络下的全部原站兼容性验证。

APK：versionCode 43，5,892,383 字节，SHA-256 `20228fdb70f56a6ca4b159e08d1b7a97e2aa58ab7c80eef24e2608ba83658c20`。签名与 0.3.37 一致，可覆盖安装。

## 可选：供其他用户下载更新

`TogetherWatch-Android-0.3.38-publish.zip` 包含安卓 APK 和更新索引，Windows 索引仍指向原有 0.6.25。只上传压缩包不会生效。

确认本机覆盖安装有效后，再把压缩包上传到服务器 `/home/ubuntu/`。服务器上按顺序逐行运行，某行报错就先停下：

```bash
cd /home/ubuntu/together-watch
unzip -o /home/ubuntu/TogetherWatch-Android-0.3.38-publish.zip -d /home/ubuntu/android-update-0.3.38
cp -a --backup=numbered client-releases/manifest.json client-releases/manifest.backup.json
cp /home/ubuntu/android-update-0.3.38/client-releases/TogetherWatch-Android-0.3.38.apk client-releases/
cp /home/ubuntu/android-update-0.3.38/client-releases/manifest.json client-releases/manifest.next.json
mv client-releases/manifest.next.json client-releases/manifest.json
curl -fsS https://watchtogethernow.cloud/api/client-updates/android
```

最后一行应显示 0.3.38。沿用现有挂载发布目录的部署时不必重启服务。其他手机仍需确认下载并安装，不会被远程静默替换。
