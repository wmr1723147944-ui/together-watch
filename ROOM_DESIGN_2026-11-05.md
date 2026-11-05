# 双端房间界面更新：Windows 0.6.22 / 安卓 0.3.25

## 改动

- 播放界面统一为暖黑配色、柔和的文字层级和珊瑚色邀请按钮，不再用大片亮白或紫色工具栏抢画面。
- Windows 房间顶栏由两行合并为 64px 一行，保留返回、选集、邀请、全屏和“更多”；展开设置时播放器同步让位，不会盖住控件。首页和搜索页不受影响。
- 安卓将返回与播放操作收进同一排，减少上方按钮占用；识别视频时的等待界面改为简洁的“放映准备”，原有重试、换来源和手动打开入口保留。
- 房间消息区重新区分系统通知和聊天气泡。弹幕、音量、个人账号收入“房间设置”，语音入口仍可直接点击。
- 小屏中语音和设置同时打开时，面板内部滚动，保持聊天输入框可见。Windows 全屏按钮继续闲置自动隐藏。

这批不改变同步协议、历史归并规则和房主权限。Windows 包也包含此前 0.6.21 的看剧 AI 自动识别与兼容播放修复；其范围和限制见 [播放器修复记录](WINDOWS_PLAYBACK_2026-11-05.md)。

## 安装两个客户端

文件位于项目的 `.review-artifacts/releases/`：

1. **Windows**：退出旧版，完整解压 `TogetherWatch-Windows-0.6.22-room-design-x64.zip` 到一个新文件夹，再打开里面的 `TogetherWatch.exe`。不要只复制 EXE；旧快捷方式可能仍指向旧版。
2. **安卓**：把 `TogetherWatch-Android-0.3.25-room-design.apk` 发到手机，直接覆盖安装。已核对与本地分发的 0.3.24 签名相同，不要为了更新先卸载、清除数据，以免丢失本机历史。如果手机提示签名冲突，先停止并核对旧包来源。
3. 按下一节更新服务器，再彻底关闭并重新打开两端、进入房间。顶栏来自客户端，聊天和设置来自服务器；只换安装包会出现新旧界面混用。

## 更新服务器

在腾讯云服务器终端执行。先看 `git status --short`；若有自己改过的源码、配置冲突，不要强制覆盖。仓库中的旧 `.bundle` 未跟踪文件通常不妨碍更新。

```bash
cd /home/ubuntu/together-watch
git status --short
git pull --ff-only
```

确认拉取成功后再执行：

```bash
sudo docker compose --env-file .env.server up -d --build app
sudo docker compose --env-file .env.server ps
curl -fsS https://watchtogethernow.cloud/health
```

等 `app` 显示 `healthy` 后重新进房。构建并重启 app 会使现有房间短暂断开；不需要重启 Caddy，不要执行 `down -v`，也不要删除账号数据卷。代码推送不会替你完成部署。

### GitHub 仍连接失败时

使用同目录中的 `together-watch-room-design-20261105-full.bundle`，手动上传到服务器 `/home/ubuntu/`。**上传的是 bundle，不是 APK 或 Windows 压缩包。** 然后执行：

```bash
cd /home/ubuntu/together-watch
git status --short
git bundle verify /home/ubuntu/together-watch-room-design-20261105-full.bundle
git fetch /home/ubuntu/together-watch-room-design-20261105-full.bundle refs/heads/main
git merge --ff-only FETCH_HEAD
git log -1 --oneline
```

每步确认成功再继续；如果出现冲突或无法快进，停止并保留现场，不要 `reset --hard`。合并成功后，执行上面的 Docker 构建、状态及健康检查命令。

## 检查范围

- Windows 单元检查、打包资源检查通过。
- 本地真实视频双客户端联测：播放、暂停、进度、倍速、全屏进入退出和控件自动隐藏通过；全屏测试单独运行，避免多个隐藏测试窗口的焦点干扰。
- 首页→选片→房间、展开/收起“更多”、返回与邀请进房回归通过。
- 320/390/400px 房间消息区检查：无横向溢出；设置与语音同时展开时输入框仍可见；账号对话框可打开。
- 安卓 `testDebugUnitTest`（30 项）、`lintDebug`、`assembleDebug` 通过；APK 签名验证通过。
- 安卓未连接实体手机，本次不能当作已完成手机实机验收。建议安装后重点看竖屏、横屏、输入法弹出及语音展开。

开发者可在 `desktop-app` 设置 `TW_SMOKE_PYTHON` 指向有后端依赖的 Python，再用 `TW_SMOKE_BUILTIN_ONLY=1` 运行 `electron . --smoke-test`；加 `TW_SMOKE_ROOM_DESIGN_ONLY=1` 单独测试新消息区，`TW_SMOKE_FILM_HOME_ONLY=1` 测试进房导航。不要把测试房间指向生产服务器。

## 安装包 SHA-256

```text
Windows 0.6.22
62072aa4ac91fbeed9553b8ede41dbbaefb6581eb1b7ab9c2227d66266485060

Android 0.3.25
8a68d6d177e26931faa453df517324e5dcb9280278b64a4a6cfc90bcf7ca4035
```
