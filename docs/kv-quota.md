# 存储选型与额度复盘（KV → D1）

> 2026-11 起主存储从 Workers KV 改为 **D1**；随后 KV 已从配置、代码与测试中**彻底移除**（线上 KV 操作 0）。
> 本文记录为什么换、D1 当前用量、部署验证，以及 R2 / GitHub 仓库 / Workers Paid 的取舍。

## 1. 现在的存储结构

- **D1**（绑定 `STATUS_DB`）：一张 `status_store(key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)` 表，
  两行数据：`state:v1`（采集累积状态）和 `status:v2`（页面 API 文档）；
- 建表由 Worker 首次访问时懒执行 `CREATE TABLE IF NOT EXISTS`，**不需要手动跑 migration**；
- 采集每轮用一次 `db.batch()` 写这两行（2 行写入、1 次查询）；页面读取走缓存层（内存 15 秒 → Cache API 6 分钟窗口 → D1）；
- **KV 已彻底移除**：`wrangler.jsonc` 没有 `kv_namespaces`、`Env` 没有 `STATUS_KV`、代码/测试不再引用 KV；
  旧 KV namespace 里的历史数据不会再被读取（需要的话可在 Dashboard → Workers KV 导出），新部署的 D1 从空库开始，
  首次 Cron 或 `/api/admin/seed` 后才有数据。

代码位置：[`worker/src/storage.ts`](../worker/src/storage.ts)（D1 读写）、
[`worker/src/status-cache.ts`](../worker/src/status-cache.ts)（读取缓存层）。

## 2. D1 免费额度（账号级，2026-10 文档）

| 项目 | Workers Free |
| --- | --- |
| 行读（rows read） | **5,000,000 / 天** |
| 行写（rows written） | **100,000 / 天** |
| 存储 | 5 GB / 账号（单库上限 500 MB） |
| 数据库数量 | 10 / 账号 |
| 单行大小 | 2 MB |
| 查询数/Worker 调用 | 50 |
| 重置时间 | 每天 UTC 00:00（北京时间 08:00） |

- 参考：[D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/) ｜ [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)；
- D1 免费额度**包含在 Workers Free 里，不需要额外订阅**（这也是选它而不是 R2 的原因之一）；
- 当前项目用量：
  - **写**：5 分钟一轮 × 2 行 = **576 行/天 ≈ 0.6%**；
  - **读**：Cron 每轮 1 行（288/天）+ 缓存 miss 时每数据中心约 250–290 行/天 ≈ **远低于 0.01%**；
  - 单行大小没问题：`state` JSON 约 300 KB、`status` JSON 约 150 KB，上限 2 MB；
- 注意：Workers 免费版另有 **100,000 请求/天（账号级）** 限制；页面 5 分钟轮询 + 静态资源免费，正常流量下不是瓶颈。

## 3. 为什么之前会被 KV 卡住（复盘）

- KV 免费版每日读/写限额是**账号级**：100,000 读/天、1,000 写/天（不同 key），同账号所有 Worker、所有 namespace 共享，
  额度重置在 UTC 00:00；dashboard / wrangler 操作也计入；
- 改造前 `/api/status` 每个请求读 1 次 KV，前端 60 秒轮询且显式 `cache: 'no-store'`，一个常开标签页 ≈ 1,440 读/天，
  `/healthz` 也读 KV；写只有 576/天（58%）。所以**被用光的几乎只能是读**，且读次数≈页面请求量；
- 加上账号级共享：账号下其它 Worker/项目如果也用 KV，会和本项目一起消耗同一份额度；
- 即使加了缓存，KV 写仍只剩 42% 余量、且账号级耦合，所以这次直接换到行写额度 100 倍的 D1。

## 4. 上线步骤（KV 已移除）

1. **D1 自动创建**：config 不写 `database_id` 时，Wrangler ≥4.45 会尝试自动 provision；自动创建的库名通常是
   `knloop-status-status-db`（`<Worker 名>-<binding 名小写>`）。如果 Workers Builds 的 token 没有建库权限、
   或账号关闭了自动 provisioning，首次 deploy 会失败 —— 此时手动 `npx wrangler d1 create knloop-status`
   并把 `database_id` 填进 `wrangler.jsonc` 后重新部署。首次部署后到 Dashboard → Worker → Settings → Bindings
   确认 `STATUS_DB` 已绑定；
2. **D1 从空库开始**：部署后、首次 Cron 之前，`/api/status` 返回 503（没有数据）；想立刻填满页面就调用
   `POST /api/admin/seed`（需要 `ADMIN_TOKEN`），否则等下一个 5 分钟 Cron；
3. **旧 KV 历史不会自动迁移**：KV 已无绑定/无读取，不存在“KV 额度窗口”问题；如果要保留旧 KV 里的历史数据，
   请在部署前从 Dashboard 导出，或临时 checkout 上一个带导入逻辑的版本完成迁移后再部署当前版本；
   直接接受从当前开始的话，不需要任何额外操作；
4. KV 相关配置、`Env.STATUS_KV`、代码和测试都已删除，不需要再执行“删除 kv_namespaces”的收尾步骤。

## 5. 部署后验证

```powershell
# 连续两次请求：第一次可能 x-knloop-cache: db，15 秒后应为 edge / memory
curl.exe -sI https://<你的域名>/api/status | Select-String 'x-knloop-cache|cache-control|etag'
curl.exe -sI https://<你的域名>/healthz | Select-String 'cache-control'
```

- `/healthz` → `{ok:true,now,hasDb}` + `Cache-Control: no-store`（不查数据库）；
- `X-Knloop-Cache` 取值：`memory` / `edge` / `db` / `stale`；
- 如果长期只有 `memory`/`db`、没有 `edge`：Cache API 没生效，确认访问的是**自定义域**、Worker 前面没有 Cloudflare Access；
- Dashboard → **Workers & Pages → D1** → 数据库（自动创建时叫 `knloop-status-status-db`，手动创建叫 `knloop-status`）
  → **Metrics** 可以看到 rows read / written 曲线。

## 6. 备选方案对比（为什么没选）

| 方案 | 免费/成本 | 优点 | 代价 / 不选的原因 |
| --- | --- | --- | --- |
| **D1（当前）** | 免费：500 万行读/天、10 万行写/天、5 GB | 免费自带、无需额外开通；行写额度约当前用量 170 倍；保留 Worker 架构与缓存层；无 CORS/域名改造 | 单库单线程、行大小 2 MB；写入要过 SQL（本项目只有 upsert） |
| **KV（旧方案，已移除）** | 免费：100k 读/天、1k 写/天、1 GB | 边缘缓存好、延迟低 | 写额度离 576/天只有 42% 余量；读/写限额账号级，容易被其它项目连带打满 |
| **R2 公共桶** | 免费：1M Class A 写/月、10M Class B 读/月、10 GB、出网免费 | 可让 `status.json` 直接由 CDN/R2 提供，页面直连、不耗 Worker 请求 | 需开通 R2（通常要绑支付方式）；公共访问要自定义域 + CORS；默认不缓存 `.json`，要配 Cache Everything；r2.dev 仅测试 |
| **GitHub 仓库提交** | 免费 | 完全不占 Cloudflare 存储额度；数据在 git 历史里可查 | 5 分钟一轮 = **288 次 commit/天（约 8,600/月）**，仓库历史膨胀；要维护 GitHub Token + Contents API 限额/重试；页面需跨域读 raw.githubusercontent/jsDelivr（CORS + CDN 缓存延迟）；Worker 内查历史/聚合不方便；故障时容易丢一轮 |
| **Workers Paid $5/月** | $5/月 | 请求 10M/月、KV 读 10M/月、写 1M/月，每天限额消失，零代码改动 | 每月固定支出；本项目当前免费额度完全够用 |

### 关于“把数据提交回 GitHub 仓库”

这是一个完全可行的零成本方案（也是本项目旧架构的做法），但它把“存储”变成了“每 5 分钟一次 git 提交”：

- 需要 GitHub PAT secret + Contents API 调用，提交失败还要重试/补交；
- 每天 288 次提交，一个月约 8,600 次，仓库历史和 diff 会非常吵；
- 页面读数据要么走 `raw.githubusercontent.com` / jsDelivr（跨域 + CDN 缓存，更新有延迟），要么 Worker 代理（又多一层）；
- 适合“只是想把 JSON 存档/版本化”，不适合作为高频读写的主存储。

如果以后确实想换成 GitHub 仓库存储，可以把 `storage.ts` 的 D1 实现替换成“读 raw JSON + 定时 commit”的实现，缓存层和 API 都不用改；
但目前 D1 的 100,000 行写/天对 576 行/天来说余量约 170 倍，**没有必要为此承担 git 提交链路的复杂度**。

## 7. 什么时候才需要再升级

- D1 行写超过 ~50,000/天（需要把采集频率提高约 87 倍，或写入方式大幅变化）；
- Worker 请求量接近 100,000/天（更多是页面流量问题，考虑 R2 直连或 Workers Paid）；
- 需要历史 SQL 查询/多表统计：D1 本身已经支持，不需要换；
- 到那时优先考虑 **R2 直连**（省 Worker 请求）或 **Workers Paid $5/月**（额度整体抬高），而不是 GitHub 提交。

## 8. 相关文件

- 存储实现：`worker/src/storage.ts`
- 读取缓存层：`worker/src/status-cache.ts`
- API / 响应头 / 304 / 错误兜底：`worker/src/index.ts`
- 采集与 seed：`worker/src/collect.ts`、`worker/src/seed.ts`
- 测试：`worker/test/storage.test.ts`（D1）、`worker/test/status-cache.test.ts`、`worker/test/api.test.ts`
- 配置：`worker/wrangler.jsonc`（只有 `d1_databases`，无 KV）
