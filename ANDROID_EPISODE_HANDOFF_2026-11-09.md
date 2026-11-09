# Android 0.3.35：切集与实际视频的交接核对

用户反馈：全屏点击下一集，选集目录显示第 5 集，视频却播放最后一集。

代码中原来只在准备阶段确认一次集数，之后连续两次发现同一个可见视频就会接管；最后交接也没有重新检查目录、媒体地址及房间版本。这允许原站恢复默认集、目录高亮先变化而视频后变化等异步过程串集。

## 本次处理

- 在确认集数前观察原站已有视频，隔离已经识别为其他集的视频地址。
- 每次扫描都核对公开目录中的当前集数与房间所选集数。同名影片、不同集数或多个不同高亮标记不能混用。
- 视频和集数稳定后才允许接管；看剧 AI 的公开加载中标记仍显示时继续等待。
- 看剧 AI 恢复到另一集时，只点击所选集数的公开按钮，并等待后续状态确认；不把点击本身视为播放成功。
- 真正交给内置播放器前再次读取当前视频，丢弃旧页面、旧房间版本及过期线路的回调。手动选择内置线路同样检查。
- 观看历史采用这次交接确认到的集数，避免沿用前一次异步历史采样。
- 已确认的临时 blob 播放器仍可手动保留在原网页；不把网络列表里的最后一个地址当作正片。

所有检查只在手机本地进行，不增加私有接口请求，不传输视频令牌或账号 Cookie。没有改为自动打开带广告的原网页。

## 检查范围

- 256 项共享 JS 测试、62 项 Windows 单元测试、21 项 Android 项目检查通过。
- 58 项安卓 JVM 测试通过；lint 为 0 errors、68 warnings，与上版一致。
- 真实 Chromium DOM 与可解码视频联测：目录从最后一集切到第 5 集、视频延迟换源、最后交接前又恢复默认集、重复高亮标记。
- 用倒序 30 集目录确认第 4 集下一集是第 5 集，不按列表第一项或最后项猜测。
- 对茶杯狐、樱花动漫、七味网、233 动漫的公共集数身份做了相同边界的模拟测试，不代表这些站点所有影片都已在线实测。

用户没有提供具体片名和链接，未连接安卓真机，因此不能声称已复现并验证用户那一集。请覆盖安装后复测全屏第 4 → 5 → 6 集，并核对实际剧情和历史集数。

## 安装与发布

本地生成：

- `.review-artifacts/releases/TogetherWatch-Android-0.3.35.apk`，versionCode 40，与本地 0.3.34 签名一致，可直接覆盖安装，不要卸载。
- APK SHA-256：`c0881b79a0e1dd18b945bcdc28e2547a4600d5b83dc1cf4e5e41252e06b69121`。
- `.review-artifacts/releases/TogetherWatch-Android-0.3.35-publish.zip`，仅含新版 APK 和版本清单。清单沿用服务器已有 Windows 0.6.25，不需要重新上传 Windows 包。

修复在 APK 内，Windows 无需换包，服务器无需代码更新。Git 推送不会自动上传安装包。发布包尚未上传；如需其他用户收到提醒，将 ZIP 上传到 `/home/ubuntu/`，然后在服务器逐行执行，报错就停止：

```bash
cd /home/ubuntu/together-watch
unzip -o /home/ubuntu/TogetherWatch-Android-0.3.35-publish.zip -d /home/ubuntu/android-update-0.3.35
cp -a --backup=numbered client-releases/manifest.json client-releases/manifest.backup.json
cp /home/ubuntu/android-update-0.3.35/client-releases/TogetherWatch-Android-0.3.35.apk client-releases/
cp /home/ubuntu/android-update-0.3.35/client-releases/manifest.json client-releases/manifest.next.json
mv client-releases/manifest.next.json client-releases/manifest.json
curl -fsS https://watchtogethernow.cloud/api/client-updates/android
```

看到 `available: true`、`version: 0.3.35` 即发布成功，无需重启。若服务器已经发布比 0.3.35 / Windows 0.6.25 更高的版本，不要用这份旧清单覆盖。
