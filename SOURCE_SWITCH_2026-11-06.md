# 同名合并与房间内换源（2026-11-06）

## 这次怎么用

- 搜索时，同名影片的不同来源合并为一张卡片。点封面，在详情顶部选择来源，再选集。
- 缺少年份不再导致每个来源各占一张卡。只忽略空格、大小写与部分标点；不同季度、分部、重制版，以及明确不同年份的同名作品不混在一起。年份冲突时，未知年份条目单独合并并标为待核对。
- 播放时点「选集 / 换源」（安卓顶部为「选集换源」）。展开「查找其他来源 / 换源」，确认片名后点「查找来源」。结果随到随显示，点来源查看集数，确认某一集后才切换。
- 会标记标签一致的「对应集数」，不把两个网站的内部集数 ID 当成同一集。换源后从所选集开头播放，避免不同片头、剪辑长度造成进度错位；可手动拖到需要的位置。
- 查询或关闭面板不会退出当前房间，也不会重新建房。只有房主能确认换源，成员跟随新的来源和集数；站点登录、验证仍需各自完成。查询结果不等于该网站当前一定能播放。
- 原有边搜边显示、历史记录、房间同步功能保留；不会重新启用已移除的华人影院、低端影视和风车动漫。

## 安装包

本机目录：`D:\视频共享\.review-artifacts\releases`。

- Windows：`TogetherWatch-Windows-0.6.23-source-switch-x64.zip`。退出旧版，完整解压到新文件夹，运行里面的 `TogetherWatch.exe`；不要只复制 exe。
- 安卓：`TogetherWatch-Android-0.3.27-source-switch.apk`（versionCode 32）。传到手机后覆盖安装，不要先卸载。与此前本机安装包签名一致；如果提示签名冲突，请先保留原应用和本地历史，不要为了安装直接卸载。
- 服务器离线更新备用：`together-watch-source-switch-20261106-full.bundle`，包含截至本次提交的完整 main 历史。

SHA-256：

```text
Windows ZIP: c91cb618afc917416c6b2ece0ba46811df60c64fc227940cb25a18ae19caff03
Android APK: 7e717cd8eb23f377144fb296e0a2ba3eb350e511879af6916f6194a0164960fc
```

## 服务器可以等到一起更新

本次没有部署或重启服务器。提交推送只更新 GitHub；你可以等其他修改完成后再统一部署，不必逐条部署中间提交。

这项功能需要 **新客户端和新服务器页面配套**。只安装客户端、服务器仍是旧版时，不会出现完整的合并与换源面板。新版服务器配旧客户端仍能选集，但播放中换源会提示升级。

准备更新时，先让正在看的人暂停，服务器重建应用会让房间短暂断开。在服务器终端执行：

```bash
cd /home/ubuntu/together-watch
git status --short
git pull --ff-only
```

如果 `git status` 显示已跟踪文件修改或 `git pull` 报错，先停下来处理，不要强制覆盖；一个未跟踪的旧 `.bundle` 文件一般不影响更新。**仅在代码更新成功后**执行：

```bash
sudo docker compose --env-file .env.server up -d --build app
sudo docker compose --env-file .env.server ps
curl -fsS https://watchtogethernow.cloud/health
```

等 app 显示 healthy 后，再重开两端客户端。没有删除数据库、账号、服务器配置或数据卷，也不需要重启 Caddy。

若服务器仍无法连接 GitHub，把上面的完整 bundle 手动上传到 `/home/ubuntu/`，用以下命令替代 `git pull`：

```bash
cd /home/ubuntu/together-watch
git bundle verify /home/ubuntu/together-watch-source-switch-20261106-full.bundle
git fetch /home/ubuntu/together-watch-source-switch-20261106-full.bundle refs/heads/main
git merge --ff-only FETCH_HEAD
git log -1 --oneline
```

任何一步失败就停下，不要继续重建。合并成功后执行前面的 Docker 命令即可。

## 检查范围

- 232 个共享 JavaScript 测试、59 个 Windows 单元测试、28 个相关 Python 测试通过。
- 安卓 31 个 JVM 测试、lintDebug 和 assembleDebug 通过，APK 版本及签名已检查。
- 本地真实 Electron 主客端：播放中查询其他来源、关闭不退房、原集不重启、跨来源换到对应集、成员跟随、成员不能改片源均通过。
- 实际页面配安卓打包桥接脚本：未查完即可选来源、优先读集数、关闭后丢弃迟到结果，320/390/480px 窄屏布局通过。
- Windows 成品包启动及内置资源检查通过。没有连接安卓真机；本地受控样例不代表所有原网站当前可用，不绕过网站验证或权限。
