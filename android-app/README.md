# 一起看 Android 测试版

0.2 测试版加入 Media3 内置播放器：能直接播放的来源在手机本地加载，暂不兼容的页面继续网页播放。视频、聊天和通话可以同屏使用，不需要拖书签或安装浏览器插件。详细试播步骤和限制见 [内置播放器说明](NATIVE_PLAYER.md)。

## 当前功能

- 输入昵称、房间号或邀请链接；房间号留空会新建房间
- 粘贴视频播放页，或从其他应用通过“分享”发送网页链接
- 在本机识别网页媒体候选，使用内置播放器或保留网页同步助手
- 内置播放、暂停、拖动进度和倍速接入房间协议
- 竖屏上下分区、横屏左右分区，也可以全屏视频或只看房间
- 视频与通话音量分开调整；只影响自己的设备
- 房间页继续使用现有聊天、音量与 WebRTC 语音功能
- 支持 HTML5 视频全屏和横屏
- 仅接受公开 HTTPS 入口，过滤本机和常见私有 IP 地址；不作为网络隔离沙箱使用
- 视频网页不获得任何 Android JavaScript 原生桥接接口
- 麦克风权限只会授予 `watchtogethernow.cloud` 房间页

## 获取测试 APK

新版 APP 需要网站先部署 `/mobile-room/<房间号>` 和对应脚本。仅安装 APK、不更新网站，无法完成内置播放同步。完整顺序见 [部署与试播](NATIVE_PLAYER.md)。

推送到 `main` 后，GitHub Actions 的 `android-apk` 任务会自动构建：

1. 打开仓库的 **Actions**。
2. 进入最新的 **android-apk** 任务。
3. 在页面底部下载 `together-watch-android-debug`。
4. 解压后得到 `app-debug.apk`，发送到安卓手机安装。

测试 APK 使用 GitHub 临时调试签名。不同构建之间可能需要先卸载旧测试版再安装；正式发布前必须改为长期保存的正式签名密钥。

## 本地构建

需要 JDK 17、Android SDK 36 和 Gradle 8.13：

```bash
gradle -p android-app :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
```

APK 输出路径：

```text
android-app/app/build/outputs/apk/debug/app-debug.apk
```

## 测试步骤

1. 两部安卓手机安装同一版 APP，使用不同昵称。
2. 第一部点“选择开放短片试播”，选 Sintel；房间号留空并开始。
3. 点“邀请朋友”，另一部粘贴该邀请到房间号处，并选择相同试播片。
4. 两边就绪后测试暂停、播放、拖到 30 秒和改倍速，观察另一边是否跟随。
5. 在下方聊天发送消息，双方点“加入语音”并授权麦克风，建议戴耳机。
6. 一部退到后台再回来，检查它能否追上仍在播放的另一部。

## 已知限制

- 内置播放支持设备能够解码的 MP4/WebM、HLS/DASH；不保证任意网页、DRM、强制官方 APP、禁止 WebView 或特殊跨域播放器可用。
- 助手脚本由 `https://watchtogethernow.cloud/static/js/bookmarklet.js` 动态下载，因此网站部署版本必须包含 `TogetherWatchBookmarklet.start()`。
- 若服务端未配置 TURN，严格 NAT、校园网或公司网下语音可能无法连接；安装 APP 本身不会解决这一点。
- 识别出的媒体链接只在当前手机会话内使用，不发给房间或其他成员。登录 Cookie 和 Authorization 不会从网页复制到内置播放器；每位用户必须自行登录并拥有观看权限。
- 还没有影视搜索、规则导入、自动选集、离线下载或后台播放；这不是完整的 Kazumi 替代品。
- 公开分发或商用前仍需完成 APP 备案、隐私合规、正式签名、图标和应用商店材料。
