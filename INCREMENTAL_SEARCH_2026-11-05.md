# 安卓 0.3.26：先出结果，不等慢片源

## 这次改动

原搜索页已经会在单个来源完成后渲染，但所有来源共用两个排队名额。服务器上的慢查询可能让手机本地的看剧 AI、七味网等迟迟不能开始；安卓读到标题后，也会短暂等待封面元数据。

- 手机本地查询与服务器查询分开调度，各最多两项，慢的一边不再挡住另一边。不会一次打开所有网站窗口。
- 安卓拿到有效片名和详情入口就先回传，已出现的影片可以立即点开；随后补充封面和其他条目，不清空现有结果重新加载。
- 已出现的卡片尽量保持原位置。后续补齐年份时仍按“相同片名 + 确定年份”合并，不把不同季度或重制版猜成同一部。
- 点开首批结果会暂停其余查询，把本地查询名额让给选集。返回后保留关键词和结果；需要补查剩余来源时，再点搜索即可。
- 换关键词、返回首页或取消后，旧查询的补充结果会被丢弃，不混进新搜索。
- 只传经过校验的公开影片信息，不回传原站 Cookie、账号、网页源码，也不自动弹出验证窗口。

## 现在可以先不更新服务器吗？

可以。**代码推送不等于服务器部署，本次没有更新或重启服务器。** 等准备好后，只更新最新版本一次即可，同时带上上一批房间美化，不需要先部署上一批、再部署本批。

完整效果需要「安卓 0.3.26 + 本次服务器代码」。只装 APK、服务器还旧，不能启用完整的渐进搜索。Windows 继续使用 0.6.22，无需为本次另外下载一个 Windows 包；更新服务器后会使用新版公共搜索调度。

## 安装与一次性部署

1. 安卓将 `.review-artifacts/releases/TogetherWatch-Android-0.3.26-incremental-search.apk` 发到手机，直接覆盖安装，不要先卸载或清数据。它包含此前的房间美化。
2. 如果还没换 Windows 客户端，继续使用上一批的 `TogetherWatch-Windows-0.6.22-room-design-x64.zip`，完整解压后运行；已经是 0.6.22 的不用重装。
3. 准备好更新服务器时，在服务器终端执行：

```bash
cd /home/ubuntu/together-watch
git status --short
git pull --ff-only
```

检查拉取成功后，再运行：

```bash
sudo docker compose --env-file .env.server up -d --build app
sudo docker compose --env-file .env.server ps
curl -fsS https://watchtogethernow.cloud/health
```

等 `app` 显示 `healthy`，完全退出并重新打开两端客户端。构建重启会让正在观看的房间短暂断开，安排在不影响观影时操作。不要删除 `.env.server` 或账号数据卷，也不要使用 `down -v`。

### GitHub 连接失败

本批完整离线包：`.review-artifacts/releases/together-watch-incremental-search-20261105-full.bundle`。它已经包含上一批房间美化，不要再上传旧 bundle。

上传到服务器 `/home/ubuntu/` 后执行：

```bash
cd /home/ubuntu/together-watch
git status --short
git bundle verify /home/ubuntu/together-watch-incremental-search-20261105-full.bundle
git fetch /home/ubuntu/together-watch-incremental-search-20261105-full.bundle refs/heads/main
git merge --ff-only FETCH_HEAD
git log -1 --oneline
```

每步确认成功再继续。若有源码冲突或无法快进，保留现场，不要强制重置；合并成功后再执行上面的 Docker 更新步骤。

## 验证与限制

- 增量回传测试涵盖任务令牌、取消后的迟到结果、旧客户端四参数兼容、补封面与年份后的去重，以及先出结果时直接读取选集。
- 本地 Chromium 手机尺寸联测中，故意让两项服务器查询一直等待：安卓脚本回传的首条结果仍能显示，封面在原卡片补入，搜索未完成时也能打开选集，返回仍保留结果。
- 该联测使用真实页面与安卓打包脚本，但不等于已在实体手机或所有原站上验证。原站本身慢、被拦截或需要验证时，仍不能保证立即有结果。
- 229 项公共 JavaScript 测试、58 项 Windows 单元测试、28 项 Python 相关检查通过；安卓 30 项单元测试、`lintDebug` 和 APK 编译通过，签名与 0.3.25 一致。不改变原有视频同步协议。

开发回归：在 `desktop-app` 设置 `TW_SMOKE_PYTHON` 和 `TW_SMOKE_INCREMENTAL_SEARCH_ONLY=1`，运行 `electron . --smoke-test`。截图为 `.review-artifacts/desktop-smoke/mobile-incremental-first-result.png`；使用本地测试服务器，不连接生产房间。

安卓安装包 SHA-256：`5acb83e19206b7f4b3c12401f34adccef418506e9d5163d5ad669d4b5fcb8ae3`。
