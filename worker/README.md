# knloop-status Worker（TypeScript）

Cloudflare Worker 同时承担：
- 每 5 分钟 Cron 检测（Globalping 主 + xxapi 并行 + uapis 预算内兜底 + 直连降级）；
- D1 存储 60 天状态（`status_store` 表，两行：`state:v1` / `status:v2`；KV 已彻底移除）；
- Hono API：`GET /api/status`、`GET /data/status.json`、`GET /healthz`；
- 托管 `web/` 构建出的 Svelte 页面（Static Assets）。

## 本地开发/测试

```powershell
cd worker
npm install
npm test          # vitest：provider 解析、合并规则、聚合、采集
npm run typecheck
npx wrangler dev --test-scheduled   # 本地 Worker（本地 D1 模拟）
```

本地触发一次采集（需要前端已构建到 `worker/public`）：

```powershell
# 另开一个终端；给本地 Worker 一个 ADMIN_TOKEN（示例值仅本地使用）
npx wrangler dev --var ADMIN_TOKEN:test

Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/api/admin/run' -Headers @{ Authorization = 'Bearer test' }
Invoke-RestMethod 'http://127.0.0.1:8787/api/status'
```

> 注意：`/__scheduled?cron=...` 会被 Static Assets 的 SPA fallback 拦截，不会进入 `scheduled` 处理器；
> 新版 Wrangler 用 `Invoke-WebRequest 'http://127.0.0.1:8787/cdn-cgi/local/scheduled'` 触发本地 Cron（生产环境的 Cron Trigger 不受影响）。

## 部署

1. 安装 wrangler 并登录：`npx wrangler login`；
2. **D1（主存储）**：`wrangler.jsonc` 的 D1 binding **不写 database_id**，Wrangler ≥ 4.45 会在首次 deploy 时自动创建/绑定（Automatic Resource Provisioning，open beta），自动创建的库名通常是 `knloop-status-status-db`（`<Worker 名>-<binding 名>`）；如果自动创建失败（例如 Workers Builds 的 token 没有建库权限、或账号关闭了自动 provisioning），手动 `npx wrangler d1 create knloop-status` 并把 `database_id` 填进配置。建表由 Worker 首次访问时懒执行（`CREATE TABLE IF NOT EXISTS`），不需要手动跑 migration；
   KV 已彻底移除（配置/代码/测试都不再引用）。新部署的 D1 从空库开始：首次 Cron 后才有数据，之前的 `/api/status` 返回 503；
   如需立刻填满页面，用下面的 `/api/admin/seed`。旧 KV namespace 里的历史数据不会再被读取，需要的话请先在 Dashboard 导出；
3. 设置 Globalping token（可选，注册后额度更高）：
   ```powershell
   npx wrangler secret put GLOBALPING_TOKEN
   ```
4. 构建前端：`cd ../web && npm install && npm run build`（产物输出到 `worker/public`）；
5. 部署（会先构建 web 再 deploy）：`cd ../worker && npm run deploy`；
6. 在 Cloudflare 控制台给 Worker 绑定自定义域（例如 `status.example.com`），页面和 `/api/status` 同源；
7. 确认 Cron Trigger 为 `*/5 * * * *`（免费 5 个 trigger 之内）。

部署后 1 分钟内验证缓存层是否生效：

```powershell
# 连续两次请求：第一次可能 x-knloop-cache: db，第二次（15 秒后）应为 edge / memory，且不再查 D1
curl.exe -sI https://<你的域名>/api/status | Select-String 'x-knloop-cache|cache-control|etag'
curl.exe -sI https://<你的域名>/healthz | Select-String 'cache-control'
```

- `/healthz` 应返回 `{ok:true,now,hasDb}` 且 `cache-control: no-store`；
- 首次部署后到 Dashboard → Worker → **Settings → Bindings** 确认 `STATUS_DB` 已绑定（自动创建的 D1 名可能是 `knloop-status-status-db`）；
- 若 `x-knloop-cache` 长期只有 `memory`/`db`、没有 `edge`，说明 Cache API 没有生效：
  确认访问的是**自定义域**（不是 workers.dev / 预览 URL），且 Worker 前面没有 Cloudflare Access。

## 一次性填充 60 天测试数据

仅用于上线前把页面填满（会覆盖当前 D1 里的 state / status 两行）：

1. Worker 设置运行时 Secret `ADMIN_TOKEN`；
2. 调用：

```powershell
Invoke-RestMethod -Method Post `
  -Uri 'https://<你的域名>/api/admin/seed?force=1' `
  -Headers @{ Authorization = 'Bearer <ADMIN_TOKEN>' }
```

返回示例：

```json
{ "ok": true, "services": 4, "days": 60, "checks": 68328 }
```

数据写入后，正常的 5 分钟 Cron 会继续在今天的 `currentDay` 上追加真实检测；如果不再需要这个接口，移除 `ADMIN_TOKEN` 即可让它返回 404。

## 手动触发一次采集（可选）

设置 secret `ADMIN_TOKEN` 后，可以手动触发一次采集（用于首次部署/排查，不影响 Cron）：

```powershell
npx wrangler secret put ADMIN_TOKEN
Invoke-RestMethod -Method Post -Uri 'https://<你的域名>/api/admin/run' -Headers @{ Authorization = 'Bearer <ADMIN_TOKEN>' }
```

未设置 `ADMIN_TOKEN` 时该路由返回 404。

## 配置

服务列表与 provider 开关在 `src/config.ts`：
- `globalping.locations`：默认 CN + US 各 1 个 probe，4 个服务 × 2 地区 × 12 次/小时 = 96 probes/小时（匿名额度 250/小时）；
- `xxapi.enabled`：与 Globalping 并行，作为 ping 可达性佐证；
- `uapis.dailyCap`：默认 30 次/天（uapis 免费额度 1500/月），只在 Globalping 异常/失败时调用；
- `direct`：Worker 直连降级；
- `retentionDays`：默认 60 天。

## 数据/额度

### 主存储：D1（KV 已完全移除）

- **写**：Cron 每 5 分钟一轮，一次 `batch` 写 `state` + `status` 两行 = **576 行写/天**
  （D1 免费 100,000 行写/天，约 0.6%）；写入失败只记录日志，不阻断 Cron；
- **读**：`/api/status` 走三级缓存——isolate 内存 15 秒 → Cache API 按数据新鲜度（6 分钟窗口）→ D1 主键查询。
  缓存命中不查 D1；每个有流量的数据中心约 **250–290 行读/天**（每 5–6 分钟一次），Cron 每轮 `loadState` 另有 1 行读（288/天），
  相对免费额度 5,000,000 行读/天可忽略；**D1 查询失败/空值后有 60 秒退避**，故障期间不会每个请求都重试；
- **KV**：已从 `wrangler.jsonc`、`Env`、代码与测试中完全移除，线上 KV 操作 0；
- `/healthz`、`/api/health` **完全不查数据库**（只返回 `{ok,now,hasDb}`），外部监控不消耗任何存储额度；
- **兜底**：D1 查询失败时，返回缓存里 24 小时内写入的旧数据（最多回退 6 小时），带 `X-Knloop-Stale: 1`，页面不白屏；
- **CPU**：每轮只有少量 JSON 解析/聚合，远低于免费版 10ms；
- Globalping 失败/限流只降级，不会把服务判成 failure；uapis 只做兜底。

### D1 免费版限制（2026-10 文档）

| 项目 | Workers Free |
| --- | --- |
| 行读（rows read） | 5,000,000 / 天 |
| 行写（rows written） | 100,000 / 天 |
| 存储 | 5 GB（单库上限 500 MB） |
| 数据库数量 | 10 / 账号 |
| 单行大小 | 2 MB |
| 重置时间 | 每天 UTC 00:00（北京时间 08:00） |

- 参考：[D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/) ｜ [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)；
- D1 免费额度包含在 Workers Free 计划里，**不需要单独订阅**；当前项目用量约为写额度 0.6%、读额度约 0.01%；
- 单行 2 MB 上限没问题：当前 `state` JSON 约 300 KB、`status` JSON 约 150 KB；
- 页面本身还受 Workers 免费版 **100,000 请求/天** 限制（账号级）；前端轮询 5 分钟后单标签页 288 请求/天；
- 不要为了省存储开启 **Workers Caching**（`cache.enabled`）：缓存命中仍按请求计费、静态资源也会计费；
  本项目缓存全部在 Worker 内部用 Cache API 完成；
- **Cache API 依赖自定义域**：只有绑定自定义域的 Worker（以及 Pages Functions）才有可用的缓存操作。workers.dev、Playground/预览、
  以及被 Cloudflare Access 前置的 Worker 上 Cache API 不生效，会退化成只剩 isolate 内存（`X-Knloop-Cache` 一直是
  `memory`/`db`），此时每个标签页每 5 分钟仍会查一次 D1（288 行读/天/标签页，仍远低于免费额度，只是延迟更高）。
  上线后请按上面的“部署后验证”检查一次；
- 历史复盘（为什么从 KV 换到 D1、KV 账号级限额、GitHub 仓库存储方案对比）见 [`docs/kv-quota.md`](../docs/kv-quota.md)。

## Cloudflare Workers Builds（Git 自动部署）

在 Cloudflare 控制台 **Workers & Pages → 你的 Worker → Settings → Builds** 连接 GitHub 仓库后，按下面配置：

| 设置 | 值 |
| --- | --- |
| Git branch | `dev`（或你合并后的 `main`） |
| Root directory | `worker` |
| Build command | `npm ci && npm --prefix ../web ci && npm --prefix ../web run build` |
| Deploy command | `npx wrangler deploy` |
| Worker 名称 | 必须与 `wrangler.jsonc` 的 `name`（`knloop-status`）一致，否则构建会失败 |

说明：
- Root directory 设为 `worker` 后，Workers Builds 会自动在 `worker/` 执行 `npm ci`；上面的 build command 再安装 `../web` 依赖并构建到 `worker/public`；
- `wrangler.jsonc` 的 D1 binding 默认不写 database_id，首次 deploy 自动创建/绑定；若团队关闭了自动 provisioning，手动创建 D1 并把 database_id 写进配置；
- Runtime secrets（`GLOBALPING_TOKEN`、`ADMIN_TOKEN`）在 **Settings → Variables & Secrets** 添加，不要加在 Build variables；
- 推送 `dev` 分支会自动触发构建；如果要部署到正式域名，先绑定自定义域，再把 Worker 的 production branch 设为对应分支。
