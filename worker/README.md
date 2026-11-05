# knloop-status Worker（TypeScript）

Cloudflare Worker 同时承担：
- 每 5 分钟 Cron 检测（Globalping 主 + xxapi 并行 + uapis 预算内兜底 + 直连降级）；
- KV 存储 60 天状态（`state:v1` / `status:v2`）；
- Hono API：`GET /api/status`、`GET /data/status.json`、`GET /healthz`；
- 托管 `web/` 构建出的 Svelte 页面（Static Assets）。

## 本地开发/测试

```powershell
cd worker
npm install
npm test          # vitest：provider 解析、合并规则、聚合、采集
npm run typecheck
npx wrangler dev --test-scheduled   # 本地 Worker（KV 本地模拟）
```

触发一次 Cron（需要前端已构建到 `worker/public`）：

```powershell
# 另开一个终端
Invoke-WebRequest 'http://127.0.0.1:8787/__scheduled?cron=*/10+*+*+*+*'
Invoke-RestMethod 'http://127.0.0.1:8787/api/status'
```

## 部署

1. 安装 wrangler 并登录：`npx wrangler login`；
2. KV：`wrangler.jsonc` 的 KV binding **不写 id**，Wrangler ≥ 4.45 会在首次 deploy 时自动创建并绑定（Automatic Resource Provisioning，open beta）；如果自动创建失败，再手动 `npx wrangler kv namespace create STATUS_KV` 并把 id 填进配置；
3. 设置 Globalping token（可选，注册后额度更高）：
   ```powershell
   npx wrangler secret put GLOBALPING_TOKEN
   ```
4. 构建前端：`cd ../web && npm install && npm run build`（产物输出到 `worker/public`）；
5. 部署（会先构建 web 再 deploy）：`cd ../worker && npm run deploy`；
6. 在 Cloudflare 控制台给 Worker 绑定自定义域（例如 `status.example.com`），页面和 `/api/status` 同源；
7. 确认 Cron Trigger 为 `*/10 * * * *`（免费 5 个 trigger 之内）。

## 一次性填充 60 天测试数据

仅用于上线前把页面填满（会覆盖当前 KV 里的 `state:v1` / `status:v2`）：

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

- KV 写入：每轮 `state` + `status` 两个 key，5 分钟一轮 = 576 写/天（免费 1000/天）；
- 读取：页面每 60 秒读 `/api/status`，低流量下远低于 100,000 读/天；流量大时再上 R2/CDN；
- CPU：每轮只有少量 JSON 解析/聚合，远低于免费版 10ms；
- Globalping 失败/限流只降级，不会把服务判成 failure；uapis 只做兜底。

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
- `wrangler.jsonc` 默认不写 KV id，首次 deploy 自动创建/绑定；若团队关闭了自动 provisioning，手动创建 KV 并把 id 写进配置；
- Runtime secrets（`GLOBALPING_TOKEN`、`ADMIN_TOKEN`）在 **Settings → Variables & Secrets** 添加，不要加在 Build variables；
- 推送 `dev` 分支会自动触发构建；如果要部署到正式域名，先绑定自定义域，再把 Worker 的 production branch 设为对应分支。
