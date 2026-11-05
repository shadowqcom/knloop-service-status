# knloop-service-status 优化方案（检测逻辑 + 页面逻辑）

日期：2026-11-05 ｜ 分支：dev ｜ 配套契约：docs/data-contract-v2.md

## 一、结论先说

这套系统的问题**不是页面不好看，也不是 Go 不会写**，而是四层链路各有一个“静默失败”的坑，叠在一起放大成“经常出错、数据很慢”：

1. **检测层**：每轮把 5 个探测源（2 本地 + 3 第三方）各写一行日志。第三方 API 失败也被当成服务故障，mmp.cc 已经 100% 挂掉。结果：生产日志里 **2100/2100 组（100%）至少含 1 条 failure**，页面按天聚合后永远显示“部分异常”，60 天可用率算出 **0%**；第三方 1000~3000ms 的 ping 延迟还混进延迟中位数/P95。
2. **数据发布层**：检测 workflow 用默认 `GITHUB_TOKEN` push 到 `page` 分支，而 GitHub 规定这类 push 不会触发其它 workflow，所以 `on: push` 的部署 workflow **从 2026-03-04 起再没执行过**，线上页面数据冻结在 3 月 4 日。
3. **数据读取层**：页面配置的主数据源 `raw.github.knloop.com` 已经 TLS 不可用；页面静默回退到同源快照（更旧），且不提示数据过期。用户看到的是“8 个月前的数据”，看起来就像“数据很慢”。
4. **调度层**：cron 名义 72 次/天，GitHub Actions API 实测最近两周只有 **7~10 次/天**，最近 30 天提交间隔中位数 **280 分钟**、最大 **940 分钟**。仅靠 GitHub schedule 不可能做到分钟级实时。

页面本身还有明显的性能/逻辑问题：一次加载拉 3×~680KB 原始日志、同一份日志解析 4~5 遍；Tailwind browser JIT 272KB + Chart.js 206KB 阻塞；`index.html` 引用了 `app.js` 里不存在的 `onScroll`（每次滚动报错）；`getLatestLogTime()` 用 `split(',')` 解析 JSON 日志、比较的格式永远不等，导致每 2.5 分钟全量重拉。

## 二、实测证据（可复现）

| 项目 | 实测值 | 取证方式 |
| --- | --- | --- |
| 线上日志最后数据 | 2026-03-04 23:38 | `https://status.knloop.com/logs/Google_report.log` |
| 部署 workflow 最后运行 | 2026-03-04 13:40 UTC，之后 0 次 | GitHub Actions API `/actions/workflows/deploy-status-pages.yml/runs` |
| page 分支日志组数 | 2100 组 × 5 行 = 10500 行 | `git show origin/page:logs/*.log` |
| 含 failure 的组 | 2100 / 2100 = **100%** | 按 time 分组统计 |
| 各位置失败率 | 本地 0.0~1.7%；xxapi 6~10%；uapis 45~48%；**mmp.cc 100%** | 同上 |
| 本地探测延迟 | Google p50 72ms / ShadowQ p50 118ms / Mojoo p50 987ms | 日志前两行 |
| 第三方延迟 | 1000~3000ms（混入图表） | 日志第 3/4 行 |
| 调度实际频率 | 7~10 次/天；30 天间隔中位数 280 分钟、p99 575、最大 940 | GitHub Actions API + `git log --format=%ct` |
| 仓库体量 | page 分支 10236 commits，其中 9194 次日志提交；本地 pack 95MB | `git rev-list` / `git count-objects` |
| 页面首屏数据量 | 3 × ~450~680KB 原始文本 | `status.knloop.com/logs/*` |

## 三、v2 设计

### 3.1 数据流

```
                       每 4 分钟（job 内循环，弥补 schedule 不准）
  GitHub Actions job ─────────────────────────────────────────────┐
      │ go build once, then loop                                  │
      ▼                                                          │
  Go 检测器（services 并行）                                      │
   ├─ 本地 HTTP 探测 ×3（TTFB, keep-alive, 重试）                 │
   ├─ 共识：≥2 成功→success；1 成功→partial；0 成功→第三方佐证     │
   ├─ 第三方仅本地全失败时调用（不是数据源，只做可达性佐证）       │
   ├─ 追加写 logs/<key>_report.log（每轮 1 行）                   │
   └─ 聚合写 data/status.json（60 天 daily + hourly，原子替换）    │
      │                                                          │
      ▼                                                          │
  git commit + pull --rebase + push（3 次退避重试）───────────────┘
      │
      ▼
  page 分支 ──► 部署 workflow（每 30 分钟定时兜底 + 代码变更时）──► GitHub Pages
      │                                                          │
      └──► raw.githubusercontent.com（CORS，5 分钟 CDN）          │
                                                                 ▼
  页面：并行取「同源 ./data/status.json」+「远程 dataUrl」→ 取 generatedAt 更新者
        → localStorage 先渲染后刷新 → 60s 轮询（hidden 暂停）→ stale 告警
```

### 3.2 检测逻辑（Go）

- **只信本地探测**：每服务 3 次 GET（TTFB 计时、复用连接池、浏览器 UA、跟随重定向≤10、及时关闭 body），≤2 次成功才算 success，延迟取成功次数的中位数。
- **第三方降级为“佐证”**：只有本地 3 次全失败才并发问 xxapi/uapis（mmp.cc 删除）。他们说可达 → 记 partial（“从别处可达，疑似 runner/区域网络问题”），绝不因此判服务正常，也绝不把他们的延迟写进图表。
- **每轮每服务 1 行日志**：`{time,status,latency,ok,tries}`。日志不再被第三方噪声污染；写入改为追加 + 按 retentionDays/maxLogLines 裁剪 + 临时文件原子替换。
- **聚合下沉到 Go**：新 `aggregator` 包读取旧日志并生成 `data/status.json`（60 天 daily、hourly 中位数/P95、按检查次数算的 uptime、今日故障数、最近故障时间）。迁移期自动兼容旧 5 行/组格式（只取每组前 2 行本地探测）。
- **通知去重**：只在状态跃迁（正常→故障、故障→恢复）时推企业微信，同一状态不重复轰炸。

### 3.3 数据文件 `data/status.json`

页面不再读原始日志。`status.json` 每轮原子重写，页面只需一个 ~20KB（gzip ~3KB）的请求即可渲染全部内容：
- `generatedAt` / `generatedAtUnix`：精确到秒，用于判断更新与新鲜度；
- 每服务：最新 `status/latency`、窗口内 `uptime`、success/partial/failure 计数、今日故障数、最近故障时间；
- `daily`：60 天 × `[date,status,uptime,p50,p95,checks,failures]`（页面 60 个状态块直接映射，不再前端聚合）；
- `hourly`：`[unixHour,median,p95]`（默认 12 小时图表、点击某天时用该天小时数据，均无需解析日志）。

### 3.4 CI 逻辑

- 检查 workflow：cron `*/30` + `workflow_dispatch`，启动后**在同一个 job 内循环 25 分钟、每 4 分钟检查一次**（默认），把有效采样密度从 ~7 次/天提升到“每次调度 ~6 次”，弥补 GitHub schedule 不准；只构建一次二进制；每次循环独立 commit + `pull --rebase` + 重试 push，避免并发 non-fast-forward 失败；单轮失败不终止后续轮，但 job 状态保留失败信号。
- 部署 workflow：增加 `schedule: */30` 兜底 + `paths` 过滤。**关键修复**：自动化 push 由 GITHUB_TOKEN 发出，不会触发 push 事件，必须靠 schedule/dispatch 才能让线上页面持续更新。

### 3.5 页面逻辑

- **数据层重写**：同源 `./data/status.json` 与远程 `dataUrl` 并行请求，选 `generatedAtUnix` 更新者；都失败才回退旧的逐服务日志解析（单遍解析、兼容旧 5 行/组）；localStorage 缓存先把内容画出来，再后台刷新（stale-while-revalidate）；60s 轮询、页面不可见时暂停、回前台立即刷；数据超过 `staleAfterMin` 显示“数据可能延迟”而不是静默展示旧数据。
- **渲染**：60 天状态块改用 CSS Grid，删除 app.js 里逐块 JS 宽度/间距计算（原来每次渲染对每个块做 querySelector + 布局读取，60 块 × N 服务）；uptime 改为“成功检查数/总检查数”，不再按天算；今日故障、最近故障、连续正常天数从 daily/checks 直接取。
- **图表**：Chart.js 改为 IntersectionObserver 惰性加载、仅进入视口才初始化；图表模块只做渲染，不再解析日志/做聚合；缺失小时用 null 占位保证 x 轴时间连续。
- **修复的显式 bug**：`onScroll` 未定义；`getLatestLogTime` 格式比较错误导致的“永远全量重拉”；100ms 定时器空转；滚动监听触发的响应式重渲染。
- **可选**：用 Tailwind CLI 预构建 CSS 替换 272KB 的 browser JIT（若可用）。

## 四、上线步骤（需要仓库维护者操作）

1. 把 dev 分支的改动合并到 main 与 page（遵循仓库规范：不要覆盖 page 的 /logs 历史）。
2. **Settings → Pages → Build and deployment → Source 必须选 “GitHub Actions”**（不要选 “Deploy from a branch”）。当前线上站点就是靠 artifact 部署的；这一步保证新部署生效。
3. Settings → Actions → General → Workflow permissions 选 **Read and write**（检查 workflow 需要 push 日志与 data）。
4. 如需企业微信通知：配置 secret `WECHAT_WEBHOOK_KEY`，并在 `src/config.json` 设置 `webhook.enabled = true`。
5. 手动触发一次 `Service Status Check`，确认：page 分支出现新提交（1 行/服务 + data/status.json）；再手动触发一次 `Deploy Status Pages`，确认线上页面显示新数据。
6. 可选（想要稳定 5 分钟级实时）：用第三方 cron（cron-job.org / Cloudflare Cron / 你自己的服务器）每 5 分钟调用 GitHub `workflow_dispatch` API，或在自建服务器直接跑 `checkshell` 二进制。GitHub 自带 schedule 无法保证分钟级。

## 五、预期效果

| 指标 | 现在 | v2 |
| --- | --- | --- |
| 页面首屏数据请求 | 3×450~680KB 文本 | 1×~20KB JSON（gzip ~3KB），可命中 localStorage |
| 数据解析 | 4~5 遍全量 JSON.parse | 0 遍历日志（聚合在 Go 侧一次完成） |
| 可用率显示 | 0%（第三方失败拉低） | 按检查次数，接近真实值（本地探测成功率 98%+） |
| 状态显示 | 永远“部分异常” | 仅本地探测失败才降级，第三方失败不再污染 |
| 延迟图表 | 混入 1000~3000ms 第三方延迟 | 仅本地 TTFB，中位数/P95 可信 |
| 数据“停更” | 自 2026-03-04 起冻结 | 部署 workflow 定时兜底 + 页面 stale 告警 |
| 有效采样频率 | ~7 次/天 | 每次调度 job 内 ~6 次；部署兜底后页面 ≤30min 更新（可选外部 cron → 5min） |
| 仓库增量 | 每轮重写 3×~500KB | 每轮 3×~100B + ~20KB 聚合文件 |

## 六、风险与后续

- GitHub schedule/Pages 仍有平台级不确定性；v2 用“job 内循环 + 部署定时兜底 + 页面 stale 告警”把不可控变为可见。追求 5 分钟级可加外部调度或自建 runner。
- 第三方佐证 API 随时可能变更/限流，已降级为“仅本地失败时使用”，其故障不影响主判定。
- 旧日志迁移采用“每组取前 2 行本地探测”的启发式；新格式日志写入后自然覆盖窗口。
- 后续可做：把 logs 压缩为按天归档、用 Cloudflare R2/对象存储承载数据、增加服务分组与维护窗口。


## 七、本次落地内容与验收证据（2026-11-05）

### 7.1 代码改动

| 模块 | 文件 | 说明 |
| --- | --- | --- |
| 检测 | `checkshell/checker/checker.go` | TTFB 探测、重试、共识、keep-alive、UA、重定向限制；第三方仅本地全失败时佐证（删除 mmp.cc） |
| 检测 | `checkshell/main.go` | 服务并发、单行日志、status.json 聚合、通知状态跃迁去重、新旧配置兼容 |
| 数据 | `checkshell/logger/logger.go` | 追加写 + 按 retentionDays/maxLogLines 裁剪 + 原子写 |
| 数据 | `checkshell/aggregator/aggregator.go`（新） | 旧日志兼容聚合 → daily/hourly/uptime/p50/p95 → data/status.json |
| 通知 | `checkshell/notifier/notifier.go` | 去掉 resty，标准库实现；down/recovered 合并 |
| CI | `.github/workflows/service-status-check.yml` | job 内循环采样、只编译一次、rebase 重试 push、fetch-depth 0、timeout 35min |
| CI | `.github/workflows/deploy-status-pages.yml` | 新增 `schedule: */30` 兜底 + paths 过滤（修复 GITHUB_TOKEN push 不触发部署的问题） |
| 页面 | `src/js/statusData.js`（新） | 同源+远程 status.json 选新、localStorage 缓存、60s 轮询、hidden 暂停、stale 告警、legacy 回退 |
| 页面 | `src/js/statusModel.js`（新） | 纯数据层：视图模型、legacy 单遍解析、图表窗口、总状态/汇总计算（可 node --test） |
| 页面 | `src/js/app.js`、`index.html` | CSS Grid 状态块、删除逐块 JS 布局、修复 onScroll、passive+rAF 滚动、图表惰性加载、告警/错误 UI |
| 页面 | `src/js/timelapsechart.js` | 纯渲染 + IntersectionObserver 加载 Chart.js |
| 删除 | `dataProcessing.js`、`errorHandler.js`、`fetchurlsconfig.js`、`logDataManager.js` | 旧的多遍解析/无效缓存/无效轮询逻辑 |
| 文档 | `docs/data-contract-v2.md`、`docs/optimization-plan.md`、`README.md` | 契约、诊断、部署说明 |

### 7.2 验收证据（本机真实执行）

**Go（checkshell/，Go 1.27.3）**
- `gofmt -l .` 无输出；`go build ./...`、`go vet ./...` exit 0；
- `go test -count=1 ./...`：`servicecheck`、`aggregator`、`checker`、`logger` 四包全部 `ok`；
- 用 page 分支真实旧日志（每组 5 行、mmp.cc 100% 失败）聚合：**ShadowQ 100.00%、Google 100.00%、Mojoo 96.04%**（原页面会显示 0.00%），每服务 328 条检查、daily 60 行、status.json 28,805 字节；schema/时间升序/窗口/uptime 断言全部通过；
- 本地 httptest E2E：正常服务写 `{"status":"success","latency":3,"ok":2,"tries":2}`，失败服务 `ok=0`，status.json 状态与 daily 正确。

**CI**
- js-yaml 解析两个 workflow 通过；actionlint 1.7.7 无告警；
- 从 YAML 抽出真实 loop 脚本在本地 git 仓库仿真 3 个场景（并发 push 冲突、首轮检测失败、push 持续被拒）21 项断言全部通过；`bash -n` 通过。

**前端**
- `node --test "tests/*.test.js"`：18 项全部通过（status.json 映射、legacy 旧 5 行/组兼容、图表窗口、总状态判定、stale/相对时间、真实旧日志夹具聚合等）；
- Chrome headless（桌面 1440×1100、移动 390×844）+ CDP 验收：3 个服务 / 180 个状态块 / 3 张图正常，**0 个 JS 异常、0 个 console error**；`data/status.json` 同源加载成功；
- 过期数据场景：生成 3 小时前的 status.json → 页面顶部出现“数据可能延迟（最后采集于 …）”告警，数据仍展示；
- 无数据/请求失败场景：显示“数据加载失败，请检查网络后重试 + 重新加载”按钮，页面不空白；
- 首屏数据请求从 3×~450~680KB 原始日志降为一个 status.json（本机 28.8KB）；Chart.js 仍保持 206KB 但改为进入视口才加载；Tailwind browser JIT 仍保留（272KB），预构建 CSS 作为后续可选项。

### 7.3 剩余人工操作（必须）

1. `main` 分支放最新 workflow（schedule 只读默认分支），`page` 分支放最新 Go/前端/配置（检测 job checkout page）；即按仓库规范把 dev 合并到 main 与 page（不要覆盖 page 的 logs 历史）。
2. Settings → Pages → Source 必须为 **GitHub Actions**；Settings → Actions → General → Workflow permissions 必须为 **Read and write**。
3. 合并后手动跑一次 `Service Status Check`（确认 page 出现 `data/status.json` 与新格式日志），再手动跑一次 `Deploy Status Pages`（立即修复线上数据冻结）。
4. 观察 1~2 天：`data/status.json` 的 generatedAt 应随检测更新；若线上仍长期显示 stale，检查 Actions 调度与 Pages 部署记录。

### 7.4 已知取舍

- GitHub `schedule` 不可靠（实测 ~7 次/天），job 内循环把每次调度的采样密度提高到 ~6 轮，但 job 之间的空档仍然存在；追求 5 分钟级稳定实时需要外部 cron 或自建 runner。
- `fetch-depth: 0` 每次约 95MB 历史下载，是为 rebase 可靠性做的取舍（比非 fast-forward 失败后丢数据便宜）。
- 旧日志迁移采用“5 行/组取前 2 行本地探测”的启发式；新格式写入后按窗口自然替换。
- Tailwind 仍是 browser JIT；若要进一步降首屏，可用 CLI 预构建 `public/app.css` 并把 index.html 的 script 换成 link（需要一次构建步骤）。

### 7.5 Globalping 检测源（v2.1 追加，2026-11-05）

- 新增 `checkshell/globalping/globalping.go`：Globalping measurements API 客户端（创建测量 → 轮询 → 结果归一化；429/超时/API 错误返回 error 供降级）；只依赖标准库；
- `checkshell/main.go` 新增 `probe.mode = local | globalping | hybrid`，默认 `local`，原有行为不变；Globalping 故障时按 `fallbackToLocal` 降级本地探测，不会把服务判成 failure；
- 真实实网验证（4 地区各 1 probe，共 12 probes）：ShadowQ success 4/4（406ms）、Mojoo success 4/4（709ms）、**Google partial 3/4（大陆节点超时，其余地区 200）**；hybrid 模式本地成功时不调用 Globalping；local 模式行为与改造前一致；
- 速率预算：3 服务 × 4 地区 × 每 4 分钟 = 180 probes/小时，低于匿名 250/h；可设 `GLOBALPING_TOKEN` 提高额度；
- 单测：新增 globalping 客户端 10 个用例 + probe 模式 11 个用例，`go test ./...` 全绿；README、数据契约、免费方案文档已同步。
