# Worker 版 API 契约（前端用）

## 接口

- `GET /api/status`（别名 `GET /data/status.json`）→ 与仓库现有 `data/status.json` **完全相同的 schema 2**；
  - HTTP 200，`Cache-Control: public, max-age=60`，`ETag: "status-<generatedAtUnix>"`；
  - 请求头带匹配的 `If-None-Match` 时返回 **304**（无响应体）；
  - `X-Knloop-Cache: memory | edge | db | stale` 说明本次数据来源（便于排查是否真的查了 D1）；
  - D1 查询失败时若有缓存，返回旧数据并带 `X-Knloop-Stale: 1`、`Cache-Control: public, max-age=30`；
  - 完全无数据：503；D1 不可用且无缓存：500 + `Retry-After`（额度类错误指向 UTC 零点重置）。
- `GET /healthz`（别名 `/api/health`）→ `{ ok: true, now, hasDb }`，`Cache-Control: no-store`；
  **不查数据库**，外部监控高频探测不会消耗 D1 的行读额度；
- 开发环境：Vite dev server 把 `/api` 代理到 `http://127.0.0.1:8787`（`wrangler dev`）。

> 存储：D1 `status_store` 表（`key` / `value` / `updated_at` 两行：`state:v1`、`status:v2`）。
> KV 已从配置、代码与测试中完全移除；新部署的 D1 从空库开始，首次 Cron 后才有数据。

## 数据形状

```jsonc
{
  "schema": 2,
  "generatedAt": "2026-11-05T20:50:00+08:00",
  "generatedAtUnix": 1793902200,
  "retentionDays": 60,
  "services": [
    {
      "key": "ShadowQ",
      "url": "https://www.shadowq.com",
      "status": "success",              // success | partial | failure
      "latency": 216,                    // 最近一次延迟 ms，可为 null
      "lastCheckAt": "2026-11-05T20:50:00+08:00",
      "uptime": 99.72,                   // 窗口内按检查次数
      "successRate": 99.72,              // success / total * 100
      "errorRate": 0.28,                 // (partial + failure) / total * 100
      "checks": {
        "success": 1200, "partial": 3, "failure": 2, "total": 1205,
        "todayTotal": 24, "todayFailures": 0,
        "lastFailureAt": "2026-10-30T11:03:04+08:00" | null
      },
      "daily": [ ["2026-11-05", "success", 100, 216, 260, 24, 0] ],
      // [date, status, uptimePct, p50, p95, checks, failures]，升序，窗口内每天一条，nodata 补 [date,"nodata",0,null,null,0,0]
      "hourly": [ [1793901600, 216, 260] ],
      // [unixHourStart, median, p95]，升序，只含有数据的整点
      "providers": [                     // 可选，展示用
        { "name": "globalping", "ok": true, "latencyMs": 216, "detail": "4/4 probes ok" },
        { "name": "xxapi", "ok": true, "latencyMs": 204 },
        { "name": "uapis", "ok": true, "latencyMs": 3.5 }
      ]
    }
  ]
}
```

## UI 语义（沿用现有页面）

- 顶部：总状态、服务数、最后更新时间（北京时间 + 相对时间）、正常/异常/故障计数、60 天可用率、平均延迟、今日故障、最长连续正常天数；
- 每个服务：60 个日状态块（成功绿 / 异常黄 / 故障红 / nodata 灰），悬浮显示日期+状态+P50/P95/检查次数；点击某天切换图表到该天；
- 图表：最近 12 小时（`maxHour`）的每小时 P50/P95；点击某天显示该天 00:00~当前/23:00；缺失小时留 null；
- 过期判定：`now - generatedAtUnix > 45 分钟` 显示“数据可能延迟”告警，数据照常展示；
- 请求失败：显示缓存/错误提示与重试按钮，不白屏；
- 5 分钟轮询 `/api/status`（与 Cron 采集同频）；页面隐藏时暂停，回前台且距上次请求 ≥60 秒才刷新；
- 前端不再使用 `cache: 'no-store'`：允许浏览器缓存，配合 `ETag`/`304` 协商，减少无效请求和 D1 读；
- 文案保持中文，视觉延续现有页面（Maple Mono、绿#00dfa2、红#ff0060、黄#ffb84c、灰#dddddd）。

## 现有参考

- 现有数据样例：`data/status.json`（可直接复制为 mock 夹具，把 generatedAt 改成当前时间）；
- 现有页面视觉/逻辑参考：`index.html`、`src/js/app.js`、`src/js/statusModel.js`；
- 静态资源：`public/icons.svg`、`public/fonts/`（复制到 `web/public/`）。

## 构建/部署

- `web/` 用 Vite 构建，产物输出到 `../worker/public`（Worker Static Assets 目录）；
- 生产环境 Worker 同时服务页面与 `/api/status`（同源，无 CORS）；
- 开发用 `npm run dev` + 在 `web/vite.config.ts` 配置 `/api` 代理到 `http://127.0.0.1:8787`。
