# knloop status v2 — 数据契约与改造方案

> 本文档是本次改造的唯一契约来源。Go 检测器、前端、CI 三方都按此实现，字段名/语义不得擅自改动。

## 0. 背景（实测证据，2026-11-05）

| 现象 | 证据 |
| --- | --- |
| 线上页面数据停在 **2026-03-04** | status.knloop.com/logs/Google_report.log 最后一条是 2026-03-04 23:38；deploy workflow 最后一次运行 2026-03-04 13:40 UTC |
| 自动化 push 无法再触发部署 | service-status-check.yml 用默认 GITHUB_TOKEN push 到 page 分支；GitHub 规定 GITHUB_TOKEN 触发的 push 不会启动其它 workflow，所以 on: push page 的 deploy workflow 从 2026-03-04 起再没跑过 |
| 页面主数据源已失效 | config 里 logspath = https://raw.github.knloop.com/... 该域名 TLS 已不可用；页面静默回退到同源 ./logs/（旧快照） |
| 页面永远显示“异常”、可用率 0% | page 分支 2100 组日志每组 5 条，**100% 的组至少含 1 条 failure**：本地探测失败率 0~1.7%，第三方位失败率 45%/100%（mmp.cc 100% 失败） |
| 延迟图表被污染 | 每轮日志混入第三方 ping API 的 1000~3000ms 延迟，与本地 50~150ms 混在一起算中位数/P95 |
| 自动化实际频率 ~7 次/天 | cron 为 1,25,55 * * * *（72 次/天），但 GitHub Actions API 实测 2026-10-27~11-04 每天只有 7~10 次；最近 30 天提交间隔中位数 280 分钟、最大 940 分钟 |
| 日志/仓库膨胀 | page 分支累计 10236 次提交、9194 次日志提交、pack 95MB；每轮重写 3 个 450~680KB 文件 |
| 页面性能 | 每次加载 3×~680KB 原始日志；同一份日志被 parseLogData/normalizeData/calculateAvgLatency/calculateServiceStats 各解析一遍（约 4~5 次全量 JSON.parse）；Tailwind browser JIT 272KB、Chart.js 206KB 阻塞加载 |

## 1. 检测逻辑 v2（Go）

### 1.1 探测策略

每个服务每轮：

1. 本地 HTTP 探测：GET 目标 URL，跟随重定向（≤10 跳），关闭 body（不读全量），延迟用 **TTFB**。
   - 并发度：服务之间并行；同一服务内 attempts 串行（默认 3 次，间隔 250ms/500ms）。
   - 每次超时：requestTimeoutMs（默认 5000，单次），客户端复用 keep-alive 连接池。
   - 请求头带可配置 UA（默认浏览器 UA），Accept: text/html,application/xhtml+xml,*/*。
   - 成功码：2xx、3xx（最终跳转后），其余算失败；连接错误算失败。
2. 判定（attempts 默认 3，minSuccess 默认 2）：
   - 成功次数 ≥ minSuccess → **success**，latency = median(成功探测的 TTFB)
   - 成功次数 = 1 → **partial**，latency = 该次 TTFB
   - 成功次数 = 0 → 进入第三方佐证
3. 第三方佐证（仅本地全失败时执行，并发、超时 5s）：
   - 内置 provider：xxapi.cn、uapis.cn（mmp.cc 已 100% 失效，移除）
   - 任一 provider 返回目标可达 → **partial**（说明 runner 侧网络问题或目标区域性拦截，不是服务挂了），latency = null
   - 全部失败 → **failure**，latency = null
   - 第三方结果**不参与延迟统计**，不写独立日志行
4. 通知：仅当最新状态由「非 failure」变为 failure，或由 failure 恢复时推送（对比上一条日志）；同一状态不重复推送。Webhook 仍用 WEBHOOK_KEY。
5. 检测源模式（probe.mode，v2.1 新增；**默认 local，行为与之前完全一致**）：
   - `local`：上述本地探测（默认）。
   - `globalping`：每个服务发起一次 Globalping 测量（jsDelivr 公开探测网络，type=http|ping），按 locations 选 CN/HK/JP/US 等节点。全部节点成功 → success；部分成功 → partial（区域性异常，例如大陆不可达但海外正常）；全部失败 → failure；延迟取成功节点延迟中位数。Globalping API 自身故障/限流时，按 `fallbackToLocal` 降级本地探测；关闭 fallback 时记 partial，**绝不因第三方 API 故障把服务判成 failure**。
   - `hybrid`：先本地探测（保持快速路径）；本地 success 直接返回；本地非 success 时再调 Globalping：有节点可达 → partial，全部不可达 → failure，Globalping 故障时保留本地结果。
   - Globalping 免费匿名额度约 250 probes/小时（按 IP）；可选环境变量 `GLOBALPING_TOKEN` 提高额度。

配置新增（src/config.json，Go 与前端共用）：

    {
      "attempts": 3,
      "minSuccess": 2,
      "peerCheck": { "enabled": true, "timeoutMs": 5000 },
      "retentionDays": 60,
      "userAgent": "Mozilla/5.0 (compatible; knloop-status/2.0; +https://status.knloop.com)",
      "pollIntervalSec": 60,
      "staleAfterMin": 45,
      "probe": {
        "mode": "local",
        "globalping": {
          "type": "http",
          "method": "HEAD",
          "locations": [
            { "country": "CN", "limit": 1 },
            { "country": "HK", "limit": 1 },
            { "country": "JP", "limit": 1 },
            { "country": "US", "limit": 1 }
          ],
          "timeoutMs": 20000,
          "pollIntervalMs": 1000,
          "fallbackToLocal": true,
          "tokenEnv": "GLOBALPING_TOKEN"
        }
      }
    }

保留旧键 requestTimeoutMs（单次探测超时）、maxRetries（= attempts 兼容）、retryDelayMs（重试基础间隔）、maxLogLines（日志行数兜底）、webhook.enabled。

### 1.2 日志格式 v2（logs/<key>_report.log，每轮每服务 **1 行**）

    {"time":"2026-11-05 02:43:28","status":"success","latency":72,"ok":3,"tries":3}

- time：北京时间 YYYY-MM-DD HH:MM:SS
- status：success | partial | failure
- latency：本地成功探测 TTFB 中位数（ms），无成功探测时 null
- ok / tries：成功次数 / 探测次数（用于迁移期识别新格式）
- 追加写；当文件行数 > maxLogLines 或最早记录早于 retentionDays 时，裁剪为「按天保留」的尾部（保留最近 retentionDays 天，且不超过 maxLogLines 行）。
- 兼容旧日志：旧格式单行（只有 time/status/latency）按一条检查记录读取；旧格式 5 行/组（同一 time 连续 5 行）聚合时只取前 2 行作为本地探测（本地全成功→success，部分→partial，全失败→failure），忽略第三方行。

### 1.3 页面聚合文件 data/status.json（每轮重写、原子写入）

    {
      "schema": 2,
      "generatedAt": "2026-11-05T02:43:28+08:00",
      "generatedAtUnix": 1793796208,
      "retentionDays": 60,
      "services": [
        {
          "key": "Google",
          "url": "https://www.google.com",
          "status": "success",
          "latency": 72,
          "lastCheckAt": "2026-11-05T02:43:28+08:00",
          "uptime": 99.95,
          "checks": {
            "success": 2098, "partial": 1, "failure": 1, "total": 2100,
            "todayTotal": 8, "todayFailures": 0,
            "lastFailureAt": "2026-10-30T11:03:04+08:00"
          },
          "daily": [
            ["2026-11-05", "success", 100, 72, 101, 8, 0]
          ],
          "hourly": [
            [1793793600, 72, 101]
          ]
        }
      ]
    }

- daily 行格式：[date, status, uptimePct, p50, p95, checks, failures]，升序，窗口内每天一条（无数据补 status=nodata、数值 0/null）。
- hourly 行格式：[unixHourStart, median, p95]，升序，窗口内每个有数据的整点一条。
- 聚合规则：daily 状态 = 0 失败 success；0 成功 failure；其余 partial；当天无记录 nodata。
- uptime = success 次数 / total（**按检查次数**，不是按天）。
- p50/p95 只统计 status 为 success/partial 且 latency != null 的本地延迟；空则 null。
- 文件必须**原子写入**（临时文件 + rename），先写日志再写 status.json。
- 输出路径固定 ../data/status.json（相对 checkshell/ 工作目录），目录不存在则创建。

### 1.4 Go 代码结构

- checkshell/checker/checker.go：Probe(url, opts) 本地探测（含重试、并发 peer）；可单测：NewProber 注入 *http.Client / peer checker 接口。
- checkshell/globalping/globalping.go（v2.1 新增）：Globalping measurements API 客户端（POST measurements + 轮询 + 结果归一化 + 限流/超时错误处理），可注入 BaseURL/HTTPClient 单测。
- checkshell/main.go：加载配置、并发检查服务、写日志/status.json、通知。
- checkshell/logger/logger.go：追加 + 裁剪 + 原子写；ReadLogs 保留。
- checkshell/aggregator/aggregator.go（新）：读旧日志 → 聚合 daily/hourly/uptime → 生成 status.json 结构；单测覆盖迁移期旧格式。
- 删除无用代码：CheckURL、CheckURLSimple 等（如无引用）。
- 单测：go test ./... 必须通过（探测判定、旧日志聚合、status.json 不变量）。

## 2. CI v2（GitHub Actions）

目标：① 数据可见（修好部署链路）；② 数据更实时；③ 不再因 push 竞争/编译超时出错；④ 仓库不再膨胀。

- service-status-check.yml：
  - on.schedule: "*/30 * * * *"（GitHub 实测调度不可靠，靠下面的循环兜底）；workflow_dispatch 可传 loop_minutes、interval_seconds。
  - permissions: contents: write；concurrency: group: status-check, cancel-in-progress: false。
  - 构建一次：cd checkshell && go build -o bin/statuscheck .（setup-go cache 保留）。
  - 循环：每 interval_seconds（默认 240）运行一次，直到累计 loop_minutes（默认 25）；每次：运行检测 → git add logs data → 有变化则 commit → git pull --rebase origin page → git push（失败重试 3 次，指数退避）。
  - timeout-minutes: 35。检测/推送步骤失败时保证后续轮次继续，但最终 job 状态需能反映首轮失败。
- deploy-status-pages.yml：
  - 触发：workflow_dispatch、push（仅 index.html、src/**、public/**、.github/workflows/** 变化时）、schedule: "*/30 * * * *"（定时把 page 分支最新快照发布；GITHUB_TOKEN push 不会触发 push 事件，必须靠 schedule/dispatch）。
  - checkout page 分支 → upload-pages-artifact(.) → deploy-pages。
  - 加 concurrency: group: pages, cancel-in-progress: false。
- .gitignore：忽略 checkshell/bin/、tmp/、.tools/、checkshell/*.test。
- 保留「把数据同时 commit 到 page」的行为；不删除旧 logs/。

## 3. 页面逻辑 v2（Alpine + Tailwind4 + Chart.js，保持技术栈）

### 3.1 数据加载（新增 src/js/statusData.js）

1. 并行请求：
   - 同源 ./data/status.json（Pages 快照，cache: no-store）
   - 配置中的远程源 config.dataUrl（默认 https://raw.githubusercontent.com/<owner>/<repo>/page/data/status.json；若 config 提供 logspath/自定义域名则用于推导）
   - 选择 generatedAtUnix 更大的成功响应；两个都失败 → legacy 模式（按 config.services 逐个取 logs/<key>_report.log，单遍解析）。
2. 结果缓存到 localStorage（key: knloop:status:v2）：首屏立即用缓存渲染，再后台刷新（stale-while-revalidate）；缓存 > 24h 直接丢弃。
3. 轮询：每 pollIntervalSec（默认 60）重新拉取上述小文件，只有 generatedAtUnix 变新才重渲染；document.hidden 时暂停，visibilitychange 回前台立即刷新一次。
4. 新鲜度：now - generatedAtUnix > staleAfterMin*60（默认 45）→ 显示“数据可能延迟（最后采集于 X）”告警，不隐藏数据。页面永不因单次请求失败变空白。

### 3.2 渲染

- 服务列表来自 status.json：
  - lastStatus = service.status；statusPoints = daily 映射为 60 个块（date/status）。
  - uptime = service.uptime（按检查次数）；avgLatency = 最近 24h hourly 的 median 均值。
  - lastUpdateTime = generatedAt（北京时间显示，附相对时间“X 分钟前”）。
  - todayFailures、lastFailureTime、consecutiveOkDays 由 daily/checks 计算（nodata 日不计入也不打断连续天数）。
- 60 天状态块用 **CSS Grid**：display:grid; grid-template-columns: repeat(60, minmax(0,1fr))；删除 app.js 里逐块 JS 宽度/间距计算和 getStatusLayout/getStatusBlockWidth 等 getter；移动端横向滚动。
- 图表：
  - timelapsechart.js 改为纯渲染：入参 {labels, median[], p95[]} + yMax，不再解析日志、不再在内部做聚合。
  - 默认视图用 service.hourly 最近 maxHour+1 个整点；点击某天用该天 hourly；缺失小时为 null 保持 x 轴连续。
  - Chart.js 延迟加载：IntersectionObserver 观察 canvas，进入视口再动态插入 chart.umd.js 并初始化；避免首屏 206KB 阻塞。
- 交互修复：
  - 删除 index.html 中不存在的 @scroll="onScroll($event)"（app.js 无此方法，每次滚动报错）；顶部导航隐藏用 passive + rAF 节流的原生监听，不放在 Alpine 响应式 state 里。
  - 手动刷新按钮、错误页保留；错误时优先展示缓存数据 + 告警。
  - 计数倒计时改为“上次更新 / 自动刷新”文案（以真实 poll 为准），或明确显示下次轮询秒数；不再用 100ms 定时器空转。
- 总状态判定：全部 success → success；任一 failure → failure；否则任 partial → partial；全部 nodata → nodata。文案保留中文。
- 清理：normalizeData、parseLogData（legacy 用单遍替代）、未使用的 import/函数；fetchurlsconfig.js 若不再使用则删除或保留仅供 legacy。

### 3.3 性能（期望指标）

- 首屏数据请求从 3×~680KB → 1×~20KB（gzip ~3KB）。
- 单次数据加载不再 4~5 次全量 JSON.parse；status.json 直接渲染。
- 移除 Tailwind browser JIT（272KB + 运行时编译）：用 Tailwind CLI 预构建 public/app.css（提交产物，页面不再需要构建步骤）。若 CLI 不可用则保留 JIT 并在报告中说明。
- Chart.js 惰性加载。

## 4. 验收

1. cd checkshell && go test ./... 通过；用 page 分支的真实旧日志（tmp/*_page.log）跑一次聚合，产出合法 data/status.json，且 **uptime 不再因第三方位失败被拉低**（Google/ShadowQ 应接近 100%）。
2. node --test（前端解析/状态计算单测，若实现）通过。
3. 本地静态服务器 + Chrome headless 桌面/移动截图：页面首屏有数据、无控制台报错、状态块/图表/统计正常；断网/404 时显示缓存与告警而非空白。
4. CI YAML 用 yaml 解析 + 人工核对（无 actionlint 时）。
5. 交付 docs/optimization-plan.md（诊断 + 方案 + 上线步骤）与 README 增补。
