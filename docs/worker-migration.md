# 从 GitHub Actions + Go 迁移到 Worker（检查清单）

新架构的代码在 `worker/`（后端）与 `web/`（前端），旧的 `checkshell/`、`src/`、`index.html`、`.github/workflows/` 暂时保留作参考。切换步骤：

1. **Cloudflare 准备**：注册账号；`npx wrangler login`；KV binding 默认不写 id，首次 `wrangler deploy` 会自动创建/绑定（Wrangler ≥4.45 的 Automatic Resource Provisioning）；如自动创建失败再手动创建 KV 并填 id；
2. **Globalping**：注册免费账号，`npx wrangler secret put GLOBALPING_TOKEN`（不配也能跑匿名额度）；
3. **构建/部署**：`cd web && npm install && npm run build` → `cd ../worker && npx wrangler deploy`；
4. **绑定自定义域**：Cloudflare 控制台 → Workers → 该 Worker → 自定义域（例如 `status.example.com`）；确认 `/` 与 `/api/status` 同域可访问；
5. **验证**：
   - `GET https://<域>/healthz` 返回 `hasStatus`；
   - 手动触发一次（可选）：设置 `ADMIN_TOKEN` secret 后 `POST /api/admin/run`；
   - 页面出现 3 个服务、60 个日块、Chart.js 图，`generatedAt` 随时间更新；
6. **停旧链路**：确认新站稳定后，在 GitHub 上 **Disable** 或删除 `service-status-check.yml`、`deploy-status-pages.yml`，并关闭 GitHub Pages（避免旧页面/旧数据继续更新）；
7. **清理（可选）**：确认不再需要旧实现后，再移动/删除根目录 `index.html`、`src/`、`checkshell/`、`data/`、旧 workflow；不要急着删，先保留一个版本方便回滚。

## 注意

- 旧 GitHub Actions 仍会按旧逻辑提交 `data/status.json`/`logs/`，与 Worker 的 KV 数据互不影响；但在旧页面还开着时会显示旧数据，建议切换后禁用；
- Worker 的 `worker/public` 是 `web/` 构建产物（gitignore），部署前必须先 build；
- `worker/wrangler.jsonc` 的 KV id 是占位符，未替换时只能本地 dev，无法部署；
- 免费版 Worker CPU 10ms/Cron、KV 1000 写/天；当前 10 分钟一轮、2 key/轮约 288 写/天，余量充足；
- Globalping 250 probes/小时（匿名）：当前 3 服务 × 2 地区 × 6 轮/小时 = 36/小时，余量很大；uapis 免费 1500 次/月，默认仅异常时调用、日上限 30。

## Worker Builds 自动部署（GitHub → Cloudflare）

Cloudflare 控制台连接仓库后：Root directory `worker`；Build command `npm ci && npm --prefix ../web ci && npm --prefix ../web run build`；Deploy command `npx wrangler deploy`；分支选 `dev`（或合并后的 `main`）。

前提：`wrangler.jsonc` 的 KV binding 不写 id，首次 Build 会由 Wrangler 自动创建/绑定；若账户关闭了自动 provisioning，则需要先创建 KV 并把 id 写进配置后提交。
