# 一起看 Android 测试版

这是现有 Together Watch 网站的安卓 MVP。它不解析、代理或转播视频，只把现有播放状态同步助手自动注入用户主动打开的 HTTPS 视频网页。

## 当前功能

- 输入昵称、房间号或邀请链接
- 粘贴视频播放页，或从其他应用通过“分享”发送网页链接
- 在 APP 内打开视频并自动启动同步助手
- “视频”和“房间/通话”双标签常驻，切换时不会主动关闭另一页
- 房间页继续使用现有聊天、音量与 WebRTC 语音功能
- 支持 HTML5 视频全屏和横屏
- 仅允许 HTTPS，拒绝 localhost、局域网和保留地址
- 视频网页不获得任何 Android JavaScript 原生桥接接口
- 麦克风权限只会授予 `watchtogethernow.cloud` 房间页

## 获取测试 APK

推送到 `main` 后，GitHub Actions 的 `android-apk` 任务会自动构建：

1. 打开仓库的 **Actions**。
2. 进入最新的 **android-apk** 任务。
3. 在页面底部下载 `together-watch-android-debug`。
4. 解压后得到 `app-debug.apk`，发送到安卓手机安装。

测试 APK 使用 GitHub 临时调试签名。不同构建之间可能需要先卸载旧测试版再安装；正式发布前必须改为长期保存的正式签名密钥。

## 本地构建

需要 JDK 17、Android SDK 36 和 Gradle 8.13：

```bash
gradle -p android-app :app:assembleDebug
```

APK 输出路径：

```text
android-app/app/build/outputs/apk/debug/app-debug.apk
```

## 测试步骤

1. 安装 APK，填写与电脑端相同的房间号。
2. 两部手机分别打开同一集视频页面。
3. 页面侧栏出现“播放器与房间已连接”后，一方播放、暂停或拖动进度。
4. 检查另一方是否在 1–3 秒内同步。
5. 点击“房间/通话”，双方允许麦克风并加入语音。

## 已知限制

- 第一版面向普通 HTML5 视频页面，不保证 DRM、强制官方 APP、禁止 WebView 或特殊跨域播放器可用。
- 助手脚本由 `https://watchtogethernow.cloud/static/js/bookmarklet.js` 动态下载，因此网站部署版本必须包含 `TogetherWatchBookmarklet.start()`。
- 当前线上未配置 TURN；严格 NAT、校园网或公司网下语音可能无法连接。
- APP 不读取或分享账号、Cookie、Token、密码和媒体地址；每位用户必须自行登录并拥有观看权限。
- 公开分发或商用前仍需完成 APP 备案、隐私合规、正式签名、图标和应用商店材料。
