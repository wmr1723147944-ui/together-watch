# 一起看 Windows 测试版 0.1.0

这是独立桌面客户端，不需要书签、浏览器扩展、Python 或 Node。左侧保留视频来源网页，右侧是一起看房间。它不是把第三方影片转发到服务器，也不是支持所有资源的万能播放器。

## 怎么打开

1. 将 Windows 压缩包**完整解压**到一个文件夹。
2. 双击 `TogetherWatch.exe`。不要只把 EXE 单独拷走，它需要同文件夹中的运行库和 `resources`。
3. 输入昵称，先点 `Sintel` 或 `Big Buck Bunny` 选择公开短片，勾选使用说明后开始。
4. 点“复制邀请”，把链接发给朋友。朋友在客户端填写同一邀请链接，也选择同一段短片。邀请不包含影片地址。
5. 播放、暂停、拖进度及倍速在左侧视频中操作，右侧直接聊天。必要时先在网页点一次播放。

`F11` 进入全屏，`Esc` / `F11` 返回；全屏下 `Ctrl+Z` 切换完整画面与铺满裁边。默认不拉伸、也不裁掉影片。原影片自带黑边不会凭空消失。

目前提供 Windows x64 便携测试包，未做代码签名、安装器和自动更新。系统可能提示未知发布者；不要关闭系统安全防护，只运行你确认来自本项目的包。关闭主窗口会退出房间。

## 上线前先更新服务器

本次修复了 `mobile-room.js` 向 Socket.IO 传入空回调导致多一个消息参数的问题。旧服务器可能显示“已连接”却收不到播放事件。**仅安装客户端不会修复旧服务器。**

代码推送后，在 Ubuntu 服务器的项目目录执行，确认每一步成功后再继续：

```bash
cd ~/together-watch
git pull --ff-only
sudo docker compose --env-file .env.server up -d --build app
sudo docker compose --env-file .env.server ps
```

不用在 Windows PowerShell 执行这组服务器命令，也不用改 `.env.server`。更新后双方退出房间重新进入。

## 当前边界

- 自动识别普通 HTML5 视频、可访问的嵌套页面和开放 Shadow DOM。部分广告、多播放器、封闭组件、定制控制条可能需要“重新识别播放器”，不能保证任意网站兼容。
- 这是内置 Chromium 网页播放器，不是 Android Media3 的 Windows 移植版。不自带影视搜索、资源规则、自动选集、下载或任意 HLS/DASH 直链解析。网站本身正常支持的网页播放可继续使用。
- 每个人自行打开同一集、同一版本，并用自己的观看权限登录。付费、DRM、验证码、禁止嵌入浏览器或特殊登录弹窗可能不兼容，不破解限制。
- 只把播放时间、状态和用户控制传入房间协议，不提取或转发媒体地址。视频站登录 Cookie 由本机 Chromium 保存，与房间站点的存储隔离；应用控制代码不读取这些凭据。页面自身仍会正常联网。
- 输入入口拒绝 HTTP、IP、凭据 URL 和本地域名。这是导航限制，不是 DNS 或全系统网络隔离；不要把未知网页当成可信内容。
- 第三方视频页不能使用应用的 Node/文件接口，也不能申请麦克风。只有本站房间在你确认后可申请语音麦克风。
- 语音保留现有 WebRTC 功能，本轮未做真实麦克风、跨运营商网络测试。服务器缺少 TURN 时，严格 NAT 下仍可能无声或连接失败。
- 测试版不自动更新内置浏览器，后续需要手动换新包。不要长期使用过时版本。

## 开发与验证

Node 22.12+，Electron 44.7.0，依赖锁定在 `package-lock.json`：

```powershell
cd desktop-app
npm ci
npm test
npm start
npm run package:win
```

输出 `dist/TogetherWatch-win32-x64/`。运行时不需要开发依赖。保留发行目录中的 Electron/Chromium 第三方许可文件。

集成测试会创建两个隐藏 Electron 窗口，启动仅监听 `127.0.0.1` 的临时 Flask 服务，不操作公网房间。先安装根目录的 Python 依赖，并将一个可拖进度的测试 MP4 放在 `.review-artifacts/desktop-smoke/sintel.mp4`，或指定 `TW_SMOKE_MEDIA`；可用 `TW_SMOKE_PYTHON` 指定 Python 路径，再运行 `npm run smoke`。

测试范围包括真实跨源 iframe 播放器、双向暂停/进度/倍速、音量隔离、聊天、全屏尺寸及退出清理。它不能代替真机声音、第三方站点兼容性和不同网络条件下的验收。
