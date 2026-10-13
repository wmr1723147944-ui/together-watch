# 内置播放器：部署与试播

## 先更新网站，再装 APP

新版 APP 的下半屏使用 `/mobile-room/<房间号>`。只有 APK、没有新版网站，会显示“服务器尚未更新”或一直等房间。

代码经你确认发布到 GitHub 后，在服务器执行：

```bash
cd ~/together-watch
git pull --ff-only
sudo docker compose --env-file .env.server up -d --build app
sudo docker compose --env-file .env.server ps
```

这些命令不会替换 `.env.server`。先确认拉取成功，再构建；GitHub 网络报错时不要重新覆盖配置。APK 的 GitHub Actions 下载方式见 [README](README.md)。

## 先用同一段公开影片试播

两个预置样例来自 W3C 的公开媒体目录，2026-10-12 检查响应头均为 HTTP 200。这不等于所有地区、运营商和手机都已实测。

- [Sintel 预告片](https://media.w3.org/2010/05/sintel/trailer.mp4)
- [Big Buck Bunny 预告片](https://media.w3.org/2010/05/bunny/trailer.mp4)

两部手机进入同一房间、选择同一段预告片。依次测试播放、暂停、拖动、倍速、聊天、语音和退到后台再返回。内置播放只有确认房间状态后才启动，不会在刚进房时把 0 秒进度发给朋友。

邀请链接目前只带房间，不分享识别出的媒体地址；另一位成员也要选同一段影片。

## 再换成自己的播放页

把播放页粘贴到 APP，或者从其他应用通过“分享”发送链接。

“播放方式”里列出当前网页识别到的媒体候选。没有找到、返回 403 或提示无法播放，就选回网页模式。选集也暂时回原网页完成，双方都要选择同一集、同一版本。

勾选自动切换时，只有同一个可见、正在播放、时长至少两分钟的视频连续被识别两次，才会自动尝试内置播放。网络请求里的候选仍需手选，避免见到一条广告地址就抢走播放器。这个条件只能降低误选，不能保证识别的一定是正片。

## 能做什么，不能做什么

- 视频、聊天和通话同屏；竖屏上下布局，横屏左右布局。
- 内置播放可以在本机直接调进度和倍速，不是把屏幕截图“映射”进来。
- 0.2.1 修正内置播放器全屏：独立覆盖整个窗口、自动横屏并隐藏工具栏和系统栏；返回键恢复原布局。全屏控制条可切换完整画面与铺满裁边，不拉伸画面。影片与屏幕比例不同或影片本身带黑边时，完整模式仍可能留边。
- 兼容设备能解码的 MP4 / M4V / WebM、HLS / DASH。来源链接、网络和编码都会影响实际结果。
- 常见会员平台默认保留网页模式，每个人仍要自行登录。检测到 DRM 的页面不提供内置候选，没有破解会员或 DRM 的流程。
- 不复制网页登录 Cookie 或 Authorization。需要它们才能访问的媒体可能在内置播放器报错，应回原网页。
- 候选媒体地址保留在手机当前会话内，不上传房间；用户自己填写的页面地址会记在本机以便下次打开。
- `blob:`、特殊签名、跨域框架、禁止 WebView 等都可能不兼容。网页同步助手也并非支持任意网站。
- 不转发正片给其他人；当前没有影视搜索、站点规则导入、自动下一集、离线下载、后台持续播放或 iOS 客户端。
- 严格 NAT 网络下的语音仍可能需要服务端 TURN。换成 APP 不能代替 TURN 配置。

## 构建和测试

使用 JDK 17、Gradle 8.13、Android SDK 36 和 Build Tools 36.0.0。Windows 上建议把工具、Gradle 缓存和构建用的项目副本放在纯英文路径。本次本地构建使用临时英文路径中的安卓项目副本；原项目仍保留在原位置。仅跳过 Android 的路径检查，不能解决所有中文路径下的原生工具加载问题。

```bash
gradle -p android-app :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
python -m unittest discover -s tests -v
node --test tests/frontend.test.cjs tests/native-player.test.cjs
```

APK 输出：`android-app/app/build/outputs/apk/debug/app-debug.apk`。

自动测试验证同步协议、旧消息处理、断线重连、缓冲恢复、音量隔离和候选识别逻辑，不代替两台手机的解码、触摸、麦克风及真实网络测试。

## 参考实现

参考 [Kazumi](https://github.com/Predidit/Kazumi) 将来源发现、播放器和同步分开的思路，没有复制其源码或内置影视规则。播放器按 [Android Media3 文档](https://developer.android.com/media/media3/exoplayer/hello-world) 独立实现，继续使用本站的房间服务。
