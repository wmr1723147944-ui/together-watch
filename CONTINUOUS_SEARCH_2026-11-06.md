# 搜索合并与自动补查更新（2026-11-06）

## 修好了什么

- 搜索列表按完整片名合并不同来源，即使网站没给年份也只显示一张卡片。忽略全半角标点、空格、不可见分隔符，以及「第二季 / 第2季」这样的写法差异。不同季、版本和明确不同年份的翻拍不会硬合并。
- 搜索一次，各来源陆续返回，结果随到随显示。点开影片不会取消整轮搜索；同一来源的选集读取优先，暂时让出的搜索会自动恢复，其他来源继续查。
- 迟到的来源会直接补入原卡片和已打开的详情页。打开影片或播放中的选集面板后，会按完整片名自动查找其他来源，不用再按一次「查找来源」。已用完整片名查过的主搜索不会无意义重查。
- 临时网络失败自动补查两次（间隔 1.5 秒、4 秒）；验证、拒绝访问、限流不会被当作普通超时反复请求，也不会自动打开验证窗口。查完后停止，不会无限刷新原站。
- 返回首页、换关键词、关闭换源面板会取消相应任务；旧查询不能覆盖新结果。原来的结果和返回位置保留。

本次检查时，线上页面仍标记为 `20261105-incremental-search`，尚未包含上一批同名合并。**拉取代码成功不等于正在运行的 Docker 服务已经换新。** 这次新增页面和健康检查的统一版本标记，便于确认真正生效。

## 客户端

这次修复是服务器提供的页面和脚本，不改 Windows / 安卓本地程序。已经安装 **Windows 0.6.23、安卓 0.3.27** 的用户不必重复安装；服务器更新好后，彻底退出并重新打开客户端即可。

更早的客户端请使用 `SOURCE_SWITCH_2026-11-06.md` 中的安装包，播放中换源仍需要这些版本提供的桥接能力。没有自动安装客户端，也没有在本次工作中部署或重启服务器。

## 更新服务器：两种方式任选一种

先暂停正在观看的房间。重建 app 会短暂断开房间，不会删除账号、历史数据库或数据卷；不要执行 `docker compose down -v`。

### 方式 A：服务器可以连接 GitHub

在服务器终端执行：

```bash
cd /home/ubuntu/together-watch
git status --short
git pull --ff-only
git log -1 --oneline
```

有已跟踪文件修改、拉取失败或合并冲突就停下，不要强制覆盖。旧的未跟踪 `.bundle` 文件可以保留。

### 方式 B：服务器连不上 GitHub

本机文件位于 `D:\视频共享\.review-artifacts\releases\together-watch-continuous-search-20261106-full.bundle`。

把它上传到服务器的 `/home/ubuntu/`，不是项目文件夹里。然后执行：

```bash
cd /home/ubuntu/together-watch
git status --short
git bundle verify /home/ubuntu/together-watch-continuous-search-20261106-full.bundle
git fetch /home/ubuntu/together-watch-continuous-search-20261106-full.bundle refs/heads/main
git merge --ff-only FETCH_HEAD
git log -1 --oneline
```

任何一步报错就停下。不要把 `refs/heads/main:refs/heads/main` 作为 fetch 目标；当前分支由最后的快进合并更新。

### 两种方式都必须做：重建并确认生效

先检查刚更新的文件包含本次版本标记：

```bash
grep -F 'CATALOG_UI_VERSION = "20261106-continuous-search"' app.py
```

必须看到匹配行，再执行：

```bash
sudo docker compose --env-file .env.server up -d --build app
sudo docker compose --env-file .env.server ps
curl -fsS https://watchtogethernow.cloud/health
```

等 app 显示 `healthy`。健康检查 JSON 中必须出现：

```json
"catalog_ui_version": "20261106-continuous-search"
```

再检查实际发给客户端的页面：

```bash
curl -fsS https://watchtogethernow.cloud/discover | grep -F 'catalog-browser.js?v=20261106-continuous-search'
```

如果文件是新版本，但上述两项仍旧或没有输出，先不要反复重装客户端。可以用下面这条核对运行中的容器，并把输出发来：

```bash
sudo docker compose --env-file .env.server exec -T app python -c "import app; print(getattr(app, 'CATALOG_UI_VERSION', '旧版：无版本标记'))"
```

确认版本正确后，退出并重开两端客户端；网页端可用 Ctrl+F5。搜索一次「从零开始」，同一完整片名的多来源应显示在一张卡片里；不同季、特别篇和新编集版仍独立显示。搜到后可以直接点开，剩余来源继续自动补齐。

## 验证范围

- 237 个共享 JavaScript 测试、59 个 Windows 单元测试、25 个相关 Python 测试。
- 实际页面配安卓打包桥接脚本：首批结果及时显示、同名卡片合并、详情优先、搜索自动恢复、迟到来源进入当前详情、返回保留结果，以及 320 / 390 / 480 px 选集布局。
- Windows 双客户端本地联测：全屏选集、关闭不退房、房主换来源和集数、成员跟随、成员无权改片源均通过。
- 本地受控样例验证不代表所有原站目前都能连接或播放；验证码、登录和访问限制仍由网站决定，没有绕过它们。本次未连接安卓真机。
