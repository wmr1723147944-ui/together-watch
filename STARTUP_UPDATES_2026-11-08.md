# 打开软件时询问更新

Windows 0.6.25、安卓 0.3.32（versionCode 37）。

打开软件后会自动检查服务器版本。有新版时显示版本号、更新说明，以及「立即更新 / 稍后再说」。立即更新打开本项目的 HTTPS 下载页，用户自行下载、确认安装；不会静默下载、替换正在运行的软件、退出房间或要求先卸载。

「稍后再说」或关闭弹窗后，本次运行不再自动提示相同版本；退出软件再启动会重新检查。不再使用旧版跨启动 24 小时的稍后设置，原设置文件保留但不再读取。安卓只切回前台不会每次重复弹同一版本。

Windows 不再等推荐网页加载完才检查更新。发现新版时如果窗口没焦点或仍在房间中，会保留结果，在回到前台且不在房间时提示；安卓也在回到前台、离开房间后尝试提示。手动检查仍可随时使用。网络不可用、版本相同、旧服务器、安装包未发布时不会阻止启动，不会错误提示降级。

## 当前部署情况

2026-11-08 只读查询发现：线上更新接口仍发布 Windows 0.6.24 和安卓 0.3.28。所以即使后续代码已推送，新客户端也不会提示下载服务器上没有发布的安装包。

本批本地生成两个新版安装包，以及 `TogetherWatch-Client-Updates-20261108.zip`，内含 `client-releases/` 和新版 `manifest.json`。**尚未替用户上传或部署**。已经有更新接口的服务器只需发布文件，不需重启服务或更新数据库。

## 安装和发布

自己先体验：安卓 APK 直接覆盖安装，不要卸载；Windows 先退出旧版，完整解压 ZIP 到新文件夹，再运行 TogetherWatch.exe，不要只复制 exe。

给其他设备发布：把 `TogetherWatch-Client-Updates-20261108.zip` 上传至服务器 `/home/ubuntu/`，然后分两段执行。任一命令报错就停止；保留原有安装包和历史数据。

第一段解压到新目录，不覆盖旧文件：

```bash
mkdir /home/ubuntu/together-watch-startup-updates-20261108 && unzip /home/ubuntu/TogetherWatch-Client-Updates-20261108.zip -d /home/ubuntu/together-watch-startup-updates-20261108
```

第二段发布，必须先复制安装包，再发布版本清单。`&&` 保证前一步失败后不会继续：

```bash
cd /home/ubuntu/together-watch &&
mkdir -p client-releases &&
cp -n /home/ubuntu/together-watch-startup-updates-20261108/client-releases/*.apk client-releases/ &&
cp -n /home/ubuntu/together-watch-startup-updates-20261108/client-releases/*.zip client-releases/ &&
cp -n client-releases/manifest.json client-releases/manifest.before-startup-20261108.json &&
cp /home/ubuntu/together-watch-startup-updates-20261108/client-releases/manifest.json client-releases/manifest.next.json &&
mv client-releases/manifest.next.json client-releases/manifest.json
```

检查 `https://watchtogethernow.cloud/api/client-updates/windows` 与 `/api/client-updates/android`，应分别显示 `0.6.25`、`0.3.32`，且 `available: true`。服务器会核验文件摘要，不提供损坏或不完整的包。老清单已备份，需要回退时可以恢复清单，不必删除安装包。

旧客户端（Windows 0.6.24 / 安卓 0.3.28 起）已带版本检查，会按旧版的提醒规则发现此次更新，也可手动点检查更新。更早、没有版本检查代码的安装包仍需手动更新一次。新版安装完成后不会提示重复安装同一版本。

## 验证

304 项 JS 测试、25 项相关 Python 测试、54 项 Android JVM 测试通过；安卓 lint 为 0 errors、67 warnings，签名与旧 APK 一致。Windows 实际客户端本地联测覆盖自动启动检查、未聚焦延后、稍后不重复、下次启动再次提醒、确认后才打开固定下载页、坏响应回退。Windows 成品启动、图标、预加载、播放器资源和目录规则检查通过；安卓 APK 构建、版本和签名核对通过。

未连接安卓真机，系统浏览器下载和覆盖安装还需在实际设备上确认；没有改动原有账号、观看历史或房间同步协议。
