# 首页与详情页美化 · 2026-11-01

## 本次调整

- 电脑：主推荐与右侧选片栏并排，常见宽度下每排展示 6 张封面。
- 首页：统一字体与圆角，弱化边框；竖海报完整展示，背景仅用于营造颜色氛围。
- 增加上一部、下一部预览按钮；只换预览，不自动播放、不打开房间。
- 手机：横滑选片，按钮切换后让选中的缩略图进入可视区域，不滚动整个页面。
- 详情页：放大海报、调整片源标签与选集间距；手机详情面板铺满可用屏宽并贴合底部。
- 不修改片源、播放、同步、登录或账户数据逻辑。

## 更新步骤

本次不需要新的 Windows 安装包或安卓 APK。网页更新后，现有客户端会加载新界面。

在 Ubuntu 服务器终端逐行执行：

```bash
cd ~/together-watch
git pull --ff-only
sudo docker compose --env-file .env.server up -d --build app
sudo docker compose --env-file .env.server ps
```

任何一步报错都先停止。看到 app 状态为 healthy 后，完全退出并重新打开客户端。
普通浏览器可用 Ctrl+F5 刷新。代码推送并不会自动部署服务器。

## 检查与限制

使用本地测试片单进行真实 Chromium 渲染，检查搜索、分页、选集、返回、预览切换、
横竖封面和 320 至 1920 像素的屏幕宽度。
预览图片不是生产环境片单，也不表示这些影片已验证可播放。
手机检查使用窄屏渲染，未进行安卓真机检查。

检查脚本：

- `node --test tests/*.test.cjs desktop-app/tests/*.test.cjs`
- `python -m unittest discover -s tests -p "test_*.py"`
- `desktop-app/tests/catalog-layout-smoke.cjs`
- `desktop-app/tests/spotlight-ratio-smoke.cjs`

截图保存在本地 `.review-artifacts/cinema-polish/`，不作为产品素材提交。
