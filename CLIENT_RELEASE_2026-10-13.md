# 本次更新：Android 0.2.1 / Windows 0.1.0

## 你需要做的三件事

### 1. 在 Ubuntu 服务器更新网站

进入腾讯云服务器终端。看到 `ubuntu@...` 后执行，不要在 `PS C:\Users\...` 的 Windows 终端执行。

```bash
cd ~/together-watch
git pull --ff-only
sudo docker compose --env-file .env.server up -d --build app
sudo docker compose --env-file .env.server ps
```

确认 `git pull` 没有报错、构建成功，`app` 显示 `healthy`。本次不需要改域名、防火墙或 `.env.server`。更新后退出旧房间再进入。

修复内容：移动房间给 Socket.IO 发送不带回调的播放消息时，误带一个 `undefined` 参数，在线传输后变成额外的 `null`。Python 服务因此拒收播放事件及进度采样，尽管界面仍显示“房间已连接”。修复位于服务器提供的 JS 中，因此旧 APP 也需要刷新房间页面才能取得修复。

### 2. 手机安装 Android 0.2.1

本地安装包：`android-app/app/build/outputs/apk/debug/TogetherWatch-Android-0.2.1.apk`。

发送到手机后覆盖安装。全屏改为独立覆盖窗口、自动横屏、隐藏应用工具栏和系统栏；退出后恢复原布局。全屏可选“铺满屏幕（裁边）”，默认完整画面不变形。电影本身的黑边与屏幕比例差异仍可能留边。

这是调试签名的测试包。如果提示签名不同，先确认旧包是否来自另一台机器或 GitHub Actions；不要直接卸载旧版，以免丢失本机登录状态和设置。本次本地 APK 签名与此前本机调试证书相同。

### 3. 电脑打开 Windows 版

本地发行包：`desktop-app/dist/TogetherWatch-Windows-0.1.0-x64.zip`。

完整解压后双击 `TogetherWatch.exe`，不要只拷走 EXE。无需安装插件、拖书签或配开发环境。左侧播放，右侧聊天/通话；`F11` 全屏，`Esc` 返回，`Ctrl+Z` 切换完整画面/裁边。

先让两端选同一段 `Sintel` 公开短片、加入同一房间，依次试暂停、跳进度、倍速和聊天，再换自己的链接。邀请链接只带房间，双方仍需打开同一集、同一版本。

## 已验证 / 未验证

- Python：35 项通过；前端与原生同步 JS：36 项通过；Windows 单元测试：15 项通过。
- Android Java：3 项通过；APK 编译成功；lint 0 错误、25 警告；APK 签名验证通过。
- Windows：打包成功，实际 EXE 隐藏启动自检通过。两个真实 Chromium 播放器加本机 Flask 服务验证了跨源 iframe 识别、双向暂停/播放/跳进度/倍速、音量隔离、聊天、全屏进入/退出及退出清理。
- 安卓全屏仍需在你的手机上复测；本轮没有连接安卓实体机。不能把“编译通过”当成所有机型显示都已验证。
- 本轮未验证真实麦克风、手机与电脑跨网络通话。原有语音功能保留；严格 NAT 场景仍需要正确配置 TURN。
- Windows 包未代码签名，暂无安装器或自动更新。不保证兼容全部视频网站、DRM 或特殊登录流程。系统若提示未知发布者，请核对包来源，不要关闭系统安全防护。

详细说明见 `desktop-app/README.md` 和 `android-app/NATIVE_PLAYER.md`。
