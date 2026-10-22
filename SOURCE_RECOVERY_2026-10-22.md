# 搜索、封面修复与 Windows 0.6.4 更新步骤

## 这次解决了什么，什么还没解决

- 华人影院是 `huarw.com`，不是 `huavod.com`。服务器访问华人失败时，Windows 0.6.4 可直接在本机读取公开搜索结果与集数。旧客户端仍使用原来的服务端查询，不会被误认为支持新接口。
- 目录已经显示但封面迟迟不加载时，不再等整页加载结束才读取片名。查询仍有超时和并发上限，不会一直占用窗口。
- 补充华人、风车公开目录实际使用的 9 个封面 CDN，仅开放图片，不开放视频、脚本或任意代理地址。封面加载失败仍能点标题选片；这不保证上游所有图片都稳定。
- 查询失败可单独重试；不能本机读取的环境保留原站搜索入口，不用重新输入片名。手动验证未完成、网络失败和明确拒绝访问分开显示。
- 七味网本次确实返回安全验证页面，验证码也可能无法正常显示。软件不自动解验证码；不能完成时请换来源。
- 风车能读到搜索与集数，但本次测试的播放页返回“Sorry, you have been blocked”。它是原站拒绝访问，不能凭目录可用就保证正片可播。

本次没有安卓原生代码修改。已有安卓 0.3.3 不用重装；封面和网页提示随服务器更新生效。**安卓没有新增 Windows 的本机目录读取能力，服务器连不上华人时，安卓统一搜索仍可能失败。** 可以使用页面提供的原站搜索入口，或选其他来源；这不等于已修好安卓所有站点播放。

## 你需要按顺序做什么

### 1. 等待这次代码推送成功

以聊天中“已推送”的回执和提交号为准。只下载 Windows 包不会更新服务器上的首页代码。推送也不会自动部署你的 Ubuntu 服务器。

### 2. 在 Ubuntu 服务器更新代码

打开腾讯云服务器终端。提示符应类似 `ubuntu@VM-0-3-ubuntu`，不是电脑上的 `PS C:\Users\Myra>`。

```bash
cd ~/together-watch
git status --short
git -c http.version=HTTP/1.1 pull --ff-only
git log -1 --oneline
```

如果出现连接失败或合并错误，先不要执行构建。把错误发给我，或者按下方离线方式更新。不要用强制重置来消除服务器上的修改。

GitHub 连接不稳定时：将交付的 `together-watch-update-source-recovery-20261022.bundle` 上传到服务器 `/home/ubuntu/`，再执行：

```bash
cd ~/together-watch
ls -lh /home/ubuntu/together-watch-update-source-recovery-20261022.bundle
git bundle verify /home/ubuntu/together-watch-update-source-recovery-20261022.bundle
git fetch /home/ubuntu/together-watch-update-source-recovery-20261022.bundle refs/heads/main
git merge --ff-only FETCH_HEAD
git log -1 --oneline
```

这个增量包要求服务器已包含上次推荐流提交 `9c32ae3`。`git bundle verify` 如果报告缺少前置提交，请停下并发回输出；不要继续合并。如果第一条 `ls` 找不到文件，说明还没上传到该位置，不是 Git 命令出问题。

### 3. 重建服务并确认新版已运行

确认上一步更新成功，再在同一个 Ubuntu 终端执行：

```bash
sudo docker compose --env-file .env.server up -d --build app
sudo docker compose --env-file .env.server ps
curl -fsS https://watchtogethernow.cloud/api/discover/sources
```

`app` 应为 `healthy`，最后的 JSON 应包含版本 `20261022-source-recovery`。若仍是旧版本，请不要反复重装客户端，先检查是否在正确目录重建了服务。接口版本正确只说明部署到位，不代表每个原站都能播放。

### 4. 更换 Windows 客户端

1. 完全退出旧的一起看客户端。
2. 解压 `TogetherWatch-Windows-0.6.4-source-recovery-x64.zip` 到一个新文件夹，保留旧版以便回退。
3. 进入解压后的 `TogetherWatch-win32-x64`，双击 `TogetherWatch.exe`。不要直接在压缩包里运行，也不要只复制 EXE；旁边的文件同样需要保留。
4. 重新打开安卓 APP 或刷新浏览器首页。已有安卓 0.3.3 无需重新安装。

本机解压目录：`desktop-app/dist/source-recovery-0.6.4/TogetherWatch-win32-x64`。

### 5. 验收

搜索一个片名，点击封面，再选择来源和具体集数。华人若首次连接失败，展开“查看查询情况”，点“打开原站并重试”；网络仍失败时换来源，不需要修改房间号。

七味网只有实际返回验证页才会要求手动验证。点击“打开原站，手动验证”，在原站自行完成；如果验证码不出现、一直被拒绝或无法通过，可关闭窗口，其他来源的结果会保留。

能正常播放后再建房、复制邀请，另一端只输入邀请或房间号加入。测试暂停、播放、跳转进度。若失败，请给出来源、片名/集数、两端版本和提示截图，这能区分原站加载失败与同步故障。

## 已做的验证

- 153 项 Node 测试、123 项 Python 测试通过。
- 本地模拟华人、233 动漫、七味网、看剧 AI 的搜索、选集、建房、邀请、播放/暂停/跳转和房主换集通过；验证码仅操作本地模拟页面，不代替用户处理真实验证。
- 封面延迟 14 秒的目录测试通过，结果不再被封面拖住。
- 桌面及 390 / 320 像素宽页面回归通过；新 EXE 的启动、内置播放器、目录规则与 IPC 来源校验通过。
- 华人真实搜索曾返回 10 个结果和正确封面，真实详情曾识别 1,180 集；复测也出现连接关闭或超时，原站可达性仍不稳定。
- 未完成这些第三方网站的正片实播与安卓真机验收。目录、封面、集数可读，不代表授权、会员要求、画质或实际播放已核实。

技术原因：Electron 的 `webContents.executeJavaScript*` 会等待页面结束加载；此次目录读取改为主进程受控的独立执行上下文，只读公开目录 DOM，不向原站暴露应用接口或关闭网页安全限制。参考 [Electron webContents 文档](https://www.electronjs.org/docs/latest/api/web-contents/) 和 [Debugger 文档](https://www.electronjs.org/docs/latest/api/debugger)。
