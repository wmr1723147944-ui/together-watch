# 客户端更新提醒与发布（2026-11-06）

## 用户会看到什么

Windows **0.6.24**、安卓 **0.3.28**（versionCode 33）新增版本检查、更新说明、「打开下载页」和「稍后提醒」。

- 启动时检查更新；Windows 保持运行时每 6 小时检查一次，安卓回到前台时按 6 小时间隔检查。
- 已在房间中时不自动弹窗，不暂停、退出或重建房间。同一版本选「稍后提醒」后，24 小时内不再自动提醒；手动检查不受此限制。
- Windows：首页「检查更新」，或房间「更多 → 检查更新」。安卓：首页「登录 / 我的账号 → 客户端版本 / 检查更新」（不用登录），或房间「更多 → 检查更新」。
- 版本说明仅显示文字，下载入口固定为自己服务器的 `/downloads`，不接受片源网页传入的下载地址。不读取网站登录信息，也不上传观看历史用于检查更新。
- 网络失败、旧服务器返回 404、版本清单无效、安装包未发布：静默跳过自动提示，手动检查给出说明，仍可使用软件。
- 本次提供的是**更新提醒与下载入口**，不是静默安装器。不自动下载大文件，不申请安卓安装权限，不自动替换正在运行的 Windows 文件，也不启用强制升级。

**第一次仍需手动安装这两个版本。** 旧版本没有检查程序，更新服务器不能给旧安装包凭空加上原生更新器。安装本次版本后，以后的版本就能自己收到提示。

## 本次交付文件

本机目录：`D:\视频共享\.review-artifacts\releases`。

- Windows：`TogetherWatch-Windows-0.6.24-x64.zip`。退出旧版，完整解压到新文件夹，运行其中的 `TogetherWatch.exe`，不要只复制 exe。
- 安卓：`TogetherWatch-Android-0.3.28.apk`。覆盖安装，不要先卸载。与此前本机生成的 APK 签名相同；若其他渠道版本提示签名冲突，先保留旧应用和本机记录。
- 服务器更新套件：`TogetherWatch-Server-Updates-20261106.zip`，包含完整 Git bundle 和 `client-releases/` 下的两个安装包、版本清单。

安装包 SHA-256：

```text
Windows: d573ecb2ae3740090ba987e552a028f6a5a9bd056f44a36d7ddad4159025404c
Android: a6c5fb323e26ac305ec59e889e37b3535be9df9e75df24cbf70fe461d059b173
```

## 第一次发布：手动上传服务器套件

本次**没有替你部署服务器，也没有向外部平台发布安装包**。GitHub 推送成功也不等于下载服务已开通。你需要做下面这一次发布，其他人才能使用同域下载入口。

把 `TogetherWatch-Server-Updates-20261106.zip` 上传到 `/home/ubuntu/`。等没人正在观看时，在服务器终端逐段执行；任一步失败就停下，不要继续，不要使用强制覆盖或删除数据卷。

先解压到新的临时目录（不会覆盖项目配置）：

```bash
cd /home/ubuntu
mkdir together-watch-updates-20261106
unzip TogetherWatch-Server-Updates-20261106.zip -d together-watch-updates-20261106
```

如果目录已存在，不要直接覆盖；确认之前的上传状态，或换一个新目录并对应修改后续路径。

更新代码：

```bash
cd /home/ubuntu/together-watch
git status --short
git bundle verify /home/ubuntu/together-watch-updates-20261106/together-watch-client-updates-20261106-full.bundle
git fetch /home/ubuntu/together-watch-updates-20261106/together-watch-client-updates-20261106-full.bundle refs/heads/main
git merge --ff-only FETCH_HEAD
git log -1 --oneline
```

有已跟踪文件修改或快进失败就先停下处理，不要重置工作区。旧的未跟踪 bundle 可保留。

放置安装包。**两个大文件先复制，版本清单最后发布**；不要覆盖正在提供下载的同名包，后续每次升级都使用新的版本号与文件名：

```bash
mkdir -p /home/ubuntu/together-watch/client-releases
cp -n /home/ubuntu/together-watch-updates-20261106/client-releases/TogetherWatch-Windows-0.6.24-x64.zip /home/ubuntu/together-watch/client-releases/
cp -n /home/ubuntu/together-watch-updates-20261106/client-releases/TogetherWatch-Android-0.3.28.apk /home/ubuntu/together-watch/client-releases/
cp /home/ubuntu/together-watch-updates-20261106/client-releases/manifest.json /home/ubuntu/together-watch/client-releases/manifest.next.json
mv /home/ubuntu/together-watch/client-releases/manifest.next.json /home/ubuntu/together-watch/client-releases/manifest.json
```

部署并检查：

```bash
sudo docker compose --env-file .env.server up -d --build app
sudo docker compose --env-file .env.server ps
curl -fsS https://watchtogethernow.cloud/health
curl -fsS https://watchtogethernow.cloud/api/client-updates/windows
curl -fsS https://watchtogethernow.cloud/api/client-updates/android
```

必须确认：app 为 `healthy`，`/health` 包含 `client_update_api_version: 1`，两个更新接口均为 `available: true`，版本分别是 `0.6.24`、`0.3.28`。服务器会检查文件名、大小和 SHA-256，没传完或损坏的文件不会显示为可更新。

在普通浏览器打开 **https://watchtogethernow.cloud/downloads**，分别试下载。然后把这个页面地址发给其他人，让他们第一次手动安装；不必让所有人同时操作。刚安装最新版本后手动检查会显示无需更新，这是正常结果，不会提示安装同一个版本。

服务器重启会短暂断房；当前内存房间可能需要重新选片或建房。账号和历史数据库仍使用原有数据卷，发布目录另外以只读方式挂载到容器，不会覆盖数据库。

## 以后发布新版本

先增加客户端版本号（安卓 versionCode 也必须递增），完成测试和打包，继续使用原签名。不要把旧安装包改名冒充新版。使用脚本生成新的发布目录：

```powershell
python scripts/prepare_client_release.py --windows "新版 Windows.zip" --android "新版 Android.apk" --output ".review-artifacts/新的发布目录" --note "本次改进内容" --note "修复内容"
```

脚本从当前源码读取版本，复制你指定的对应版本产物、计算摘要，并校验发布目录；不会上传或替换服务器文件。更新内容最多 8 条，每条 240 字。

将新版本两个包先上传到服务器的 `client-releases/`，再将新清单先传为 `manifest.next.json`，最后重命名为 `manifest.json`。**只更新安装包和清单不需要重启服务**；有服务器代码修改时才重新构建。更新接口读取清单后，会向旧客户端提供新版本。保留上一份清单和旧安装包，发现问题时可恢复上一份清单，不强制客户端降级。

## 测试与限制

- 237 个共享 JS、62 个 Windows 单元测试、31 个相关 Python 测试通过。
- Windows 实际更新按钮、IPC、未发布状态、版本说明、稍后不下载、固定下载页、坏响应回退均通过；Windows 成品启动与播放器资源检查通过。
- 安卓 34 个 JVM 测试、lintDebug、assembleDebug 通过，版本与签名已核对。未连接安卓真机，系统下载与安装确认仍需在实际设备上完成。
- APK 沿用此前本机测试签名；这是自用测试分发，不代表应用商店正式发布。请妥善保存原签名，不要随意更换。
- 下载实现遵循 [Electron 外部链接安全要求](https://www.electronjs.org/docs/latest/tutorial/security/)与 [Android 浏览器 Intent 文档](https://developer.android.com/guide/components/intents-common)：只让可信原生入口打开固定的 HTTPS 下载页，不向第三方网页暴露更新或安装权限。
