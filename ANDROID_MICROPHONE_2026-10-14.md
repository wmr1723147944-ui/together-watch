# Android 0.2.2：麦克风修复

## 原因和范围

0.2.1 的源清单和已构建 APK 都声明了 `RECORD_AUDIO`，但没有 `MODIFY_AUDIO_SETTINGS`。Chromium 的音频设备管理要求这两项权限用于通信设备选择和枚举，缺少时可能无法向网页提供可用录音设备。源码依据：[Chromium AudioManagerAndroid](https://github.com/chromium/chromium/blob/main/media/base/android/java/src/org/chromium/media/AudioManagerAndroid.java)。

0.2.2 补上音频设置权限，版本号为 4。它是普通声明权限，不代替用户对录音的授权；只有受信任房间页在前台才能向现有权限流程请求麦克风，第三方视频网页仍不能使用麦克风。没有开放明文 HTTP、绕过证书校验或新增后台录音。

用户看到的“请确认使用 HTTPS 并检查音频设备”是旧网页代码对多种失败给出的通用提示，不能据此判断 HTTPS 出了问题。本次网页脚本把拒绝授权、找不到设备、无法启动设备、启动中断和安全策略限制分别说明，并显示错误类型。Android WebView 的权限提示改为手机应用设置，而不是不存在的浏览器地址栏。失败后释放预先创建的 AudioContext，保留再次尝试入口。

## 安装与复测

本地测试包：`android-app/app/build/outputs/apk/debug/TogetherWatch-Android-0.2.2.apk`。

文件 SHA-256：`D60BEA11BD990E8E00AEB7AADE924C77DFB28B9DBBA97DCE1B293CAFECB5704E`。

1. 将 APK 发到手机，打开并覆盖安装。不要先卸载旧版。
2. 如果提示签名冲突，先核对旧包是本地还是 GitHub Actions 构建；不要为安装而清空应用数据。本地新包会核对是否与此前本地 0.2.1 的签名一致，Actions 临时调试签名可能不同。
3. 打开 APP 进入房间，点“加入语音”，选择允许使用麦克风。必要时到手机设置 → 应用 → 一起看 → 权限检查麦克风，并检查系统麦克风总开关。
4. 保持 APP 在前台，与电脑互相说一句话；两边分别测试静音与取消静音。近距离测试建议戴耳机。
5. 如果仍失败，发出错文字、手机型号、Android 版本，以及是否出现过系统授权弹窗。不要发送 Cookie、令牌或完整私密日志。

APK 权限修复安装后即可生效，不依赖本次网页文案更新。网页的分类报错仍需代码提交、推送并部署服务器后才会出现；本地改动不自动更新公网服务。

## 验证边界

本次未连接安卓实体机，不能宣称已验证真实录音和通话声音。自动测试检查清单、错误分类、失败后的音频资源释放、再次加入以及原有同步功能。

本地验证完成：39 项 Python、67 项 JavaScript、3 项 Android Java 单测通过；APK 构建成功；lint 0 错误、24 警告。使用 `aapt` 确认新包实际包含 `RECORD_AUDIO` 和 `MODIFY_AUDIO_SETTINGS`，版本为 0.2.2 / versionCode 4。APK 签名校验通过，证书 SHA-256 为 `07dc44630d08efd7abadeff20293c34584fab1e8f8b59372391c175ebcfdbc45`，与此前本地 0.2.1 一致。新 APK 使用独立文件名，旧安装包未删除或覆盖。

如果成功加入语音后才出现对方听不到，属于另一个排查阶段：还需检查静音、播放音量与 WebRTC/TURN 网络连接。补齐麦克风权限并不保证所有网络都能直连。
