// 前端 v2 纯数据层：status.json / legacy 日志 -> 页面视图模型。
// 本模块不依赖 DOM、fetch、localStorage，可被 node --test 直接单测。
import { parseBeijingTime } from './utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const BEIJING_OFFSET_MS = 8 * HOUR_MS;

/** 契约 3.2：状态块固定 60 个（CSS Grid 60 列） */
export const STATUS_DAY_COUNT = 60;

export const STATUS_LABELS = Object.freeze({
  success: '正常',
  failure: '故障',
  partial: '异常',
  nodata: '无数据'
});

export const STATUS_BG_CLASS = Object.freeze({
  success: 'bg-success',
  failure: 'bg-failure',
  partial: 'bg-partial',
  nodata: 'bg-nodata'
});

export const STATUS_TEXT_CLASS = Object.freeze({
  success: 'text-success',
  failure: 'text-failure',
  partial: 'text-partial',
  nodata: 'text-nodata'
});

export function normalizeStatus(status) {
  return status === 'success' || status === 'partial' || status === 'failure' ? status : 'nodata';
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** 北京时间日期 YYYY-MM-DD */
export function beijingDateStr(ms) {
  const d = new Date(ms + BEIJING_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 北京时间当天 00:00 的时间戳（毫秒） */
export function startOfBeijingDayMs(ms) {
  return Math.floor((ms + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS;
}

/** YYYY-MM-DD（北京时间）-> 当天 00:00 毫秒时间戳 */
export function beijingDateStartMs(dateStr) {
  const ms = Date.parse(`${dateStr}T00:00:00+08:00`);
  return Number.isNaN(ms) ? null : ms;
}

/** 北京时间 HH:mm(:ss) */
export function beijingClock(ms, withSeconds = false) {
  const d = new Date(ms + BEIJING_OFFSET_MS);
  const base = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  return withSeconds ? `${base}:${pad2(d.getUTCSeconds())}` : base;
}

/** 北京时间 YYYY-MM-DD HH:mm */
export function formatBeijingDateTime(ms) {
  if (!Number.isFinite(ms)) return '暂无数据';
  return `${beijingDateStr(ms)} ${beijingClock(ms)}`;
}

/** 相对时间文案（中文） */
export function formatRelativeTime(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const diff = Math.max(0, now - ms);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/**
 * 解析时间戳（数字秒/毫秒、ISO 字符串、旧日志 "YYYY-MM-DD HH:mm:ss"）。
 * @returns {number|null} 毫秒时间戳
 */
export function parseLogTimestamp(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const date = parseBeijingTime(value);
    return date ? date.getTime() : null;
  }
  return null;
}

/** 统一 generatedAtUnix / generatedAt 为 Unix 秒 */
export function coerceUnixSeconds(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value > 1e12 ? value / 1000 : value);
  }
  const ms = parseLogTimestamp(value);
  return ms === null ? null : Math.floor(ms / 1000);
}

/** 取两个 status.json 快照中 generatedAtUnix 更新者（同值优先第一个） */
export function pickFresher(first, second) {
  if (!first) return second || null;
  if (!second) return first;
  const a = coerceUnixSeconds(first.generatedAtUnix ?? first.generatedAt);
  const b = coerceUnixSeconds(second.generatedAtUnix ?? second.generatedAt);
  if (a === null && b === null) return first;
  if (a === null) return second;
  if (b === null) return first;
  return a >= b ? first : second;
}

/**
 * 推导远程 status.json 地址（契约 3.1）。
 * 优先级：config.dataUrl > logspath 推导 > 默认 raw.githubusercontent.com。
 */
export function deriveRemoteDataUrl(config = {}) {
  const explicit = typeof config.dataUrl === 'string' ? config.dataUrl.trim() : '';
  if (explicit) return explicit;

  const logspath = typeof config.logspath === 'string' ? config.logspath.trim().replace(/\/+$/, '') : '';
  if (logspath) {
    if (/\/logs$/i.test(logspath)) {
      return `${logspath.replace(/\/logs$/i, '')}/data/status.json`;
    }
    return `${logspath}/data/status.json`;
  }

  return 'https://raw.githubusercontent.com/shadowqcom/knloop-service-status/page/data/status.json';
}

function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function percentile(values, p) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * 单遍解析日志文本（契约 1.2 + 旧格式兼容）。
 * - 新格式 v2：每行一条检查记录（含 ok/tries），直接读取。
 * - 旧格式 5 行/组（同一 time 连续多行）：只取前 2 行本地探测聚合，第三方行忽略。
 * - 旧格式单行：按一条检查记录读取。
 * @returns {Array<{ts:number,status:string,latency:number|null}>} 按时间升序
 */
export function parseLegacyLogText(text) {
  if (typeof text !== 'string' || !text.trim()) return [];

  const rows = [];
  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // 跳过无法解析的行，不打断整份日志
    }
    if (!obj || typeof obj !== 'object') continue;

    const timeStr = obj.time || obj.timestamp;
    const ts = parseLogTimestamp(timeStr);
    if (ts === null) continue;

    const latency = finite(obj.latency) ?? finite(obj.responseTime);
    const rawStatus = typeof obj.status === 'string' ? obj.status.toLowerCase() : '';
    const status = rawStatus === 'success' || rawStatus === 'partial' || rawStatus === 'failure'
      ? rawStatus
      : (latency !== null ? 'success' : 'failure');

    rows.push({
      timeStr: String(timeStr),
      ts,
      status,
      latency,
      isV2: Object.prototype.hasOwnProperty.call(obj, 'ok') || Object.prototype.hasOwnProperty.call(obj, 'tries')
    });
  }

  const entries = [];
  let index = 0;
  while (index < rows.length) {
    const first = rows[index];

    if (first.isV2) {
      entries.push({ ts: first.ts, status: first.status, latency: first.latency });
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < rows.length && !rows[end].isV2 && rows[end].timeStr === first.timeStr) {
      end += 1;
    }

    const group = rows.slice(index, end);
    if (group.length >= 2) {
      // 旧格式 5 行/组：前 2 行为本地探测，第三方行（3~5）忽略
      const local = group.slice(0, 2);
      const successRows = local.filter((row) => row.status === 'success');
      const failureRows = local.filter((row) => row.status === 'failure');
      let status = 'partial';
      if (successRows.length === local.length) status = 'success';
      else if (failureRows.length === local.length) status = 'failure';

      const latencies = successRows.map((row) => row.latency).filter((value) => value !== null);
      entries.push({ ts: first.ts, status, latency: latencies.length ? median(latencies) : null });
    } else {
      entries.push({ ts: first.ts, status: first.status, latency: first.latency });
    }

    index = end;
  }

  entries.sort((a, b) => a.ts - b.ts);
  return entries;
}

/**
 * 把单条检查记录聚合成与 data/status.json 同构的 daily/hourly/checks。
 * 聚合规则与 Go aggregator 一致：daily 状态 = 0 失败 success；0 成功 failure；其余 partial；无记录 nodata。
 */
export function aggregateLegacyEntries(entries, { now = Date.now(), maxDays = STATUS_DAY_COUNT, maxHour = 12 } = {}) {
  const windowStart = startOfBeijingDayMs(now) - (maxDays - 1) * DAY_MS;
  const dailyMap = new Map();
  const hourlyMap = new Map();

  let successTotal = 0;
  let partialTotal = 0;
  let failureTotal = 0;
  let lastFailureAtMs = null;
  let latest = null;

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || !Number.isFinite(entry.ts) || entry.ts < windowStart || entry.ts > now + 60000) continue; // 忽略未来时间（容错 1 分钟）

    if (!latest || entry.ts >= latest.ts) latest = entry;

    const date = beijingDateStr(entry.ts);
    let day = dailyMap.get(date);
    if (!day) {
      day = { success: 0, partial: 0, failure: 0, latencies: [] };
      dailyMap.set(date, day);
    }

    if (entry.status === 'success') {
      day.success += 1;
      successTotal += 1;
    } else if (entry.status === 'partial') {
      day.partial += 1;
      partialTotal += 1;
    } else {
      day.failure += 1;
      failureTotal += 1;
      if (lastFailureAtMs === null || entry.ts > lastFailureAtMs) lastFailureAtMs = entry.ts;
    }

    const countedLatency = (entry.status === 'success' || entry.status === 'partial') && entry.latency !== null;
    if (countedLatency) day.latencies.push(entry.latency);

    const hourStartMs = Math.floor(entry.ts / HOUR_MS) * HOUR_MS;
    let hour = hourlyMap.get(hourStartMs);
    if (!hour) {
      hour = { latencies: [] };
      hourlyMap.set(hourStartMs, hour);
    }
    if (countedLatency) hour.latencies.push(entry.latency);
  }

  const daily = [];
  const sortedDates = [...dailyMap.keys()].sort();
  for (const date of sortedDates) {
    const day = dailyMap.get(date);
    const checks = day.success + day.partial + day.failure;
    if (checks === 0) continue;
    let status;
    if (day.failure === 0) status = 'success';
    else if (day.success === 0) status = 'failure';
    else status = 'partial';
    daily.push([
      date,
      status,
      round2((day.success / checks) * 100),
      day.latencies.length ? Math.round(median(day.latencies)) : null,
      day.latencies.length ? Math.round(percentile(day.latencies, 95)) : null,
      checks,
      day.failure
    ]);
  }

  const hourly = [...hourlyMap.keys()].sort((a, b) => a - b).map((hourStartMs) => {
    const hour = hourlyMap.get(hourStartMs);
    return [
      Math.floor(hourStartMs / 1000),
      hour.latencies.length ? Math.round(median(hour.latencies)) : null,
      hour.latencies.length ? Math.round(percentile(hour.latencies, 95)) : null
    ];
  });

  const totalChecks = successTotal + partialTotal + failureTotal;
  return {
    generatedAtUnix: latest ? Math.floor(latest.ts / 1000) : null,
    lastCheckAtMs: latest ? latest.ts : null,
    status: latest ? latest.status : 'nodata',
    latency: latest ? latest.latency : null,
    uptime: totalChecks ? round2((successTotal / totalChecks) * 100) : null,
    checks: {
      success: successTotal,
      partial: partialTotal,
      failure: failureTotal,
      total: totalChecks,
      todayTotal: daily.find((row) => row[0] === beijingDateStr(now))?.[5] ?? 0,
      todayFailures: daily.find((row) => row[0] === beijingDateStr(now))?.[6] ?? 0,
      lastFailureAt: lastFailureAtMs === null ? null : new Date(lastFailureAtMs).toISOString()
    },
    daily,
    hourly
  };
}

function normalizeDailyRows(daily) {
  const map = new Map();
  for (const row of Array.isArray(daily) ? daily : []) {
    if (!Array.isArray(row) || row.length < 2 || typeof row[0] !== 'string') continue;
    map.set(row[0], {
      date: row[0],
      status: normalizeStatus(row[1]),
      uptimePct: finite(row[2]),
      p50: finite(row[3]),
      p95: finite(row[4]),
      checks: finite(row[5]) ?? 0,
      failures: finite(row[6]) ?? 0
    });
  }
  return map;
}

function normalizeHourly(hourly) {
  const rows = [];
  for (const row of Array.isArray(hourly) ? hourly : []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    let sec = finite(row[0]);
    if (sec === null) continue;
    if (sec > 1e12) sec = Math.floor(sec / 1000); // 容错：毫秒 -> 秒
    rows.push([Math.floor(sec), finite(row[1]), finite(row[2])]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  return rows;
}

/** 生成固定 60 个状态块（缺失日期补 nodata） */
export function buildStatusPoints(dailyMap, now) {
  const todayStart = startOfBeijingDayMs(now);
  const points = [];
  for (let offset = STATUS_DAY_COUNT - 1; offset >= 0; offset -= 1) {
    const date = beijingDateStr(todayStart - offset * DAY_MS);
    const row = dailyMap.get(date);
    points.push(row ? { ...row } : {
      date,
      status: 'nodata',
      uptimePct: null,
      p50: null,
      p95: null,
      checks: 0,
      failures: 0
    });
  }
  return points;
}

function normalizeChecks(checks, statusPoints, todayStr) {
  const source = checks && typeof checks === 'object' ? checks : {};
  let success = finite(source.success) ?? 0;
  let partial = finite(source.partial) ?? 0;
  let failure = finite(source.failure) ?? 0;
  let total = finite(source.total) ?? success + partial + failure;

  if (total === 0) {
    for (const point of statusPoints) {
      success += point.checks > 0 ? (point.uptimePct !== null ? Math.round((point.uptimePct / 100) * point.checks) : 0) : 0;
      failure += point.failures || 0;
      total += point.checks || 0;
    }
    partial = Math.max(0, total - success - failure);
  }

  const todayRow = statusPoints.find((point) => point.date === todayStr);

  return {
    success,
    partial,
    failure,
    total,
    todayTotal: finite(source.todayTotal) ?? todayRow?.checks ?? 0,
    todayFailures: finite(source.todayFailures) ?? todayRow?.failures ?? 0,
    lastFailureAt: typeof source.lastFailureAt === 'string' ? source.lastFailureAt : null
  };
}

function computeUptime(uptime, checks) {
  const explicit = finite(uptime);
  if (explicit !== null) return Math.max(0, Math.min(100, round2(explicit)));
  if (checks.total > 0) return round2((checks.success / checks.total) * 100);
  return null;
}

/** 最近 24h hourly median 均值（契约 3.2） */
export function computeAvgLatency(hourly, now) {
  const since = now - 24 * HOUR_MS;
  const values = (Array.isArray(hourly) ? hourly : [])
    .filter((row) => row[0] * 1000 >= since && row[1] !== null && row[1] !== undefined)
    .map((row) => row[1]);
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** 连续正常天数：nodata 不计入也不打断（契约 3.2） */
export function computeConsecutiveOkDays(statusPoints) {
  let days = 0;
  for (let index = statusPoints.length - 1; index >= 0; index -= 1) {
    const status = statusPoints[index].status;
    if (status === 'nodata') continue;
    if (status === 'success') days += 1;
    else break;
  }
  return days;
}

function deriveLastStatus(statusPoints) {
  for (let index = statusPoints.length - 1; index >= 0; index -= 1) {
    const status = statusPoints[index].status;
    if (status !== 'nodata') return status;
  }
  return 'nodata';
}

/** status.json 单个 service -> 页面视图模型 */
export function buildService(service, { now = Date.now(), maxDays = STATUS_DAY_COUNT } = {}) {
  const source = service && typeof service === 'object' ? service : {};
  const dailyMap = normalizeDailyRows(source.daily);
  const statusPoints = buildStatusPoints(dailyMap, now);
  const todayStr = beijingDateStr(now);
  const hourly = normalizeHourly(source.hourly);
  const checks = normalizeChecks(source.checks, statusPoints, todayStr);
  const uptime = computeUptime(source.uptime, checks);
  const lastCheckAtMs = parseLogTimestamp(source.lastCheckAt) ?? finite(source.lastCheckAtMs);
  const lastFailureAtMs = parseLogTimestamp(checks.lastFailureAt);
  const lastStatus = source.status
    ? normalizeStatus(source.status)
    : deriveLastStatus(statusPoints);

  return {
    key: String(source.key ?? ''),
    title: String(source.title ?? source.key ?? ''),
    url: typeof source.url === 'string' ? source.url : '',
    lastStatus,
    latency: finite(source.latency),
    lastCheckAtMs,
    lastCheckAt: lastCheckAtMs === null ? null : formatBeijingDateTime(lastCheckAtMs),
    uptime,
    checks,
    daily: statusPoints,
    statusPoints,
    hourly,
    avgLatency: computeAvgLatency(hourly, now),
    todayFailures: checks.todayFailures,
    lastFailureAtMs,
    lastFailureTime: lastFailureAtMs === null ? null : formatBeijingDateTime(lastFailureAtMs),
    consecutiveOkDays: computeConsecutiveOkDays(statusPoints),
    // 交互态（app.js 会覆盖）
    hoveredPoint: null,
    selectedDay: null,
    selectedDayLatency: null
  };
}

/** 总状态判定（契约 3.2） */
export function computeOverallStatus(statuses) {
  const list = Array.isArray(statuses) ? statuses.map(normalizeStatus) : [];
  const total = list.length;
  if (total === 0) return 'nodata';
  const count = { success: 0, failure: 0, partial: 0, nodata: 0 };
  for (const status of list) count[status] += 1;

  if (count.success === total) return 'success';
  if (count.failure > 0) return 'failure';
  if (count.partial > 0) return 'partial';
  if (count.nodata === total) return 'nodata';
  return 'nodata'; // 契约未覆盖 success+nodata 混合：按“部分服务暂无数据”展示，不虚构正常
}

/** 汇总所有服务（顶部/底部统计区） */
export function summarize(services) {
  const list = Array.isArray(services) ? services : [];
  const total = list.length;
  const counts = { success: 0, failure: 0, partial: 0, nodata: 0 };

  let uptimeSum = 0;
  let uptimeCount = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let todayFailures = 0;
  let maxConsecutiveDays = 0;
  let lastFailureAtMs = null;

  for (const service of list) {
    counts[normalizeStatus(service.lastStatus)] += 1;
    if (service.uptime !== null && service.uptime !== undefined) {
      uptimeSum += service.uptime;
      uptimeCount += 1;
    }
    if (service.avgLatency !== null && service.avgLatency !== undefined) {
      latencySum += service.avgLatency;
      latencyCount += 1;
    }
    todayFailures += service.todayFailures || 0;
    if ((service.consecutiveOkDays || 0) > maxConsecutiveDays) maxConsecutiveDays = service.consecutiveOkDays;
    if (service.lastFailureAtMs && (lastFailureAtMs === null || service.lastFailureAtMs > lastFailureAtMs)) {
      lastFailureAtMs = service.lastFailureAtMs;
    }
  }

  const overallStatus = computeOverallStatus(list.map((service) => service.lastStatus));
  let statusText;
  if (overallStatus === 'success') statusText = '所有服务运行正常';
  else if (overallStatus === 'failure') statusText = counts.failure === total && total > 0 ? '所有服务均不可用' : `${counts.failure} 个服务故障`;
  else if (overallStatus === 'partial') statusText = `${counts.partial} 个服务异常`;
  else if (counts.success > 0) statusText = '部分服务暂无数据';
  else statusText = '暂无监控数据';

  return {
    summary: {
      total,
      ...counts,
      avgUptime: uptimeCount > 0 ? round2(uptimeSum / uptimeCount).toFixed(2) : '0.00',
      avgLatency: latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0,
      todayFailures,
      servicesWithFailures: list.filter((service) => (service.todayFailures || 0) > 0).length,
      maxConsecutiveDays,
      lastFailureTime: lastFailureAtMs === null ? null : formatBeijingDateTime(lastFailureAtMs),
      statusText,
      statusClass: STATUS_TEXT_CLASS[overallStatus] || 'text-nodata'
    },
    overallStatus,
    statusText,
    statusClass: STATUS_TEXT_CLASS[overallStatus] || 'text-nodata'
  };
}

function buildMeta(raw, { now = Date.now(), staleAfterMin = 45 } = {}) {
  const generatedAtUnix = coerceUnixSeconds(raw?.generatedAtUnix ?? raw?.generatedAt);
  const generatedAtMs = generatedAtUnix === null ? null : generatedAtUnix * 1000;
  const ageMs = generatedAtMs === null ? null : Math.max(0, now - generatedAtMs);
  const stale = ageMs !== null && ageMs > staleAfterMin * 60000;
  const relativeTime = generatedAtMs === null ? '' : formatRelativeTime(generatedAtMs, now);

  return {
    generatedAtUnix,
    generatedAtMs,
    generatedAtText: generatedAtMs === null ? '' : formatBeijingDateTime(generatedAtMs),
    relativeTime,
    lastUpdateText: generatedAtMs === null ? '暂无数据' : `${formatBeijingDateTime(generatedAtMs)}（${relativeTime}）`,
    stale,
    staleText: stale ? `数据可能延迟（最后采集于 ${formatBeijingDateTime(generatedAtMs)}）` : ''
  };
}

function withStaleWarning(baseWarnings, meta) {
  const warnings = Array.isArray(baseWarnings) ? baseWarnings.filter((warning) => warning && warning.message && warning.type !== 'stale') : [];
  if (meta.stale) warnings.push({ type: 'stale', message: meta.staleText });
  return warnings;
}

/**
 * 生成页面直接渲染的 dashboard。
 * @param {{kind?:string, services:Array, generatedAtUnix?:number, warnings?:Array, sourceLabel?:string}} raw
 */
export function buildDashboard(raw, options = {}) {
  const now = options.now ?? Date.now();
  const serviceList = Array.isArray(raw?.services) ? raw.services : [];
  const services = serviceList.map((service) => buildService(service, { ...options, now }));
  const overview = summarize(services);
  const meta = buildMeta(raw, { ...options, now });
  const warnings = withStaleWarning(raw?.warnings, meta);

  return {
    kind: raw?.kind === 'legacy' ? 'legacy' : 'status',
    sourceLabel: typeof raw?.sourceLabel === 'string' ? raw.sourceLabel : '',
    services,
    summary: overview.summary,
    overallStatus: overview.overallStatus,
    statusText: overview.statusText,
    statusClass: overview.statusClass,
    warnings,
    generatedAtUnix: meta.generatedAtUnix,
    generatedAtText: meta.generatedAtText,
    relativeTime: meta.relativeTime,
    lastUpdateText: meta.lastUpdateText,
    stale: meta.stale,
    staleText: meta.staleText
  };
}

/** 按当前时间重算缓存 dashboard 的“相对时间/新鲜度”展示字段（不改服务数据） */
export function applyFreshness(dashboard, { now = Date.now(), staleAfterMin = 45 } = {}) {
  if (!dashboard) return dashboard;
  const meta = buildMeta({ generatedAtUnix: dashboard.generatedAtUnix }, { now, staleAfterMin });
  const baseWarnings = (dashboard.warnings || []).filter((warning) => warning && warning.type !== 'stale');
  return {
    ...dashboard,
    warnings: withStaleWarning(baseWarnings, meta),
    generatedAtText: meta.generatedAtText,
    relativeTime: meta.relativeTime,
    lastUpdateText: meta.lastUpdateText,
    stale: meta.stale,
    staleText: meta.staleText
  };
}

/**
 * 图表数据：默认取最近 maxHour+1 个整点；选中某天时取该天 00:00~当前/23:00。
 * 返回 {labels, median, p95, yMax}，缺失小时为 null 保持 x 轴连续（契约 3.2）。
 */
export function selectHourlyWindow(service, selectedDay = null, { now = Date.now(), maxHour = 12 } = {}) {
  const hourly = Array.isArray(service?.hourly) ? service.hourly : [];
  const byHour = new Map(hourly.map((row) => [row[0], row]));
  const labels = [];
  const medianData = [];
  const p95Data = [];

  const hourStartSec = (ms) => Math.floor(ms / HOUR_MS) * 3600;

  if (selectedDay) {
    const dayStartMs = beijingDateStartMs(selectedDay);
    const todayStr = beijingDateStr(now);
    const endHour = selectedDay === todayStr ? new Date(now + BEIJING_OFFSET_MS).getUTCHours() : 23;
    if (dayStartMs === null) return { labels, median: medianData, p95: p95Data, yMax: 15 };
    for (let hour = 0; hour <= endHour; hour += 1) {
      const row = byHour.get(hourStartSec(dayStartMs + hour * HOUR_MS));
      labels.push(`${pad2(hour)}:00`);
      medianData.push(row ? row[1] : null);
      p95Data.push(row ? row[2] : null);
    }
  } else {
    const currentHourMs = Math.floor(now / HOUR_MS) * HOUR_MS;
    const hours = Math.max(1, Number(maxHour) || 12);
    for (let offset = hours; offset >= 0; offset -= 1) {
      const hourMs = currentHourMs - offset * HOUR_MS;
      const row = byHour.get(Math.floor(hourMs / 1000));
      labels.push(`${pad2(new Date(hourMs + BEIJING_OFFSET_MS).getUTCHours())}:00`);
      medianData.push(row ? row[1] : null);
      p95Data.push(row ? row[2] : null);
    }
  }

  const values = [...medianData, ...p95Data].filter((value) => value !== null && value !== undefined && Number.isFinite(value));
  const yMax = values.length === 0 || Math.max(...values) <= 14 ? 15 : null;

  return { labels, median: medianData, p95: p95Data, yMax };
}

/** 状态块悬浮/选中提示文案 */
export function formatStatusPoint(point) {
  if (!point) return '';
  const label = STATUS_LABELS[point.status] || point.status;
  const parts = [point.date, label];
  if (point.p50 !== null && point.p50 !== undefined) parts.push(`P50 ${point.p50}ms`);
  if (point.p95 !== null && point.p95 !== undefined) parts.push(`P95 ${point.p95}ms`);
  if (point.checks) parts.push(`${point.checks} 次检查`);
  if (point.failures) parts.push(`${point.failures} 次失败`);
  return parts.join(' · ');
}