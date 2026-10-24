# 封面修复与两站下架：Windows 0.6.8 / 安卓 0.3.7

## 已修复

- 七味网：公开页面的部分封面使用 `i1.vvmp4.com`，旧图片域名规则漏掉了它。
- 看剧 AI：公开搜索卡片使用 `gimg0.baidu.com` 包装的固定格式图片地址，旧规则将其过滤为 `null`。
- Python、共享 JavaScript 和网页图片 CSP 已对齐。只接受观察到的看剧图片路径，不开放任意代理地址、内网地址、凭据或视频 URL；不放宽脚本与播放权限。
- 七味网中文安全页“请稍候… / 正在进行安全验证”以前被当作普通加载失败，现在能识别为需要用户验证；没有代做验证。

## 验证

- Node 回归 155 项、Python 回归 130 项通过。
- 安卓 16 项 Java 测试通过，APK 构建、签名验证通过，lint 为 0 错误、37 警告。与上一版本地 0.3.6 APK 的签名证书相同；尚未进行安卓真机验收。
- Windows 包完整性检查、首页选片与邀请流程检查通过；Windows ASAR 和安卓 APK 中的封面读取脚本均与共享源码一致。
- 本地 Electron 页面回归通过：下架来源不显示，搜索、推荐分页、分类、切换片源、选集、封面失败占位及 320/390/1440 宽度检查正常。使用本地元数据样例，不代表第三方视频已验证可播。
- 看剧 AI 真实公开搜索“三体”：修改前 12 条结果的封面均被过滤；修改后 12 条结果均保留封面。
- 两个站点的封面样例请求均返回 HTTP 200，类型分别为 JPEG / WebP。
- 七味网实时搜索本次返回安全验证页，未完成实时搜索到播放的全链路验证。其图片格式由以前保存的公开页面和本次图片请求共同核对。
- `desktop-app/tests/live-cover-diagnostic.cjs` 是可选、只读的实时检查。使用临时会话，不读取用户登录信息，不点击验证或视频；可用 `TW_DIAG_SOURCE` 限定检查来源。默认不在单元测试中运行。

## 低端影视：按用户要求移除

用户反馈 Windows、安卓播放均转圈，并明确要求移除；本批不再继续排查或替换为其他同名网址，也不宣称播放问题已修好。

- 从搜索来源、首页推荐、详情选片、新建房间入口撤下 DDYS。
- 搜索、详情、推荐接口和旧选片跳转均拒绝新的 DDYS 请求，不会继续请求该站。部署环境清空禁用列表也不会将其重新启用。
- 搜索示例不再引用该站的封面，其他来源不受影响。
- 保留旧身份解析供历史记录兼容，不删除已有房间，也不自动把旧房间改为其他影片。
- 补充接口、页面、建房回归；本地 UI 测试改用仍启用的来源，不在测试中重新启用已下架来源。

## 风车动漫：按用户要求移除

风车动漫也按用户要求撤下：用户反馈频繁跳转其他网址。`fcma` 与 `ddys` 一样不再出现在搜索、推荐、选片入口；旧的服务器选片入口返回 404，新建房间、搜索和详情请求被拒绝，且不会发起原站请求。保留已有房间记录，不把移除入口描述为已修复原站跳转或全客户端网址拦截。

## 你需要做什么

推送代码不等于服务器已更新。按交付回复确认代码已推送后，依次更新服务器、Windows 和安卓；这次没有改动播放同步算法。

低端影视、风车动漫撤下主要由服务器控制，服务器部署后需刷新选片首页或重启客户端。七味网、看剧 AI 的封面修复还涉及客户端内的共享元数据规则：发布时应同步更新 Windows、安卓包中的 `catalog-adapters.js`；旧包内的规则不会仅靠服务器更新而自动改变。

### 1. 更新服务器

在 Ubuntu 服务器终端执行，不是在 Windows PowerShell 中执行。每条命令执行完成后再输入下一条；如果拉取报错，停下并保留报错内容，不要继续当作更新成功。

```bash
cd ~/together-watch
git -c http.version=HTTP/1.1 pull --ff-only
git log -1 --oneline
sudo docker compose --env-file .env.server up -d --build app
sudo docker compose --env-file .env.server ps
```

`git log` 的提交号应与交付回复一致；容器 `app` 最终应显示 `healthy`，若刚启动仍在检查，稍后再次执行最后一条即可。确认来源清单：

```bash
curl -fsS https://watchtogethernow.cloud/api/discover/sources
```

返回的 `version` 应为 `20261024-source-cleanup`，`sources` 中不应有 `ddys` 或 `fcma`。只有版本号正确还不够，需同时确认这两个来源已消失。

### 2. 更新 Windows

1. 完全退出旧版“一起看”。
2. 将 `desktop-app/dist/TogetherWatch-Windows-0.6.8-source-cleanup-x64.zip` 解压到一个新文件夹。
3. 打开里面的 `TogetherWatch-win32-x64/TogetherWatch.exe`；不要只把 EXE 单独移走。
4. 顶部版本应显示 `0.6.8`。旧程序不会自动升级，确认新包正常前先保留旧文件夹。

### 3. 更新安卓

1. 把 `android-app/app/build/outputs/apk/debug/TogetherWatch-Android-0.3.7-source-cleanup.apk` 发到手机。
2. 打开 APK，按系统提示覆盖安装，版本应为 `0.3.7`。
3. 如果提示签名冲突，不要先卸载旧版；保留错误截图。卸载可能丢失原站登录状态和房主凭据。

### 4. 验收

1. 重启两端，重新搜索一部影片，确认查询来源中没有低端影视、风车动漫。
2. 搜索看剧 AI、七味网的结果，观察封面；新规则修复的是误过滤，原站图片失效或网络失败仍可能显示占位图。
3. 七味网若实际显示验证页，仍需本人在原站验证，本次没有绕过验证。
4. 选片后邀请另一端加入，检查正常播放、暂停和返回。已打开的旧页面需刷新，已有房间不会被自动删除或换片。

### GitHub 连接失败时的离线更新

交付的 `together-watch-update-source-cleanup-20261024.bundle` 是服务器代码更新包，不是 Windows 或安卓安装包。先把它从电脑上传到服务器的 `/home/ubuntu/`，再在 Ubuntu 终端执行：

```bash
ls -lh /home/ubuntu/together-watch-update-source-cleanup-20261024.bundle
cd ~/together-watch
git bundle verify /home/ubuntu/together-watch-update-source-cleanup-20261024.bundle
git fetch /home/ubuntu/together-watch-update-source-cleanup-20261024.bundle refs/heads/main
git merge --ff-only FETCH_HEAD
git log -1 --oneline
sudo docker compose --env-file .env.server up -d --build app
sudo docker compose --env-file .env.server ps
```

先看到文件存在、`bundle ... is okay` 再继续。任何一步报错都先停下，不要删除现有项目或使用强制覆盖命令。离线包包含旧提交 `88a6ca1` 之后的更新，验证时若提示缺少前置提交，请保留报错内容。

## 安装包校验

Windows ZIP SHA256：`4D79EF6ACBEFE32ECEE79E000BC1F449149C55AEC8DB08CC1C73AFA4802DE47B`

安卓 APK SHA256：`42A139C92D5795D2666BE1B3FFE86235E32063B7C0A9CC16F84EB4CEF761A5E1`
