# 免费影视导航：电影、电视剧、动漫优先

资料核验日期：2026-10-14。这批增加的是找片入口和画质依据，**不是已接入的可播放片库**。目前共有 8 个导航入口（7 个平台），保留 3 个官方搜索入口，开放影片资料从 5 部增加到 7 部。

## 哪些入口适合找什么

| 入口 / 配置 ID | 主要内容 | 免费范围与使用提醒 | 官方依据 |
| --- | --- | --- | --- |
| 1905 免费大片 / `1905-free` | 电影、部分电视剧 | 从免费栏目进入；站内还存在会员和单片付费，不能把整个站点当作免费 | [免费大片栏目](https://www.1905.com/special/pdsix/2024wlstzb/7008-fsmorevideo.html?posid=32638)、[收费服务说明](https://pay.1905.com/article/inpouragreement/) |
| 央视片库 / `cctv-library` | 电视剧、动画片 | 切换片库分类，逐集确认是否能播放；片目和地区权限可能变化 | [央视首页](https://tv.cctv.com/)、[片库](https://tv.cctv.com/yxg/index.shtml) |
| AcFun 番剧 / `acfun-bangumi` | 动漫 | 部分免费，目录也有“付费观看”；移动网页可能要求原站 APP 才能看完整番剧 | [官方番剧目录](https://m.acfun.cn/bangumilist) |
| 芒果 TV 片库 / `mango-library` | 电影、电视剧、动漫 | 进入后手动选择“免费”；本链接没有预选免费，高画质权限另看具体作品 | [带免费筛选的官方片库](https://www.mgtv.com/lib/2?channelId=2) |
| Plex 免费影视 / `plex-free` | 电影、剧集、动画 | 广告支持，不需 Plex Pass；不包含租赁片目或搜索中列出的其他平台内容。海外来源，地区片库不同，中文与字幕有限 | [免费入口](https://www.plex.tv/watch-free/)、[点播说明](https://support.plex.tv/articles/frequently-asked-questions-vod/) |
| Tubi 免费影视 / `tubi-free` | 电影、剧集、动漫 | 免费含广告，仅适用于官方支持地区；中国大陆不在该名单，不作为大陆可直接使用的保证 | [官方入口](https://tubitv.com/)、[地区与设备列表](https://tubitv.com/help-center/About-Tubi/articles/4409969055259) |
| Blender 开放动画 / `blender-films` | 动画短片、少量真人短片 | 公开成片与制作素材订阅是两回事；许可逐部核验，不能推定所有附属素材都同一许可 | [官方作品目录](https://studio.blender.org/films/) |
| 央视 4K 专区 / `cctv-4k` | 电视剧及其他节目 | 只确认官方专区存在，具体影片当前可用画质仍需在原站检查 | [官方 4K 专区](https://tv.cctv.com/4K/index.shtml) |

国内入口排在海外入口前面。没有使用数量夸大的“全网免费看”“全部免费 4K”标签，也没有导入未经逐项核验的第三方规则库。

## 4K 标记到底表示什么

本次只给以下条目添加标记：

- 央视 4K 专区：有官方栏目依据，**不是该栏目所有影片在所有设备上都能免费以 4K 播放**。
- Big Buck Bunny：官方曾公告 [4K / 高帧率版本发布](https://peach.blender.org/2013/12/high-frame-rate-4k-and-stereo-3d-release/)，[下载说明](https://peach.blender.org/download/)也区分原版与新版本。
- Glass Half：[Blender 官方电影目录](https://studio.blender.org/films/)明确提到该片的 4K 版本。

其他条目统一显示“未核验”，不是断言它们没有高清或 4K。未下载影片、未检查实际媒体码流，也未验证播放器当前输出分辨率。

[Kazumi 官方项目](https://github.com/Predidit/Kazumi)将规则聚合与 Anime4K 超分功能分开介绍。参考它的找片体验可以，但规则收录不等于获得作品许可，超分画面也不能直接标成原生 4K。本次没有修改播放器或接入超分算法。

## 新增的两部开放作品

| 作品 | 官方许可依据 | 本次记录 |
| --- | --- | --- |
| Glass Half | [项目许可页](https://studio.blender.org/projects/glass-half/pages/licensing/)：CC BY 3.0 | 提供[官方作品页](https://video.blender.org/w/dnayqfMS4PAE9pSZ3kyVUb)、署名和许可链接；有官方 4K 依据。标志、商标、非项目素材不并入授权 |
| Wing It! | [项目许可页](https://studio.blender.org/projects/wing-it/pages/licensing/)：CC BY 4.0 | 提供[作品官网](https://studio.blender.org/projects/wing-it/)、署名和许可链接；未加 4K 标记。标志、商标、非项目素材不并入授权 |

本地目录保留原来的 Big Buck Bunny、Spring、Sintel、Tears of Steel、Elephants Dream。没有增加影片文件或直播地址，没有自动把这些域名加入房间播放授权名单。

## 页面怎样筛选

- **导航类型**仅筛选上方栏目入口。选择动漫，不会把开放短片资料当作动漫站点返回。
- **片名**筛选下方本地作品资料，并更新 3 个官方平台的搜索地址；不会假装返回这些平台的实时库存，也不筛掉栏目入口。
- **画质依据**同时筛选导航和作品资料，只保留显式记录官方 4K 依据的条目。
- **清空**恢复全部类型、全部画质并清空关键词。
- 关闭 JavaScript 时，点击“查找”仍可通过服务器完成筛选。

例如 `/discover?type=series&quality=4k` 显示央视 4K 导航和两部有 4K 依据的短片资料；`type=animation&quality=4k` 的导航是空的，页面会解释原因，不会填入未经核验的站点。

## 部署和隐藏来源

当前改动在本地，未经此次提交、推送和服务器更新前，线上不会变化。发布时的服务器步骤见 [找片使用说明](SOURCE_DISCOVERY_2026-10-14.md)。页面资源版本已更新为 `20261014-free`，避免旧脚本缓存导致筛选无效。

如不想展示海外地区限定来源，可在服务器 `.env.server` 设置：

```dotenv
DISCOVERY_DISABLED_SOURCES=tubi-free,plex-free
```

随后重新创建应用容器。其余来源 ID 见上表；这项配置只隐藏导航，不改播放权限。

## 验证结果与剩余限制

- 当前工作区通过 **51 项 Python 测试、60 项 JavaScript 测试**，包括原有同步回归。工作区还含之前未提交的麦克风改动，这个数字不是独立发布快照的结果。
- 新测试覆盖：无 JavaScript 筛选、4K 证据必填、未知画质不冒充 4K、类型与关键词职责分离、空结果、清空恢复、复制失败回退、来源下架、HTML 转义，以及不改变房间和播放授权名单。
- `node --check static/js/source-discovery.js` 与 `git diff --check` 通过。
- 核验是官方网页和官方内容的搜索索引核验。部分 Blender、1905 页面直接抓取受限，使用官方页面的索引内容；未据此宣称完成影片播放测试。
- 浏览器预览此前被本机安全检查超时阻断；本次未完成桌面/手机视觉验收，也未完成安卓、Windows 客户端的各站播放验收。
- 原站登录、DRM、禁止嵌入、强制 APP、地区权限和广告会影响同看体验。两人的广告时长可能不同，应进入同一版本的正片后再同步。单纯增加导航不会解决这些播放器兼容问题。

发布后的最低验收：分别测试电影、电视剧、动漫分类；选择 4K 再清空；复制一个入口；手机与电脑打开同一集。确认当前播放和房间成员状态不会因为找片或切换筛选而被重置。
