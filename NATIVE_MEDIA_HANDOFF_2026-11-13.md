# 当前集媒体识别与内置播放

版本：安卓 0.3.40（45），Windows 0.6.26。

## 安装

- 安卓：安装 `TogetherWatch-Android-0.3.40.apk`，覆盖旧版，不用卸载。
- Windows：退出旧版，完整解压 `TogetherWatch-Windows-0.6.26-x64.zip` 到新目录，再运行其中的 `TogetherWatch.exe`。
- 这次修改在客户端，不需要重建服务器。服务器若要向其他用户提示新版，仍需上传新安装包并最后更新 `client-releases/manifest.json`；仅推送 Git 代码不会发布安装包。

## 修复了什么

看剧 AI 的样例页面使用私有 ES 模块创建 HLS 实例，视频标签只暴露 `blob:`。旧识别方式既找不到真正清单，也容易误把后台预加载请求作为当前集。

本次在页面初始化时观察公开 HLS 实例，只接受与实际视频元素绑定的实例。看剧 AI 还需通过当前集按钮、房间集数和连续稳定采样校验；切集后旧实例、预加载的末集不能自动接入。其他来源保留原有播放器识别，并补充常见 Hls / Artplayer 实例读取。

安卓保留与当前页面绑定的匿名请求信息，尊重 `no-referrer`。只在 Media3 解码第一帧后释放原网页；等待期间暂停、静音原视频，失败时由用户选择返回网页，不自动跳到广告页面。Windows 增加当前媒体专用的本机读取通道，处理 HLS 清单、分片、非默认 HTTPS 端口，以及 MP4 的字节范围和长度信息；不再把“读到清单/时长”当作已经可以观看。

## 安全边界

- 不复制 Cookie / Authorization，不读取账户或会员凭据；媒体地址和请求信息不上传房间服务器。
- 不关闭 TLS 校验，不允许明文 HTTP，不处理 DRM 或 SAMPLE-AES。AES-128 仅使用公开清单引用的正常资源。
- Windows 通道没有监听端口或任意 URL 接口，只有本轮已识别媒体及其清单派生资源的随机令牌可读；换片失效并取消旧请求。
- Windows 每次网络连接校验公开 IPv4 DNS 地址并固定到该连接，拒绝内网、回环、元数据及保留地址。页面导航规则仍只允许默认 HTTPS 端口；非默认端口只用于媒体通道。
- 片源本身失效、需要登录验证、加密或设备不支持编码时，仍不能保证内置播放。保留明确的手动网页入口，不绕过这些限制。

## 验证

- 安卓 81 项 JVM 测试通过，APK 构建通过，lint 0 错误、70 条警告；没有连接安卓真机，不能将这些结果视为真机验收。
- Windows 75 项单元测试、公共网页脚本 262 项测试和安卓项目结构 21 项检查通过。
- 真实 Chromium 本地 HLS：私有模块绑定、排除末集预加载、第五集切第六集、保留/恢复原页、独立播放器解码第一帧通过。
- 看剧 AI、七味、233 动漫、茶杯狐、樱花的本地样例：目标集校验与延迟切集回归通过。这不代表所有原站的在线线路都已验证。
- Windows 双客户端：真实 MP4 解码、暂停/拖动/倍速同步、全屏、控件隐藏、手动回退、过期候选和 403 提示通过。
- Windows 回退联测：内置 HLS 失败时继续使用当前页面的视频区域、隐藏原站其他面板、双向同步和换集跟随通过；发行包自检通过。安卓 APK 保持原签名，可覆盖安装。
- 看剧 AI 公开“从零开始”样例：实际 HLS 实例读取、清单/分片读取、独立播放器第一帧解码通过。在线完整流程也遇到过原站连接中断，网络波动不计作测试通过。

可复测入口：`desktop-app/tests/media-bindings-smoke.cjs`、`android-episode-handoff-smoke.cjs`、`TW_SMOKE_BUILTIN_ONLY=1`、`TW_SMOKE_PUBLIC_KANJU=1`。在线测试使用独立会话及新建本地测试房间，不使用用户现有房间或登录信息。

HLS 本地夹具可用 FFmpeg 生成（先创建一个空输出目录；把 `fixture` 换成该目录）：

```text
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=24 -t 150 -an -c:v libx264 -preset ultrafast -g 144 -f hls -hls_time 6 -hls_list_size 0 -hls_segment_filename fixture/part-%03d.ts fixture/index.m3u8
```

设置 `TW_HLS_FIXTURE` 为该目录的绝对路径后，用 Electron 运行 `media-bindings-smoke.cjs`。夹具只产生测试图案，不需要下载第三方影片。
