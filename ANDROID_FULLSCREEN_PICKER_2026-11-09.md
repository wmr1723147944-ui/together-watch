# 安卓 0.3.36：全屏返回与选集读取

## 这次查到的问题

项目实际使用的 Media3 1.8.0 中，`PlayerView.setFullscreenButtonState()` 会调用 `PlayerControlView.updateIsFullscreen()`，后者同步通知 `FullscreenButtonClickListener`。这次检查了本地依赖的字节码，确认不是只有用户点击按钮才会回调。

旧监听器忽略回调里的目标状态，而是翻转当前状态。左上角返回、系统返回调用退出全屏，再更新按钮状态时，会重新进入全屏并继续反复调用。这条路径可能导致栈溢出、应用退出；之前只测试了返回路由，没有覆盖 Media3 同步回调。

现在按目标状态执行，同状态的通知直接忽略。进入和退出都先更新应用状态，再更新播放器按钮，因此程序产生的回调不会重复切换。首页返回退出应用的规则保留，同时拒绝在全屏或后台执行旧的首页退出回调。

## 选集读取

- 优先从当前播放页读取同来源、同影片的公开目录，不点击、不导航、不改变正在播放的集数。
- 看剧 AI、七味网、233 动漫等共用这条读取路径。没有目录、影片不匹配或回调超时，就回到原来的原站读取流程。
- 快捷读取最多等待 900 毫秒；迟到回调不能覆盖已开始的新请求。
- 只出现空面板不再算成功。区分正在读取、已有集数、失败提示和用户主动验证。
- 空目录读取超过 45 秒显示原生错误提示；网页回调失联超过 8 秒也有提示。上方“重试／关闭”不依赖网页，关闭不切集。
- 手动登录、验证保留更长等待时间，不绕过原站访问限制。

## 本地检查与边界

- 260 项共享 JS 测试、62 项桌面单元测试、21 项安卓项目检查通过。
- 64 项安卓 JVM 测试通过，包括模拟 Media3 同步回调、重复返回、空目录超时和重试。
- 真实 Chromium DOM 测试通过：空面板、已有集数、读取失败、隐藏面板、读取正在播放的目录、拒绝其他影片；没有访问外站。
- Android APK 构建成功，lint 0 errors / 68 warnings。
- 没有连接用户安卓真机；未声称已在线测试所有来源、所有影片。选集仍可能受原站网络、验证或目录变化影响。

## 用户操作

1. 下载 `TogetherWatch-Android-0.3.36.apk`，直接覆盖安装，不要先卸载。
2. 确认版本为 0.3.36，播放后进入全屏，分别试左上角返回和边缘返回。应只退出全屏，保留当前房间。
3. 再试“选集换源”。读取失败时应有提示，可重试或关闭，不应一直留在无说明的空白页。

这批修复在 APK 内，服务器代码和 Windows 包不用更新。

APK versionCode 41；与本地 0.3.35 签名一致。SHA-256：`693889874882f30f09aef366f2bd3f005ce78b8af4118d76677bf742e412a02e`。

## 让其他用户收到更新提醒（可选）

本地发布包：`.review-artifacts/releases/TogetherWatch-Android-0.3.36-publish.zip`，只含 APK 和 manifest，尚未上传。清单引用 Windows 0.6.25，服务器必须已有这个 Windows 包；如果服务器已发布更高版本，不要覆盖清单。

将发布 ZIP 上传到 `/home/ubuntu/`，在服务器逐行执行，任何一行报错就停止：

```bash
cd /home/ubuntu/together-watch
unzip -o /home/ubuntu/TogetherWatch-Android-0.3.36-publish.zip -d /home/ubuntu/android-update-0.3.36
cp -a --backup=numbered client-releases/manifest.json client-releases/manifest.backup.json
cp /home/ubuntu/android-update-0.3.36/client-releases/TogetherWatch-Android-0.3.36.apk client-releases/
cp /home/ubuntu/android-update-0.3.36/client-releases/manifest.json client-releases/manifest.next.json
mv client-releases/manifest.next.json client-releases/manifest.json
curl -fsS https://watchtogethernow.cloud/api/client-updates/android
```

返回 `available: true`、`version: 0.3.36` 表示发布成功，无需重启服务。代码推送不等于发布包上传。
