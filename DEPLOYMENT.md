# 一起看：个人公网部署与商业化路线

当前版本采用“各自在官方页面播放，服务器只同步状态”的模式。服务器不解析、不下载、不代理第三方视频，也不接触用户的 Cookie 或会员凭据。这样既能显著降低带宽成本，也更适合作为公开服务的起点。

## 个人阶段：国内低价年付轻量服务器

如果愿意办理 ICP 备案，个人阶段优先使用：

> 腾讯云轻量应用服务器（北京地域）+ Docker CE + Caddy 自动 HTTPS

当前腾讯云轻量服务器活动页向符合条件的新用户展示 `4 核 4 GB / 3 Mbps / 99 元/年` 的境内套餐，折合每月约 8.25 元。活动资格和价格会变化，付款前以订单页为准；如果订单明显高于 15 元/月，先不要付款。

本项目不转发第三方视频。3 Mbps 只负责网页、播放状态、聊天和 WebRTC 信令，足够个人或少量朋友使用；视频仍由每个人的浏览器直接向官方视频网站加载。语音通常在成员之间直连，只有直连失败并使用 TURN 时才会消耗中继流量。

### 1. 购买服务器

从[腾讯云轻量服务器活动页](https://cloud.tencent.com/act/pro/lhsale)进入购买，不要从香港月付订单继续。建议选择：

- 地域：`北京`（主要用户在河北时延更低）
- 镜像：`Docker CE` 应用模板；没有时选择 `Ubuntu 24.04 LTS`
- 配置：优先活动中的 `4 核 4 GB / 3 Mbps / 99 元/年`；`2 核 2 GB` 也足够
- 时长：`1 年`，年付实例也满足备案所需的服务器时长
- 数量：`1`
- 自动续费：第一次测试可以先关闭，避免忘记续费

创建后记下服务器的公网 IPv4。不要把 SSH 密码发给其他人。

### 2. 准备域名和 DNS

完整功能必须使用 HTTPS，否则浏览器不会开放麦克风权限。中国大陆服务器无论通过域名还是公网 IP 对外提供网站，都应先完成 ICP 备案。腾讯云备案本身不收费，但需要一个已实名认证、支持备案的域名，并且必须如实提交网站内容和功能。

建议顺序：

1. 购买国内轻量服务器和域名，完成实名认证。
2. 在腾讯云备案控制台提交首次备案；审核通过前不要把网站公开上线。
3. 备案通过后增加 DNS 记录：

```text
记录类型：A
主机记录：watch
记录值：你的北京服务器公网 IPv4
```

假设域名是 `example.com`，最终访问地址就是：

```text
https://watch.example.com
```

如果只是想今天立刻公网测试、不想等待备案，应临时使用新加坡、日本或中国香港节点；境外节点不要求 ICP 备案，但月租和大陆访问质量可能不如境内活动服务器。

### 3. 设置防火墙

在轻量应用服务器控制台的“防火墙”中保留或新增：

| 用途 | 协议 | 端口 | 来源 |
| --- | --- | --- | --- |
| SSH 管理 | TCP | 22 | 优先限制为自己的公网 IP |
| HTTP 证书验证 | TCP | 80 | `0.0.0.0/0` |
| HTTPS / WebSocket | TCP | 443 | `0.0.0.0/0` |
| HTTP/3（可选） | UDP | 443 | `0.0.0.0/0` |

不要把应用内部的 `5000` 端口开放到公网。

### 4. 登录服务器并下载项目

在腾讯云控制台点击“登录”，进入服务器终端后执行：

```bash
git clone https://github.com/wmr1723147944-ui/together-watch.git
cd together-watch
cp .env.server.example .env.server
openssl rand -hex 32
```

最后一条命令会输出一串随机字符。复制它，然后编辑服务器配置：

```bash
nano .env.server
```

把内容改成：

```dotenv
DOMAIN=watch.你的域名
SECRET_KEY=刚才生成的随机字符
SERVICE_OPERATOR_NAME=你的真实姓名或公司名称
COPYRIGHT_CONTACT_EMAIL=你能及时处理投诉的真实邮箱
AUTHORIZED_MEDIA_HOSTS=
AUTHORIZED_PAGE_HOSTS=
WEBRTC_ICE_SERVERS=
```

个人测试阶段，两项 `AUTHORIZED_*` 建议保持空白。只有你能留存自有权利证明或有效书面授权时，才填写媒体或网页域名；不要把免费视频站、会员媒体域名或临时播放地址加入白名单。

ICP备案后的正式站点若要增加自有或获授权媒体，不必手工编辑环境文件，也不必逐条登记视频。把媒体域名或一条完整直链交给管理脚本即可：

```bash
python3 scripts/manage_media_hosts.py --env-file .env.server add https://media.example.com/video/movie.mp4 --confirm-rights
sudo docker compose --env-file .env.server up -d --force-recreate app
```

脚本只记录域名，并拒绝本机/IP地址和已知官方视频平台。使用 `python3 scripts/manage_media_hosts.py --env-file .env.server list` 查看当前规则，使用 `remove 域名` 移除授权到期或被投诉的来源。

按 `Ctrl+O`、回车保存，再按 `Ctrl+X` 退出。`.env.server` 已被 Git 和 Docker 忽略，不会上传到 GitHub，也不要把它截图公开。

### 5. 一条命令启动

如果购买的是 Docker CE 模板，执行：

```bash
docker compose --env-file .env.server up -d --build
```

如果提示无权限，在命令前加 `sudo`。第一次启动需要下载 Python 和 Caddy 镜像。Caddy 会在 DNS 生效后自动申请 HTTPS 证书，并自动支持 WebSocket。

查看状态：

```bash
docker compose --env-file .env.server ps
docker compose --env-file .env.server logs --tail=100
```

两个服务都应处于运行状态。随后访问：

```text
https://watch.你的域名/health
```

应看到 `"status": "ok"`、`"compliance_mode": true`、`"legacy_media_pipeline": false` 和 `"companion_archive": true`。正式开放前还应确认 `"public_launch_ready": true`。

### 6. 在 Windows 上完成公网验收

回到本地 `D:\视频共享`，执行：

```powershell
.\.venv\Scripts\python.exe scripts\smoke_test.py https://watch.你的域名
```

脚本会检查 HTTPS、房间页、扩展安装包、两个真实 WebSocket 客户端、播放同步和房间权威状态。

### 7. 后续更新

以后本地代码推送到 GitHub 后，在服务器执行：

```bash
cd together-watch
git pull --ff-only
docker compose --env-file .env.server up -d --build
```

Caddy 的证书保存在 Docker 数据卷中，不要执行 `docker compose down -v`，否则会一并删除证书数据。

## Render 作为备用方案

仓库仍保留 `render.yaml`，因此将来有可用国际支付方式或账号不再要求银行卡验证时，仍可部署到 Render。面向中国大陆的低成本主方案是备案后的境内轻量服务器；境外平台只作为免备案测试备用。

## 语音通话：TURN 是公网可靠性的关键

默认只有 STUN。普通家庭网络之间往往能直连，但公司网络、校园网、对称 NAT 或严格防火墙下，语音可能失败。页面现在会明确提示 TURN 是否缺失，`/health` 也会返回 `turn_configured`。

个人测试可以申请一个托管 TURN 服务，把它提供的地址、用户名和密码写进服务器的 `.env.server`。不要把真实凭据提交到仓库。格式示例：

```json
[
  {"urls":"stun:你的服务域名:3478"},
  {"urls":"turn:你的服务域名:3478?transport=udp","username":"替换我","credential":"替换我"},
  {"urls":"turn:你的服务域名:3478?transport=tcp","username":"替换我","credential":"替换我"},
  {"urls":"turns:你的服务域名:443?transport=tcp","username":"替换我","credential":"替换我"}
]
```

保存后重新执行 `docker compose --env-file .env.server up -d`。再次访问 `/health`，确认 `turn_configured` 为 `true`。随后至少用两种不同网络实测，例如一台设备连接家庭宽带，另一台使用手机流量。

托管 TURN 的免费额度一般只适合短时测试。商业阶段应使用离主要用户更近的 TURN 节点、短期动态凭据和流量告警。语音会消耗 TURN 流量，视频本身不会经过 TURN。

## 个人版验收标准

上线前至少完成这些检查：

- 公网首页和房间页能通过 HTTPS 打开。
- 冒烟脚本所有检查通过，包括两个真实 WebSocket 客户端和权威房间状态。
- 两台设备使用不同网络，连续观看 30 分钟；播放、暂停、拖动和缓冲恢复都能重新对齐。
- 官方页面双方打开同一集、同一版本；扩展角标显示“✓”。
- 语音测试覆盖直连和 TURN 中继，通话过程中视频声音不变调。
- `/health` 显示旧媒体解析链路关闭、授权媒体域名规则数量正确、扩展安装包存在。
- 首页可以打开用户协议、隐私政策和版权投诉页面；用户未确认协议时不能进入房间。
- 任意第三方 MP4/M3U8 地址会被拒绝；只在确有自有权利或书面授权时配置 `AUTHORIZED_MEDIA_HOSTS`。

## 商业部署：按用户量逐步升级

### 第一阶段：小范围内测

- 保留固定境内实例、备案域名和 HTTPS，根据实测升级带宽、CPU 与内存。
- 增加账号、邀请口令、房主权限、封禁和限流，避免公开房间被滥用。
- 把房间事件和状态放入 Redis；用户、套餐、订单和投诉记录放入 PostgreSQL。
- 接入错误监控、延迟指标、WebSocket 在线数、TURN 流量和成本告警。
- 继续保持“只同步控制状态，不解析和分发影视内容”的产品边界。

### 第二阶段：多人和规模化

单个进程现在可以承载个人或小范围测试，但不能通过简单增加 Gunicorn worker 横向扩容。扩容前需要：

- Socket.IO 使用 Redis 消息队列跨实例广播。
- 房间权威状态从进程内存迁移到 Redis，并增加版本号或事件序列，防止乱序覆盖。
- 负载均衡开启 WebSocket，并验证滚动发布时的断线重连与状态恢复。
- 语音超过约 4～6 人后，由当前 Mesh 改成 SFU，例如 LiveKit 或 mediasoup；否则每个人的上行带宽和连接数会快速增加。
- 根据主要用户分布部署多区域接入、TURN 和监控。中国大陆业务应优先实测三大运营商，而不是只看云厂商机房名称。

### 第三阶段：收费或广告

- 在接广告或收费前，按实际运营主体复核现有用户协议、隐私政策和投诉页，配置真实联系邮箱，并补齐设备信息说明、未成年人保护、投诉处理时限与留档流程。
- 在中国大陆使用境内服务器和域名时，办理适用的 ICP 备案；如果业务属于经营性互联网信息服务或其他增值电信业务，进一步确认许可证要求。
- 广告需要清晰标识，建立广告主和素材审核、违法广告处置及留档流程。
- 遵循个人信息最小化：聊天、麦克风状态、IP、设备信息和日志只收集业务确实需要的部分，并明确保存期限、删除机制和权限控制。
- 在正式商用前，请让熟悉互联网内容、广告和数据合规的专业人士按实际经营模式复核。以上是工程清单，不替代法律意见。

## 推荐的成本顺序

1. **现在：** 境内活动轻量服务器（目标 99 元/年）+ ICP 备案 + Docker Compose + Caddy + 默认 STUN。
2. **语音验证：** 增加靠近主要用户的托管 TURN，仅供少量个人通话。
3. **稳定内测：** 在现有服务器旁增加 Redis/PostgreSQL，或迁移到托管数据库。
4. **用户增长后：** 多实例、SFU、多区域 TURN、监控和合规投入。

不要在个人阶段自建视频转码或代理集群。那会立刻增加带宽、存储、版权和运维成本，却不会改善官方页面模式下的观影同步。
