# 安卓 0.3.37：视频识别回归修复与选集目录复用

## 已确认的视频识别错误

0.3.35 / 0.3.36 的 `mediaScanScript()` 把带注释及换行的 `media-discovery.js` 接在 `function(){return ` 后面。JavaScript 自动插入分号，导致函数返回 undefined；后面的集数校验读取 candidates 时抛错。所有经过该检查的来源都会受影响，甚至还没执行到确认集数。

之前测试的是单独脚本和另写的箭头函数包装，漏掉了实际 Android Java 拼接。现在把生成器移到 `WebPlayerScripts.mediaScan()`，用括号包住完整表达式。本次 Chromium 回归直接编译、调用生产 Java 生成器：旧包装明确报错，新包装能够识别视频，并保留防止错集、串集的校验。

## 选集失败／超时

完整的本地 `/discover?picker=1` 页面、CSS、安卓队列、结果归一化和选集 DOM 已联测；看剧 AI、七味网、233 动漫的测试目录均可显示。未在用户手机上复现原站请求超时，不能声称所有原站读取问题已根治。

改进：首次在选片页成功读到的原生目录，按来源及影片 ID 暂存在进程内（最多 8 部、15 分钟）。看剧 AI、七味网、233 动漫在播放中再次选集时优先复用，不必每次重新请求原站。只保存公开标题、集数 ID，不保存媒体地址、Cookie、账户或令牌；不同来源或影片不混用。APP 退出后缓存清除。

选集顶部“重试”跳过缓存和当前播放页，重新读取原站；下一集未在保留目录中找到时，也走新请求。首次读取失败且没有目录时，仍保留失败提示和手动重试，不编造集数。

2026-11-11 的公开页面抽查中，当前测试网络下看剧 AI 首页未加载出可选影片，233 动漫出现 ERR_CONNECTION_CLOSED；这不等同于用户设备的网络状况，也不能据此认定网站已永久不可用。

## 检查

- 260 项共享 JS、62 项桌面单元测试、21 项安卓项目检查通过。
- 68 项安卓 JVM 测试通过；lint 0 errors / 68 warnings。
- 生产 Java 生成脚本 + 真实 Chromium 可解码视频：看剧 AI、七味网、233 动漫、茶杯狐、樱花的本地页面样例通过。
- 保留验证：目录提前更新、视频延迟切换、错误的最后一集、重复高亮均不会误交给内置播放器。
- 目录复用覆盖：来源／影片隔离、过期、容量限制、空结果不覆盖成功结果、仅保留公开字段。
- 无安卓真机连接；本次浏览器回归不是 Android WebView 真机测试。

## 安装

先在本人手机覆盖安装 `.review-artifacts/releases/TogetherWatch-Android-0.3.37.apk`，不要卸载旧版。确认版本后，重新从搜索选一集，检查能否识别视频；再打开“选集换源”，测试下一集、关闭面板和全屏返回。

versionCode 42，签名与 0.3.36 一致。APK SHA-256：`5cb4d2c81f1d13cf46665c713f24ae53aacc9abde61ff96eea36b990feb55ba6`。

修复在 APK 内，不需要重建服务器或更新 Windows。建议手机验证后再发布给其他用户。

## 可选：发布更新提醒

`.review-artifacts/releases/TogetherWatch-Android-0.3.37-publish.zip` 只含 APK 和版本清单，尚未上传。清单沿用 Windows 0.6.25；如果服务器已发布更高的 Windows 或安卓版本，不要用旧清单覆盖。

上传到 `/home/ubuntu/` 后在服务器逐行执行，报错就停止。上传 ZIP 本身不等于发布。

```bash
cd /home/ubuntu/together-watch
unzip -o /home/ubuntu/TogetherWatch-Android-0.3.37-publish.zip -d /home/ubuntu/android-update-0.3.37
cp -a --backup=numbered client-releases/manifest.json client-releases/manifest.backup.json
cp /home/ubuntu/android-update-0.3.37/client-releases/TogetherWatch-Android-0.3.37.apk client-releases/
cp /home/ubuntu/android-update-0.3.37/client-releases/manifest.json client-releases/manifest.next.json
mv client-releases/manifest.next.json client-releases/manifest.json
curl -fsS https://watchtogethernow.cloud/api/client-updates/android
```

接口返回 `available: true`、`version: 0.3.37` 表示发布成功，无需重启服务。手机仍需下载并确认安装，不会静默更新。
