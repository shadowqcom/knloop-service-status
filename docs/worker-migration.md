# 从 GitHub Actions + Go 迁移到 Worker（检查清单）

新架构的代码在 `worker/`（后端）与 `web/`（前端），旧的 `checkshell/`、`src/`、`index.html`、`.github/workflows/` 暂时保留作参考。切换步骤：

1. **Cloudflare 准备**：注册账号；`npx wrangler login`；D1 binding 默认不写 database_id，首次 `wrangler deploy` 会自动创建/绑定（Wrangler ≥4.45 的 Automatic Resource Provisioning）；如自动创建失败再手动 `npx wrangler d1 create knloop-status` 并填 database_id。建表由 Worker 首次访问时自动执行；KV 已彻底移除，D1 从空库开始；
2. **Globalping**：注册免费账号，`npx wrangler secret put GLOBALPING_TOKEN`（不配也能跑匿名额度）；
3. **构建/部署**：`cd web && npm install && npm run build` → `cd ../worker && npx wrangler deploy`；
4. **绑定自定义域**：Cloudflare 控制台 → Workers → 该 Worker → 自定义域（例如 `status.example.com`）；确认 `/` 与 `/api/status` 同域可访问；
   > 必须绑定自定义域：`/api/status` 的读取缓存层使用 Cache API，而 Cache API 只在自定义域的 Worker 上生效（workers.dev / 预览 / Access 前置会退化为每次轮询查一次 D1，额度仍够用但延迟更高）。
5. **验证**：
   - `GET https://<域>/healthz` 返回 `{ ok, now, hasDb }`（不查数据库，外部监控不会消耗 D1 行读额度）；
   - `GET https://<域>/api/status` 响应头有 `X-Knloop-Cache`，连续请求应从 `db` 变为 `edge`/`memory`；
   - 手动触发一次（可选）：设置 `ADMIN_TOKEN` secret 后 `POST /api/admin/run`；
   - 页面出现 3 个服务、60 个日块、Chart.js 图，`generatedAt` 随时间更新；
6. **停旧链路**：确认新站稳定后，在 GitHub 上 **Disable** 或删除 `service-status-check.yml`、`deploy-status-pages.yml`，并关闭 GitHub Pages（避免旧页面/旧数据继续更新）；
7. **清理（可选）**：确认不再需要旧实现后，再移动/删除根目录 `index.html`、`src/`、`checkshell/`、`data/`、旧 workflow；不要急着删，先保留一个版本方便回滚。

## 注意

- 旧 GitHub Actions 仍会按旧逻辑提交 `data/status.json`/`logs/`，与 Worker 的 D1 数据互不影响；但在旧页面还开着时会显示旧数据，建议切换后禁用；
- Worker 的 `worker/public` 是 `web/` 构建产物（gitignore），部署前必须先 build；
- `worker/wrangler.jsonc` 的 D1 binding 不写 database_id，首次部署自动创建；KV 已彻底移除；
- 免费版 Worker CPU 10ms/调用、Worker 请求 100k/天（账号级）；D1 免费 500 万行读/天、10 万行写/天；
  当前 5 分钟一轮、每轮 2 行写 ≈ 576 行写/天（约 0.6%），读取经缓存层后每个有流量的数据中心约 250–290 行读/天；
  详见 [`kv-quota.md`](kv-quota.md)（存储选型与额度复盘）；
- Globalping 250 probes/小时（匿名）：当前 4 服务 × 2 地区 × 12 轮/小时 = 96/小时，余量很大；uapis 免费 1500 次/月，默认仅异常时调用、日上限 30。

## Worker Builds 自动部署（GitHub → Cloudflare）

Cloudflare 控制台连接仓库后：Root directory `worker`；Build command `npm ci && npm --prefix ../web ci && npm --prefix ../web run build`；Deploy command `npx wrangler deploy`；分支选 `dev`（或合并后的 `main`）。

前提：`wrangler.jsonc` 的 D1 binding 不写 database_id，首次 Build 会由 Wrangler 自动创建/绑定；若账户关闭了自动 provisioning，则需要先创建 D1 并把 database_id 写进配置后提交。KV 已彻底移除。
