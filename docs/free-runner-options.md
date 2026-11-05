# 免费检测运行方案与第三方接口调研（2026-11 实测）

> 目的：解决两个问题——① GitHub Actions 的 schedule 不准时（实测 7~10 次/天）；② 检测点只在海外，看不到大陆视角。
> 所有免费额度以官网为准，会变动；本文标注了实测/官方文档来源。

## 一、结论与推荐组合

| 你的目标 | 推荐方案 | 成本 | 改动量 |
| --- | --- | --- | --- |
| 只让数据稳定更新（最快落地） | **cron-job.org 定时调 GitHub `workflow_dispatch`** + 现有 job 内循环 | 免费 | 0 行代码，只配一个 PAT + 一个定时任务 |
| 想测“大陆用户能不能访问” | **Globalping 中国大陆 probe**（免费 250 次/小时）作为第二观测点 | 免费 | 小：给 Go 加一个 Peer / 第二数据源 |
| 完全不想依赖 GitHub Actions | **Oracle Cloud Always Free VM**（日本/首尔/新加坡）跑现有 Go 二进制 | 免费（需信用卡验证） | 中：部署 + 定时 + 写回 GitHub |
| 想要免费的多节点佐证 | **check-host.net API**（55 节点，含香港/日本/新加坡，无大陆） | 免费、无鉴权 | 小：失败时兜底 |
| 独立告警/第二意见 | **UptimeRobot 免费版**（50 monitors、5 分钟、状态页） | 免费 | 0（不写入本项目数据） |

**不建议**：把 xxapi.cn / uapis.cn / mmp.cc 这类免费 ping API 当主数据源（实测失败率 45%~100%），也别把免费额度写死成唯一依赖。

## 二、方案 A：外部 cron 触发 GitHub Actions（推荐先做）

原理：GitHub 的 `schedule` 不准时，但 `workflow_dispatch` API 是可靠的；用免费 cron 服务每 30 分钟调一次，配合 job 内 4 分钟一轮的循环，就得到稳定 4 分钟采样。

### 1. 创建细粒度 PAT
- GitHub → Settings → Developer settings → Fine-grained tokens；
- 只授权目标仓库，权限 **Actions: Read and write**（推送日志仍用 workflow 自带的 GITHUB_TOKEN，不需要 Contents 权限）；
- 设置过期时间（90 天），到期轮换。

### 2. 手动验证一次
```bash
curl -X POST \
  -H "Authorization: Bearer <PAT>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/<repo>/actions/workflows/service-status-check.yml/dispatches \
  -d '{"ref":"main","inputs":{"loop_minutes":"29","interval_seconds":"240"}}'
```
返回 204 即成功（workflow_dispatch 允许在默认分支或指定 ref 上运行；`ref` 填默认分支）。

### 3. cron-job.org 配置
- 免费、最小 1 分钟间隔、单次请求 30 秒超时、无硬性 job 数量限制（fair use），请求来自德国 Hetzner IP；
- URL 填上面的 GitHub API 地址；Method 选 POST；
- Headers：`Authorization: Bearer <PAT>`、`Accept: application/vnd.github+json`、`Content-Type: application/json`；
- Body：`{"ref":"main","inputs":{"loop_minutes":"29","interval_seconds":"240"}}`；
- 计划：每 30 分钟一次（`*/30 * * * *`）。

效果：每 30 分钟一定有一次 job 启动，job 内 29 分钟 × 每 4 分钟一轮 ≈ 7 轮；上一轮结束到下一轮启动的空档 <1 分钟。代价是 GitHub Actions 运行次数增加（public 仓库免费，Free 计划 20 个并发 job，事件速率上限 1500 事件/10 秒/仓库，远未触及）。

## 三、方案 B：Cloudflare Workers Cron（免费、可只调度也可直接检测）

免费额度（官方 Limits 页）：100,000 请求/天、CPU 10ms/次、单请求 50 个子请求、**每账号 5 个 Cron Trigger**、支持 `* * * * *`（每分钟）。存储可用 Workers KV（免费 100,000 读/天、**1,000 写/天**、同 key 1 写/秒、1GB）或 R2（免费 10GB-month、100 万 Class A/月、1000 万 Class B/月）。

两种用法：
1. **只做调度**（最简单）：Worker cron `*/30 * * * *` → `fetch` GitHub dispatch API，把 PAT 放 Worker secret。比 cron-job.org 更可控（可加日志/告警）。
2. **直接跑检测**（脱离 GitHub Actions）：Worker 里并行探测 3 个目标（每目标 2~3 次，9 个子请求 < 50），计算状态 → 写 KV/R2/GitHub Contents API；页面读同一个 `data/status.json`。注意 Worker 免费版 CPU 只有 10ms，日志聚合/60 天统计建议放在读取侧或 KV 里做增量。

注意：`*.workers.dev` 在中国大陆访问不稳定；如果页面也托管在 Cloudflare 自定义域（knloop.com 若托管在 CF）则不存在这个问题。Cloudflare 边缘没有大陆节点，所以它测的仍是“海外视角”。

## 四、方案 C：Oracle Cloud Always Free VM（长期免费、可跑现有 Go 二进制）

官方 Always Free 额度（2026-11 官方文档）：
- 2 台 AMD `VM.Standard.E2.1.Micro`（1/8 OCPU、1GB 内存级别），或 Ampere A1 合计 **2 OCPU / 12 GB**（1500 OCPU 小时 + 9000 GB 小时/月，2024 年后从 4 OCPU/24GB 缩减）；
- 200 GB 块存储、每月 10 TB 出站流量；
- 可选 home region：日本东京/大阪、韩国首尔、新加坡等（具体可用区域以注册时为准）。

优点：真正 7×24 跑，能存完整历史、随时改逻辑、不依赖 GitHub 调度；日本/韩国到大陆通常比美国 runner 好。缺点：注册可能被拒/需要信用卡验证、热门区域 ARM 容量紧张、需要自己维护系统与安全更新。

部署要点：
1. 建 Ubuntu 实例，安装 Go（或用本地交叉编译 `GOOS=linux GOARCH=amd64 go build` 后 scp）；
2. 把仓库 clone 到 VM（`page` 分支），`cd checkshell && go build -o statuscheck .`；
3. systemd timer 每 5 分钟执行一次，或用一个长循环 + `sleep 240`；
4. 用 fine-grained PAT 把 `logs/` 与 `data/` commit 回 `page` 分支（Contents: Read and write），页面不需要改。

## 五、方案 D：其他免费/低价运行环境（按可用性排序）

| 服务 | 免费情况 | 适合度 |
| --- | --- | --- |
| Google Cloud Free Tier e2-micro | 1 台 e2-micro（美国区域）+ Cloud Scheduler 3 个免费 job（以官网为准） | 可用，但位置在美国，和 GitHub runner 视角重复，意义有限 |
| Deno Deploy | 免费 1M 请求/月，支持 `Deno.cron` | 可跑轻量检测；无大陆节点；需写 TS |
| 腾讯云 SCF | 新用户前 3 个月免费试用额度（100 万次调用/月等），**第 4 个月起无免费额度** | 短期验证大陆视角可以，长期要付费 |
| 阿里云 FC / 华为云 FunctionGraph | 有免费额度/试用，具体额度经常调整 | 需实名，查官网当前政策；大陆视角最理想 |
| Render / Railway / Fly.io | 免费额度已取消或仅试用 | 不推荐 |

## 六、第三方接口（可直接接入的点）

### 1. Globalping（jsDelivr，强烈推荐）
- 官网/文档：https://globalping.io/ ，API：`https://api.globalping.io/v1`；
- **匿名免费，实测响应头 `x-ratelimit-limit: 250`（250 次测量/小时，按 IP）**；注册 token 后额度更高，超额可用 credits；
- 支持 `ping`、`http`、`dns`、`traceroute`、`mtr`；可按国家/城市/ASN/网络选择 probe；
- **实测有中国大陆 probe**：深圳（阿里云 AS37963）、北京（腾讯云 AS45090）等，对 shadowq.com 的 HTTP 测量能拿到状态码、响应头和耗时；
- 用法：`POST /v1/measurements` → 轮询 `GET /v1/measurements/{id}`（通常 2~10 秒完成）；
- 对本站的接入方式（两种）：
  - 兜底佐证：仅当本地探测失败时，发 1 个 CN `ping`/`http` 测量；成功则记 `partial`（“大陆可达、海外 runner 不可达”），失败才 `failure`；
  - 大陆视角常开：每轮每服务 1 个 CN `http` 测量（3 服务 × 每 4 分钟 = 45 次/小时，远低于 250），把“大陆可达/耗时”作为第二组数据展示；注意不要让 Globalping 自身故障把主状态判成 failure。

### 2. check-host.net（免费、无鉴权、多节点）
- API：https://check-host.net/about/api ；
- 55 个节点，亚洲有香港、日本东京、新加坡、越南、印度、印尼，**没有中国大陆节点**；
- `GET /check-http?host=<url>&max_nodes=N` 拿 `request_id`，再 `GET /check-result/<id>`；
- 适合本地失败时多点佐证；有非公开限流，别每分钟调用。

### 3. UptimeRobot（免费监控/告警）
- 免费 50 monitors、5 分钟检查、状态页、HTTP/keyword/ping/port、无需信用卡；
- 适合做**独立第二意见和告警**，但它的 API 是监控管理 API，不适合作为逐次延迟数据源。

### 4. 不要当权威的免费 API（实测）
| 接口 | 实测失败率 | 说明 |
| --- | --- | --- |
| mmp.cc | 100% | 已从 v2 删除 |
| uapis.cn | 45%~48% | 只适合兜底，不能作为状态依据 |
| xxapi.cn | 6%~10% | 同上 |

## 七、建议的落地顺序

1. **先做方案 A**（0 代码改动）：把数据更新稳定性解决，观察一周；
2. **再加 Globalping CN probe**（方案 A + 接口 1）：解决“大陆视角”，这是当前架构最大的盲区；
3. **如果仍想脱离 GitHub Actions**：优先 Oracle Always Free VM（跑现有 Go 二进制，改动最小），Cloudflare Worker 作为备选；
4. 任何外部依赖都要“**失败不影响主判定**”：Globalping/check-host 挂了只能降级为“未知/partial”，不能把服务判成故障。

## 八、注意事项

- 免费额度会变：Oracle A1 已从 4 OCPU/24GB 缩到 2 OCPU/12GB；腾讯云 SCF 免费只限前 3 个月；上线前以官网为准。
- PAT 安全：用 fine-grained token（只给目标仓库 Actions: Read and write）、设过期时间；不要用 classic 全权限 token，也不要把 token 写进仓库。
- GitHub Actions 本身对 public 仓库免费，但每次 dispatch 都会创建一次 run；按方案 A 每 30 分钟一次，完全在正常使用范围内。
- 海外免费服务（GitHub/Cloudflare/Oracle 日本）测量的是“海外视角”；要真正代表大陆用户，需要大陆节点（Globalping CN probe / 国内云函数 / 自建）。
- 页面已有 stale 告警，无论后端换成哪种，只要 `generatedAt` 不更新就会显示“数据可能延迟”，方便判断链路是否正常。

## 九、目标定为「GitHub 只发布页面」时的三种形态

先明确一点：Globalping / check-host 是**按需测量 API**，它们不负责“每 5 分钟自动跑”和“保存 60 天历史”。所以“检测数据全用第三方免费”仍然需要一个免费的**执行者 + 存储**。可选三条路：

### 形态 1（零服务器，推荐给不想维护 VPS 的人）

```
Cloudflare Worker（Cron 每 5 分钟，免费）
   ├─ 直连探测目标（Cloudflare 边缘出口）
   └─ Globalping CN http/ping 测量（大陆视角，250 次/小时免费）
        │  合并成 status.json（success/partial/failure）
        ▼
   R2 存储（免费 10GB、写 100 万次/月、出站免费）
        │  公开自定义域 + Cache-Control: 60s
        ▼
页面（GitHub Pages 静态文件）：fetch https://data.<你的域>/status.json
GitHub Actions：只在代码变更时部署页面（不再跑检测）
```

- 要求：Cloudflare 账号 + 一个托管在 Cloudflare 的域名（R2 自定义域需要）；
- 免费额度：Worker 100k 请求/天、5 个 cron、CPU 10ms；R2 写 100 万/月（288 次/天远低于限额），出站免费；
- Worker 免费版 CPU 只有 10ms：建议把“当天检查样本 + 60 天 daily + 最近 14 天 hourly”作为一份 state.json 增量更新，避免每次全量重算；
- 大陆访问：Workers/R2 自定义域在大陆不稳定是最大风险；保留 GitHub raw 或大陆对象存储作为兜底。

### 形态 2（改动最小，复用现有 Go 代码）

```
Oracle Cloud Always Free VM（日本/首尔/新加坡）
   └─ systemd timer 每 5 分钟跑 checkshell/statuscheck
        ├─ 写本机 logs/ 与 data/status.json（现有逻辑不变）
        ├─ 推送到 GitHub page 分支（PAT）或 R2 / 或本机 Caddy 暴露
        ▼
页面（GitHub Pages）：读 status.json
GitHub Actions：只部署页面
```

- 优点：现有 Go 聚合/通知代码原样复用，无 CPU/子请求限制，日本节点到大陆通常比美国稳；
- 缺点：需要注册 Oracle（可能要信用卡验证，热门区域 ARM 容量紧张，注意其免费资源回收条款）；需要自己维护系统；
- 暴露数据：Caddy/Cloudflare Tunnel（免费）反向代理 `status.json`，或用 rclone 推到 R2、R2 自定义域读取。

### 形态 3（完全不自己跑，牺牲自定义能力）

- 用 UptimeRobot / Better Stack / StatusCake 免费档做检测 + 存储 + 状态页；
- 页面直接嵌入它们的 status page，或用一个小代理读它们的 API；
- 代价：检查频率受限（UptimeRobot 免费 5 分钟）、历史/延迟数据受它们的产品模型限制、自定义的 60 天 P50/P95 图表基本放弃、判定规则不可改。

### 数据交付的硬限制

- **不要用 GitHub Pages 每 5 分钟发布数据**：Pages 有约 10 次/小时的构建软限制，每 5 分钟部署会被限流；GitHub Actions 只应在代码变更时部署静态文件。
- 页面保留现有“同源 + 远程 dataUrl 选新”的逻辑，把 `dataUrl` 指向 Worker/R2/VM 的 `status.json` 即可；
- 不要在前端浏览器里直接调 Globalping/check-host：会消耗每 IP 250 次/小时额度、有 CORS/异步等待问题、拿不到历史，还会把额度打满。

## 十、Globalping 接入设计（全球 ping 接口）

结论：**Globalping 是这类需求里最合适的免费接口**——它是 jsDelivr 的公开探测网络，支持 `ping / http / dns / traceroute / mtr`，可按国家/城市/ASN 选 probe，匿名调用实测 **250 probes/小时**（按 IP）。

### 10.1 实测（2026-11-05，对本站三个真实目标）

每次测量选 CN/HK/JP/US 各 1 个 probe，`type: http`、`protocol: HTTPS`、`method: GET /`，一次 12 probes（3 服务 × 4 区域，消耗 12/250）：

| 目标 | 中国大陆 | 香港 | 日本 | 美国 | 解读 |
| --- | --- | --- | --- | --- | --- |
| www.shadowq.com | 200 / 1001ms | 200 / 186ms | 200 / 83ms | 200 / 245ms | 全球可达，大陆偏慢 |
| mojoo.org | 200 / 1991ms | 200 / 368ms | 200 / 531ms | 200 / 1148ms | 全球可达，大陆/美国偏慢 |
| www.google.com | **failed / 15s** | 200 / 201ms | 200 / 119ms | 200 / 130ms | **典型区域性不可达**：海外正常、大陆超时 |

最后一行正是当前 GitHub Actions（美国 runner）看不到的信息：现在页面会把 Google 显示为“正常”，而大陆用户实际打不开。Globalping 的 CN probe 能把它标成“区域性异常”。

### 10.2 接入方式（对现有项目最小改动）

在 `checkshell` 增加一个 `globalping` 探测模式（与现有本地探测并列，配置开关）：

```jsonc
// src/config.json 追加
"probe": {
  "mode": "globalping",              // local | globalping | hybrid（默认 local，不影响现有部署）
  "globalping": {
    "type": "http",                  // http（看状态码）或 ping（看 ICMP）
    "locations": [
      { "country": "CN", "limit": 1 },
      { "country": "HK", "limit": 1 },
      { "country": "JP", "limit": 1 },
      { "country": "US", "limit": 1 }
    ],
    "timeoutMs": 20000,               // 等测量结果的总超时
    "fallbackToLocal": true           // Globalping 故障时降级本地探测，而不是判故障
  }
}
```

每次检查流程：
1. 对每个服务 `POST https://api.globalping.io/v1/measurements`（一个 measurement 包含多个 locations，减少请求数）；
2. 轮询 `GET /v1/measurements/{id}` 直到 `finished`（通常 2~15 秒，三个服务并行）；
3. 解析每个 probe 的 `statusCode` / `timings` / `resolvedAddress`；
4. 判定：
   - 所有 region 成功 → `success`；
   - 一部分 region 成功、一部分失败 → `partial`（区域性异常，页面标黄）；
   - 全部失败 → `failure`；
   - Globalping API 本身不可用/限流 → 降级本地探测（或标 `partial`），**不能把服务判成 failure**；
5. 延迟：取所有成功 region 的 `timings` 中位数（页面的 P50/P95 仍然只统计成功检查）；
6. 可选：把 region 明细写进 status.json（`regions: [{country, city, ok, latency}]`），页面可展示“大陆/海外”两列；不写也不影响现有页面。

### 10.3 速率预算

| 检查间隔 | 每次 probes | 每小时消耗 | 250/h 限额 |
| --- | --- | --- | --- |
| 4 分钟 | 3 服务 × 4 region = 12 | 180/h | 72% |
| 5 分钟 | 12 | 144/h | 58% |
| 5 分钟 | 3 服务 × 2 region（CN+US）= 6 | 72/h | 29% |

建议第一版用 **CN + HK/JP + US 共 3~4 个 region、每 5 分钟一次**；如果只关心“大陆 + 海外”两个视角，用 CN+US 两个 probe 就够，额度更省。

### 10.4 谁来调用它会决定整体形态

- **暂时继续用 GitHub Actions**：加一个外部 cron（cron-job.org）每 30 分钟 dispatch 一次，job 内每 4~5 分钟调用 Globalping；这是“最小可运行版本”，不改页面。
- **目标形态（GitHub 只发布页面）**：把同样逻辑放到 Cloudflare Worker Cron 或 Oracle VM；Worker 版直接调 Globalping + 写 R2；VM 版跑 Go 二进制（本方案原样复用）。
- 不建议浏览器直连 Globalping：每 IP 250/h 会被访客耗尽，且测量是异步的、无历史。

### 10.5 其他全球 ping 接口对比

| 接口 | 免费情况 | 大陆节点 | 适合度 |
| --- | --- | --- | --- |
| **Globalping** | 匿名 250 probes/h，注册更高 | **有**（北上广深等） | ★★★★★ 首选 |
| check-host.net | 免费、无鉴权、55 节点 | 无（有香港） | ★★★ 兜底佐证 |
| ping.pe / itdog / boce | 无公开稳定 API | 有（页面） | ★ 不适合自动化 |
| UptimeRobot / Better Stack | 免费监控 SaaS | 取决于其节点 | ★★ 只适合告警/状态页 |

### 10.6 已实现（2026-11-05）

- Go 新增 [checkshell/globalping/globalping.go](../checkshell/globalping/globalping.go)：Globalping measurements 客户端（创建测量 → 轮询 → 归一化结果；限流/超时/API 错误返回 error 供降级）；
- `checkshell/main.go` 增加 `probe.mode = local | globalping | hybrid`，默认 `local`，行为与之前完全一致；Globalping 故障时按 `fallbackToLocal` 降级，不会把服务判成 failure；
- 配置示例与说明已写入 [README.md](../README.md) 和 [data-contract-v2.md](data-contract-v2.md)；`GLOBALPING_TOKEN` 可选（workflow 已透传 secret，未配置时用匿名额度）；
- 单测：`go test ./...` 全绿，新增 globalping 客户端 10 个用例（成功/部分/全失败/429/500/轮询超时/鉴权头/非法目标/请求体）与 probe 模式 12 个用例（local/globalping/hybrid/fallback/配置校验）；
- 真实三服务验证（2026-11-05 04:20，Globalping 实网 4 地区各 1 probe）：

| 模式 | ShadowQ | Mojoo | Google | 说明 |
| --- | --- | --- | --- | --- |
| globalping | success 4/4，216ms | success 4/4，672ms | **partial 3/4，57ms** | 大陆节点对 Google 超时，其余地区 200 → 正确识别区域性异常 |
| hybrid | success（本地 2/2） | success（本地 2/2） | **partial 3/4** | 本地成功时不调用 Globalping；本地失败时才多地区佐证 |
| local（默认，未改行为） | success 3/3 | success 3/3 | failure（本机网络无法访问） | 与 v2 原有行为一致 |

- 速率：该次验证共 12 probes（3 服务 × 4 地区），远低于 250/h；页面无需任何改动（`data/status.json` schema 不变）。
