# 手机下载页美化

本次修改服务器的 `/downloads` 网页，不更换安装包，也不修改客户端版本号。

- 使用「陪伴」图标、暖白底色和珊瑚橙按钮，安卓下载入口优先展示。
- 版本、大小、更新说明及校验值仍来自服务器已校验的安装包，不写死版本。
- 更新说明、文件校验和 Windows 下载入口可以展开；安卓安装步骤独立展示。
- 安装包缺失、损坏或未发布时，只显示提示，不提供假的下载入口。
- 页面不依赖 JavaScript、外部字体或远程图片；保留覆盖安装及签名不一致时的安全提醒。

## 检查

`tests.test_client_updates`：8 项测试通过，包含实际文件哈希、分段下载、无效 manifest、说明转义、双平台排序和单平台缺失。

`desktop-app/tests/downloads-ui-smoke.cjs`：真实 Flask 模板和 Chromium 渲染，使用本地测试版本信息。检查 320、390、430、1280 像素宽度、首屏下载入口、折叠展开、150% 缩放、缺少安装包及无第三方请求。截图保存在 `.review-artifacts/downloads-ui/`，截图中的测试版本不代表已发布。

运行页面检查（Windows PowerShell）：

```powershell
cd D:\视频共享\desktop-app
$env:TW_SMOKE_PYTHON='D:/python3.14/python.exe'
.\node_modules\electron\dist\electron.exe tests/downloads-ui-smoke.cjs --headless --disable-gpu
```

## 服务器更新

提交推送不会自动部署。服务器上逐行执行；任意一行报错就先停止。重建 app 会让现有房间短暂断开。

```bash
cd /home/ubuntu/together-watch
git pull --ff-only
sudo docker compose --env-file .env.server up -d --build app
sudo docker compose --env-file .env.server ps
```

更新后在手机浏览器重新打开 `https://watchtogethernow.cloud/downloads`。无需重新安装安卓 APP，也无需覆盖 `client-releases/manifest.json` 或再次上传安装包。
