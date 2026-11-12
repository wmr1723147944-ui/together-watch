# 安卓 0.3.39：把选集面板放回 APP 内

## 先在手机确认

下载 `TogetherWatch-Android-0.3.39.apk` 并覆盖安装，不卸载旧版。确认版本为 0.3.39，重新打开原来出问题的看剧 AI 影片，点击「选集换源」。

这次无需更新服务器代码，Windows 仍为 0.6.25。尚未取得用户手机上的复测结果，不把本地回归等同于真机问题已解决。

## 这次的证据与改动

用户确认 0.3.38 仍一直显示「正在打开选集面板」。截图停在软件自有面板启动阶段，并不能证明看剧 AI 没有集数。旧流程每次打开一个新的 WebView，再下载服务器 `/discover?picker=1` 和首页的多份脚本；即使目录已经缓存在手机上，也必须先等这个页面可用。

0.3.39 不再让这一入口依赖服务器首页：

- APK 携带专用选集 HTML/CSS 和同一份来源校验、目录及换源脚本。只在选集 WebView 中，将固定的 HTTPS 页面和资源路径映射到 APK 文件；缺失资源明确失败，不退回服务器旧页面。
- 既有元数据桥接、已读取目录缓存和当前播放页读取逻辑不变。看剧 AI、七味网、233 动漫的本机目录请求照常沿用手机上的验证状态；茶杯狐、樱花动漫读取新目录仍可能需要服务器接口。
- 加载提示放在面板顶部，不再用整块不透明视图盖住 WebView。网页内的选集区域不再重复创建第二层 HTML 模态窗口，因为外层已经是安卓原生抽屉。
- 保留集数筛选、当前集标记、下一集、明确选择后换源、重试及关闭。失败不会自动选中别的集数，也不会自动跳到有广告的原网页。
- 没有重新加入已移除的低端影视、风车动漫、华人影院；没有读取任意本地文件、开放 JavaScript 原生对象或降低 HTTPS 检查。

原生时钟按代码应能结束等待，但用户报告仍一直等待，目前没有设备日志，不能断言唯一原因。此次移除了已确认存在的远程 UI 依赖，同时避免内容被加载层完全遮挡。网络不可用时能打开面板，不代表能凭空获取尚未读过的集数或播放失效的资源。

参考的原生资源拦截接口：[Android WebViewClient.shouldInterceptRequest](https://developer.android.com/reference/android/webkit/WebViewClient#shouldInterceptRequest(android.webkit.WebView,%20android.webkit.WebResourceRequest))。

## 验证范围

- 75 项安卓 JVM 测试、262 项共享 JavaScript 测试、62 项桌面 JavaScript 测试、21 项安卓项目约束检查通过。
- APK 编译和 lint 通过：0 错误，68 项既有警告。
- 对最终 APK 解包后的真实资源执行 Chromium 回归，而不只测试源码：五个来源的模拟目录、当前集/下一集/关闭、横竖屏布局正常；看剧 AI、七味网和 233 的模拟本机目录在服务器请求全部返回 503 时仍可显示。
- 换源回归：同名影片从看剧 AI 切换到七味网，显示的是七味网的公共集数链接；未点击集数前不启动播放。
- 原站返回不可用时显示重试和手动验证操作；选集 UI 不再请求服务器首页或远程脚本。原生 URL 映射拒绝其他域名、任意文件、路径穿越和额外查询参数。
- 保留生产 Java 生成脚本的切集/视频识别回归。没有安卓真机或用户的原站会话，所以不声称完成真机或所有在线资源验证。

APK：versionCode 44，5,823,799 字节。SHA-256：`c83bf3bbb5392869b926f6a8fbf9491c36e8d54a2b94047294be332d46c5800a`。与 0.3.38 签名相同，可覆盖安装。

## 可选：确认有效后再提供给其他设备

发布包 `TogetherWatch-Android-0.3.39-publish.zip` 仅含安卓 APK 与更新索引，Windows 索引仍为已有的 0.6.25。上传 ZIP 本身不代表发布成功。

将 ZIP 上传 `/home/ubuntu/` 后，在服务器按顺序逐行执行；某行报错先停下：

```bash
cd /home/ubuntu/together-watch
unzip -o /home/ubuntu/TogetherWatch-Android-0.3.39-publish.zip -d /home/ubuntu/android-update-0.3.39
cp -a --backup=numbered client-releases/manifest.json client-releases/manifest.backup.json
cp /home/ubuntu/android-update-0.3.39/client-releases/TogetherWatch-Android-0.3.39.apk client-releases/
cp /home/ubuntu/android-update-0.3.39/client-releases/manifest.json client-releases/manifest.next.json
mv client-releases/manifest.next.json client-releases/manifest.json
curl -fsS https://watchtogethernow.cloud/api/client-updates/android
```

最后一行应显示 0.3.39。现有发布目录挂载正确时不需要重启服务；其他手机仍需确认下载并安装更新。
