# 观看历史：集数与进度修复

配套版本：Windows **0.6.19**、安卓 **0.3.20**（versionCode 25）。需要更新服务器和两端客户端。

## 修复范围

- 原站在播放中换集时，读取当前公开页面及已选中的集数，不再一直把时间记在进房时的第一集下面。看剧 AI、茶杯狐、樱花的动态选集会核对原站按钮；七味、233 动漫读取规范播放页标识。无法确认时不猜测。
- 原站按钮先变、视频还没换的过渡帧不写入新一集，等待播放器会话切换。内置播放器保留切换前确认过的片源信息，不使用已卸载网页的空标题。
- 历史续播时，先确认身份和房间人数，等播放器跳到保存位置后再记录；跳转未完成不会把原进度覆盖成刚开播的几秒。朋友房间仍以房间同步进度为准，不用个人历史干扰房主。
- 暂停、离开与切换时保存最后有效采样；旧采样保留原时间戳，不会在关闭旧房间时重新排到最前面。静止的暂停页面不会反复刷新观看时间。
- 账号同步冲突会保留较新的本机进度，不再因另一设备更新无关记录而整批丢弃。本机回退进度是有效操作，不按“最大播放时间”硬合并；远端较新记录、删除和关闭历史仍受到保护。
- 页面离开前先保存进度，再尝试上传小批量账号记录。断网或进程被强杀时无法保证立即上传，待同步数据仍留在本机。

原站自行换集不等于已替整个房间换集。检测到不一致时，会停止把新一集的时间发到旧一集，并提示用软件的“选集”让朋友一起切换。不要把原站自动下一集当成双端联动已经成功。

旧的错误记录不会被凭空改成猜测的集数或进度。无需清空所有历史；更新后重新选对集数、播放后会保存新的正确记录。

## 1. 更新服务器

如果服务器仍连不上 GitHub，用离线更新包即可，无需再反复 `git pull`。

电脑文件：`.review-artifacts/releases/together-watch-history-progress-20261103-full.bundle`。

把这个文件通过腾讯云终端的上传功能放到服务器 **`/home/ubuntu/`**。下面命令只在提示符为 `ubuntu@…` 的服务器终端执行，不是在 Windows PowerShell。

先检查：

```bash
cd /home/ubuntu/together-watch
ls -lh /home/ubuntu/together-watch-history-progress-20261103-full.bundle
git status --short
git bundle verify /home/ubuntu/together-watch-history-progress-20261103-full.bundle
```

校验应显示 `is okay`。如果工作区只有 `?? *.bundle` 可以继续；如果有源码 `M`、`D`、`A` 等修改，或任一步报错，先停下发截图，不要强制覆盖。

然后逐行执行：

```bash
git branch backup-before-history-progress-20261103
git fetch /home/ubuntu/together-watch-history-progress-20261103-full.bundle refs/heads/main
git merge --ff-only FETCH_HEAD
git log -1 --oneline
sudo docker compose --env-file .env.server up -d --build app
sudo docker compose --env-file .env.server ps
```

备份分支已存在时，跳过创建分支那行即可。`app` 应显示 `healthy`；刚启动可稍等再执行最后一行。异常时运行：

```bash
sudo docker compose --env-file .env.server logs --tail=80 app
```

不要删除 `.env.server`、账号数据卷，也不要执行 `docker compose down -v`。

如果 GitHub 已恢复连接，可以用 `git pull --ff-only` 代替上面的 `git fetch` 和 `git merge`，之后仍要重建 `app`。

## 2. 更新 Windows

1. 退出正在运行的一起看。
2. 将 `TogetherWatch-Windows-0.6.19-history-progress-x64.zip` 完整解压到新文件夹。
3. 运行其中的 `TogetherWatch.exe`；不要只复制 EXE，也不要在 ZIP 内直接启动。
4. 修改桌面快捷方式，让它指向这个新文件夹。不要删除旧用户数据。

## 3. 更新安卓

把 `TogetherWatch-Android-0.3.20-history-progress.apk` 发到手机，覆盖安装，**不要先卸载旧版**。本包与上次 0.3.19 的签名一致；若手机仍提示签名冲突，先保留旧版并反馈。

## 4. 花两分钟核对

1. 更新完成后，完全退出并重开两端。先一人测试，选第 1 集拖到 3:00，再播放十秒。
2. 用软件“选集”切到第 2 集，拖到 1:00，播放十秒后暂停并返回历史。最新记录应为第 2 集、约 1:10；第 1 集不能冒到最前面。
3. 点击第 2 集历史重新观看，确认从保存的位置接上，而不是从头播放。
4. 再检查原网页换集／自动下一集的记录。一起看时，请用软件“选集”切换房间集数。
5. 若登录了同一个账号，等账号界面显示“已同步”，再到另一设备查看。未登录的历史只保存在各自设备，不跨设备同步。

仍异常时，请发“片源、片名、实际集数与进度、历史显示的集数与进度”以及两端版本号；不用清空历史重试。

## 本地验证

- Node 回归 253 项、Python 回归 167 项通过。
- 安卓单元测试 26 项通过；APK 构建及 Lint 通过（0 错误、61 条现有警告）。
- Windows 发布包自检通过：主界面、预加载脚本、独立播放器、HLS、目录规则与 IPC 校验；包内关键文件与本次源码核对一致。
- 实际 Chromium 历史封面／进房回归通过。新增逻辑测试覆盖原站换集、旧视频过渡帧、续播确认、静止暂停、退出保存、账号冲突和朋友房间不抢进度。
- 未进行安卓真机与两台物理设备联网验收，也未自动部署服务器或安装客户端。
