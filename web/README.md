# knloop 状态页前端（Vite + Svelte 5 + Tailwind CSS 4 + Chart.js）

消费 Worker API GET /api/status（契约见 ../docs/worker-api-contract.md），构建产物输出到
../worker/public（Worker Static Assets，已 gitignore）。

## 命令

| 命令 | 说明 |
| --- | --- |
| npm install | 安装依赖 |
| npm run dev | Vite dev server，/api 代理到 http://127.0.0.1:8787（wrangler dev） |
| npm run build | 构建到 ../worker/public（emptyOutDir: true） |
| npm run preview | 预览构建产物 |
| npm test | Vitest 单测（tests/status.test.ts，数据层纯函数） |
| npm run mock | 本地 mock：以 ../data/status.json 为 /api/status 夹具，托管 ../worker/public |
| npm run verify | Chrome headless + CDP：控制台错误、首屏数据、60 块、图表、移动端溢出 |
| npm run shots | Chrome headless + CDP 截图（screenshots/：桌面/移动/整页/loading/过期/错误/空/缓存） |

## 目录

- src/lib/status.ts：纯数据层（解析、60 天块、daily/hourly、汇总、总状态、过期判定、选中日图表、相对时间）
- src/components/：Header / WarningList / LoadingSkeleton / ErrorState / ServiceCard / StatusGrid / LatencyChart / SummarySection / Footer
- src/App.svelte：数据获取、5 分钟轮询（与 Cron 采集同频；hidden 暂停、回前台且距上次请求 ≥60s 才刷新）、localStorage 缓存、手动刷新、页头滚动隐藏
- mock-server.mjs：MOCK_ERROR=1 / MOCK_EMPTY=1 / MOCK_STALE_MINUTES=120 环境变量；运行时也可用
  GET /__mock?stale=120|error=1|empty=1|delay=5000|reset=1 切换模式（供截图脚本使用）
- scripts/verify.mjs / scripts/capture.mjs：验收与截图脚本

## 说明

- mock 会把夹具的 generatedAt 改为当前时间，并把 daily/hourly 平移到“今天/当前小时”；
  夹具采集频率约 5-7 次/天，最近 12h 常只有 1 个点，因此 mock 仅对最近 13 个整点做相邻点线性插值用于演示图表，
  生产 /api/status 不做该处理（缺失小时仍为 null，图表显示断点）。
- Windows 上 Chrome 普通窗口有约 504px 最小宽度，--screenshot --window-size=390,844 会把布局撑到 504 再裁切；
  因此 scripts/capture.mjs 用 CDP Emulation.setDeviceMetricsOverride 精确输出 390x844。
