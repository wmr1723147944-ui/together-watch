# 加入房间与历史封面更新

本批客户端：Windows **0.6.18**、安卓 **0.3.19**（versionCode 24）。

## 改了什么

- 网页、Windows、安卓的加入房间界面统一成简洁的邀请面板：优先输入邀请／房间号，主按钮只做加入；兼容设置保留在次要位置。协议确认、昵称验证和原有房间身份解析不变。
- 修复历史页传入空基准网址，导致有效绝对封面地址被拒绝的问题。已有记录无需清空。
- 选集时优先记录详情页已经显示成功的封面，同时保存最多 6 个经过现有安全规则筛选的备用封面。原图失败时自动尝试备用图。
- 重新打开同一集但没有拿到封面时，不再抹掉原有封面；账号同步也保留备用图和年份信息。未登录仍只存本机，登录不会自动上传本机历史。
- 已移除片源不重新启用。原图和所有备用地址都失效、或旧记录从未保存封面时，仍可能出现占位图；没有承诺所有第三方图片都能恢复。

## 你需要做什么

### 1. 更新服务器（手动上传，不需要服务器连接 GitHub）

在电脑找到 `.review-artifacts/releases/together-watch-join-history-20261102-full.bundle`，用腾讯云终端的上传文件功能上传到 **`/home/ubuntu/`**。文件名不要改，不要传到电脑 PowerShell。

在提示符为 `ubuntu@…` 的服务器终端，先执行：

```bash
cd /home/ubuntu/together-watch
ls -lh /home/ubuntu/together-watch-join-history-20261102-full.bundle
git status --short
git bundle verify /home/ubuntu/together-watch-join-history-20261102-full.bundle
```

应看到文件大小、bundle 校验通过。`git status` 只有 `?? *.bundle` 可以继续；如果有 `M`、`D`、`A` 等源码修改，或校验报错，先停下发截图，不要覆盖文件或强制重置。

然后逐行执行（任何一步报错都先停下）：

```bash
git branch backup-before-join-history-20261102
git fetch /home/ubuntu/together-watch-join-history-20261102-full.bundle refs/heads/main
git merge --ff-only FETCH_HEAD
git log -1 --oneline
sudo docker compose --env-file .env.server up -d --build app
sudo docker compose --env-file .env.server ps
```

备份分支已存在时可跳过第一行，不要删除旧备份。确认 `app` 显示 `healthy`（刚启动可能要稍等）。如果失败：

```bash
sudo docker compose --env-file .env.server logs --tail=80 app
```

检查新样式确实上线：

```bash
curl -fI https://watchtogethernow.cloud/static/css/room-entry.css?v=20261102-join
```

应返回 HTTP 200。此步骤仅证明文件存在，不代替进房实测。不要删除 `.env.server`、账号数据卷，或执行 `docker compose down -v`。

### 2. 更新 Windows

1. 退出正在运行的一起看。
2. 将 `TogetherWatch-Windows-0.6.18-join-history-x64.zip` **完整解压到新文件夹**。
3. 打开里面的 `TogetherWatch.exe`。不要只移动 EXE，不要在压缩包里直接运行。
4. 如有桌面快捷方式，把它改指向新文件夹，避免再次打开旧版。

### 3. 更新安卓

将 `TogetherWatch-Android-0.3.19-join-history.apk` 发到手机，直接覆盖安装。已核对它与本地 0.3.18 包签名一致。不要先卸载，以免丢失本机历史和登录信息；如果手机提示签名冲突，先保留旧版并反馈。

### 4. 验收

- 退出并重新打开软件，打开“观看历史”，检查以前有封面地址的记录能否显示。
- 选一集播放超过 5 秒，再回到历史；确认片名、集数、封面和进度。
- 一台设备选片后复制邀请，另一台进入“加入房间”粘贴邀请，确认进入相同房间并跟随房主。
- 如果某条历史仍无封面，发片名、来源和截图；不用清空所有历史。

## 验证范围

- Node 回归 236 项，Python 回归 167 项，通过。
- 安卓单元测试 26 项，通过；APK 构建成功；Lint 0 错误，61 条警告（包含现有警告与硬编码文案提示）。
- Sites 本地预览流程下，实际 Chromium 渲染检查了旧历史封面、原图失败回退、选集保存已加载图片、协议验证、相同房间跳转，以及电脑、手机、短屏布局；Windows 原生壳面板也有渲染截图。
- 安卓本次完成构建和静态／单元检查，未进行真机触屏或双机联网验收。没有自动部署服务器、安装客户端或上传安装包到外部平台。
