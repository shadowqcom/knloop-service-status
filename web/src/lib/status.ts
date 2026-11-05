// 状态数据层：纯函数（不依赖 DOM / fetch / Svelte），供页面与 Vitest 单测复用。
// 数据契约见 docs/worker-api-contract.md（schema 2）。

export type StatusKind = 'success' | 'partial' | 'failure' | 'nodata';

export const STATUS_DAY_COUNT = 60;
export const DEFAULT_STALE_AFTER_MIN = 45;
export const DEFAULT_MAX_HOUR = 12;
export const DEFAULT_POLL_SECONDS = 60;

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const BEIJING_OFFSET_MS = 8 * HOUR_MS;

export class StatusDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatusDataError';
  }
}

export const STATUS_LABELS: Record<StatusKind, string> = {
  success: '正常',
  failure: '故障',
  partial: '异常',
  nodata: '无数据'
};

export const STATUS_BG_CLASS: Record<StatusKind, string> = {
  success: 'bg-success',
  failure: 'bg-failure',
  partial: 'bg-partial',
  nodata: 'bg-nodata'
};

export const STATUS_TEXT_CLASS: Record<StatusKind, string> = {
  success: 'text-success',
  failure: 'text-failure',
  partial: 'text-partial',
  nodata: 'text-nodata'
};

export const STATUS_HEX: Record<StatusKind, string> = {
  success: '#00dfa2',
  failure: '#ff0060',
  partial: '#ffb84c',
  nodata: '#dddddd'
};

export interface ProviderInfo {
  name: string;
  ok: boolean;
  latencyMs: number | null;
  detail?: string;
}

/** 单个自然日（北京时间）的聚合数据 */
export interface DailyPoint {
  date: string;
  status: StatusKind;
  uptimePct: number | null;
  p50: number | null;
  p95: number | null;
  checks: number;
  failures: number;
}

/** [unixHourStart, p50, p95]，升序 */
export type HourlyRow = [number, number | null, number | null];

export interface StatusChecks {
  success: number;
  partial: number;
  failure: number;
  total: number;
  todayTotal: number;
  todayFailures: number;
  lastFailureAt: string | null;
}

export interface ServiceViewModel {
  key: string;
  title: string;
  url: string;
  status: StatusKind;
  latency: number | null;
  lastCheckAtMs: number | null;
  lastCheckAt: string | null;
  uptime: number | null;
  successRate: number | null;
  errorRate: number | null;
  checks: StatusChecks;
  daily: DailyPoint[];
  statusPoints: DailyPoint[];
  hourly: HourlyRow[];
  avgLatency: number | null;
  todayFailures: number;
  lastFailureAtMs: number | null;
  lastFailureTime: string | null;
  consecutiveOkDays: number;
  providers: ProviderInfo[];
}

export interface Summary {
  total: number;
  success: number;
  partial: number;
  failure: number;
  nodata: number;
  avgUptime: string;
  avgSuccessRate: string;
  avgErrorRate: string;
  totalSuccessRate: string;
  totalFailures: number;
  longestOutageDays: number;
  avgLatency: number;
  todayFailures: number;
  servicesWithFailures: number;
  maxConsecutiveDays: number;
  lastFailureTime: string | null;
  statusText: string;
  statusClass: string;
}

export type WarningType = 'stale' | 'refresh-failed' | 'fallback';

export interface Warning {
  type: WarningType;
  message: string;
}

export interface StatusSnapshot {
  schema: number;
  generatedAt: string | null;
  generatedAtUnix: number | null;
  retentionDays: number;
  services: Array<Record<string, unknown>>;
}

export interface Dashboard {
  schema: number;
  retentionDays: number;
  generatedAtUnix: number | null;
  generatedAtMs: number | null;
  generatedAtText: string;
  relativeTime: string;
  lastUpdateText: string;
  stale: boolean;
  staleText: string;
  services: ServiceViewModel[];
  summary: Summary;
  overallStatus: StatusKind;
  statusText: string;
  statusClass: string;
  warnings: Warning[];
}

export interface ChartPayload {
  labels: string[];
  /** 完整日期+小时，用于 tooltip 标题；labels 仍只放 HH:mm 给 x 轴 */
  tooltipTitles: string[];
  median: Array<number | null>;
  p95: Array<number | null>;
  yMax: number | null;
}

export interface BuildOptions {
  now?: number;
  staleAfterMinutes?: number;
  maxDays?: number;
  maxHour?: number;
  sourceLabel?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pad2(value: number): string {
  return value < 10 ? '0' + value : String(value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function normalizeStatus(status: unknown): StatusKind {
  return status === 'success' || status === 'partial' || status === 'failure' ? status : 'nodata';
}

/** 北京时间日期 YYYY-MM-DD（固定 UTC+8，不依赖运行环境时区） */
export function beijingDateStr(ms: number): string {
  const date = new Date(ms + BEIJING_OFFSET_MS);
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
}

/** 北京时间当天 00:00 的毫秒时间戳 */
export function startOfBeijingDayMs(ms: number): number {
  return Math.floor((ms + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS;
}

/** YYYY-MM-DD（北京时间）-> 当天 00:00 毫秒时间戳；非法返回 null */
export function beijingDateStartMs(dateStr: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const ms = Date.parse(dateStr + 'T00:00:00+08:00');
  return Number.isNaN(ms) ? null : ms;
}

/** 北京时间小时（0-23） */
export function getBeijingHour(ms: number): number {
  return new Date(ms + BEIJING_OFFSET_MS).getUTCHours();
}

/** 北京时间 YYYY-MM-DD HH:mm */
export function formatBeijingDateTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '暂无数据';
  const date = new Date(ms + BEIJING_OFFSET_MS);
  return beijingDateStr(ms) + ' ' + pad2(date.getUTCHours()) + ':' + pad2(date.getUTCMinutes());
}

/** 相对时间文案（中文） */
export function formatRelativeTime(ms: number | null, now: number = Date.now()): string {
  if (ms === null || !Number.isFinite(ms)) return '';
  const diff = Math.max(0, now - ms);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return minutes + ' 分钟前';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' 小时前';
  return Math.floor(hours / 24) + ' 天前';
}

/** 解析时间戳：数字（秒/毫秒）、ISO 字符串、'YYYY-MM-DD HH:mm:ss'（按北京时间） */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value !== 'string') return null;
  const str = value.trim();
  if (!str) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(str)) {
    const ms = Date.parse(str);
    return Number.isNaN(ms) ? null : ms;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const ms = Date.parse(str + 'T00:00:00+08:00');
    return Number.isNaN(ms) ? null : ms;
  }
  const ms = Date.parse(str.replace(' ', 'T') + '+08:00');
  return Number.isNaN(ms) ? null : ms;
}

/** 统一为 Unix 秒 */
export function coerceUnixSeconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value > 1e12 ? value / 1000 : value);
  }
  const ms = parseTimestamp(value);
  return ms === null ? null : Math.floor(ms / 1000);
}

/** 解析状态快照对象；结构不合法时抛出 StatusDataError */
export function parseStatusSnapshot(value: unknown): StatusSnapshot {
  if (!isRecord(value)) throw new StatusDataError('status.json 根节点必须是对象');
  if (!Array.isArray(value.services)) throw new StatusDataError('status.json 缺少 services 数组');
  const services: Array<Record<string, unknown>> = [];
  for (const item of value.services) {
    if (isRecord(item)) services.push(item);
  }
  return {
    schema: finite(value.schema) ?? 2,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : null,
    generatedAtUnix: coerceUnixSeconds(value.generatedAtUnix),
    retentionDays: finite(value.retentionDays) ?? STATUS_DAY_COUNT,
    services
  };
}

/** 解析 /api/status 返回的 JSON 文本 */
export function parseStatusJson(text: string): StatusSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new StatusDataError('status.json 不是合法 JSON: ' + (error as Error).message);
  }
  return parseStatusSnapshot(value);
}

/** daily 原始行 -> 按日期索引的 DailyPoint */
export function normalizeDaily(daily: unknown): Map<string, DailyPoint> {
  const map = new Map<string, DailyPoint>();
  if (!Array.isArray(daily)) return map;
  for (const row of daily) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const date = typeof row[0] === 'string' ? row[0] : '';
    if (!date) continue;
    map.set(date, {
      date,
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

/** hourly 原始行 -> 升序元组，容错毫秒时间戳 */
export function normalizeHourly(hourly: unknown): HourlyRow[] {
  const rows: HourlyRow[] = [];
  if (!Array.isArray(hourly)) return rows;
  for (const row of hourly) {
    if (!Array.isArray(row) || row.length < 2) continue;
    let sec = finite(row[0]);
    if (sec === null) continue;
    if (sec > 1e12) sec = Math.floor(sec / 1000);
    rows.push([Math.floor(sec), finite(row[1]), finite(row[2])]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  return rows;
}

/** 生成固定 60 个状态块（缺失日期补 nodata，最后一块为北京时间今天） */
export function buildStatusPoints(
  dailyMap: Map<string, DailyPoint>,
  now: number,
  dayCount: number = STATUS_DAY_COUNT
): DailyPoint[] {
  const todayStart = startOfBeijingDayMs(now);
  const points: DailyPoint[] = [];
  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
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

function normalizeChecks(checks: unknown, statusPoints: DailyPoint[], today: string): StatusChecks {
  const source = isRecord(checks) ? checks : {};
  let success = finite(source.success) ?? 0;
  let partial = finite(source.partial) ?? 0;
  let failure = finite(source.failure) ?? 0;
  let total = finite(source.total) ?? success + partial + failure;

  if (total === 0) {
    for (const point of statusPoints) {
      success += point.checks > 0 && point.uptimePct !== null ? Math.round((point.uptimePct / 100) * point.checks) : 0;
      failure += point.failures;
      total += point.checks;
    }
    partial = Math.max(0, total - success - failure);
  }

  const todayPoint = statusPoints.find((point) => point.date === today);
  return {
    success,
    partial,
    failure,
    total,
    todayTotal: finite(source.todayTotal) ?? todayPoint?.checks ?? 0,
    todayFailures: finite(source.todayFailures) ?? todayPoint?.failures ?? 0,
    lastFailureAt: typeof source.lastFailureAt === 'string' ? source.lastFailureAt : null
  };
}

function computeUptime(uptime: unknown, checks: StatusChecks): number | null {
  const explicit = finite(uptime);
  if (explicit !== null) return Math.max(0, Math.min(100, round2(explicit)));
  if (checks.total > 0) return round2((checks.success / checks.total) * 100);
  return null;
}

/** 最近 24h 每小时 P50 的均值（与现有页面语义一致） */
export function computeAvgLatency(hourly: HourlyRow[], now: number): number | null {
  const since = now - 24 * HOUR_MS;
  const values: number[] = [];
  for (const row of hourly) {
    if (row[0] * 1000 < since) continue;
    if (row[1] === null) continue;
    values.push(row[1]);
  }
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return Math.round(sum / values.length);
}

/** 连续正常天数：nodata 不计入也不打断 */
export function computeConsecutiveOkDays(statusPoints: DailyPoint[]): number {
  let days = 0;
  for (let index = statusPoints.length - 1; index >= 0; index -= 1) {
    const status = statusPoints[index].status;
    if (status === 'nodata') continue;
    if (status === 'success') days += 1;
    else break;
  }
  return days;
}

function deriveLastStatus(statusPoints: DailyPoint[]): StatusKind {
  for (let index = statusPoints.length - 1; index >= 0; index -= 1) {
    const status = statusPoints[index].status;
    if (status !== 'nodata') return status;
  }
  return 'nodata';
}

function normalizeProviders(value: unknown): ProviderInfo[] {
  if (!Array.isArray(value)) return [];
  const list: ProviderInfo[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === 'string' ? item.name : '';
    if (!name) continue;
    list.push({
      name,
      ok: item.ok === true,
      latencyMs: finite(item.latencyMs),
      detail: typeof item.detail === 'string' ? item.detail : undefined
    });
  }
  return list;
}

/** 单个 service 原始对象 -> 页面视图模型 */
export function buildService(raw: unknown, options: { now?: number; maxDays?: number } = {}): ServiceViewModel {
  const now = options.now ?? Date.now();
  const source = isRecord(raw) ? raw : {};
  const key = typeof source.key === 'string' && source.key ? source.key : '';
  const dayCount = options.maxDays && options.maxDays > 0 ? options.maxDays : STATUS_DAY_COUNT;
  const dailyMap = normalizeDaily(source.daily);
  const statusPoints = buildStatusPoints(dailyMap, now, dayCount);
  const today = beijingDateStr(now);
  const hourly = normalizeHourly(source.hourly);
  const checks = normalizeChecks(source.checks, statusPoints, today);
  const uptime = computeUptime(source.uptime, checks);
  const successRate = finite(source.successRate)
    ?? (checks.total > 0 ? Math.round((checks.success / checks.total) * 10000) / 100 : null);
  const errorRate = finite(source.errorRate)
    ?? (checks.total > 0 ? Math.round(((checks.partial + checks.failure) / checks.total) * 10000) / 100 : null);
  const lastCheckAtMs = parseTimestamp(source.lastCheckAt) ?? finite(source.lastCheckAtMs);
  const lastFailureAtMs = parseTimestamp(checks.lastFailureAt);
  const lastStatus = source.status !== undefined && source.status !== null
    ? normalizeStatus(source.status)
    : deriveLastStatus(statusPoints);

  return {
    key,
    title: typeof source.title === 'string' && source.title ? source.title : key,
    url: typeof source.url === 'string' ? source.url : '',
    status: lastStatus,
    latency: finite(source.latency),
    lastCheckAtMs,
    lastCheckAt: lastCheckAtMs === null ? null : formatBeijingDateTime(lastCheckAtMs),
    uptime,
    successRate,
    errorRate,
    checks,
    daily: statusPoints,
    statusPoints,
    hourly,
    avgLatency: computeAvgLatency(hourly, now),
    todayFailures: checks.todayFailures,
    lastFailureAtMs,
    lastFailureTime: lastFailureAtMs === null ? null : formatBeijingDateTime(lastFailureAtMs),
    consecutiveOkDays: computeConsecutiveOkDays(statusPoints),
    providers: normalizeProviders(source.providers)
  };
}

/** 总状态判定（契约 3.2） */
export function computeOverallStatus(statuses: Array<StatusKind | string | null | undefined>): StatusKind {
  const list = Array.isArray(statuses) ? statuses.map(normalizeStatus) : [];
  const total = list.length;
  if (total === 0) return 'nodata';
  const count = { success: 0, failure: 0, partial: 0, nodata: 0 };
  for (const status of list) count[status] += 1;
  if (count.success === total) return 'success';
  if (count.failure > 0) return 'failure';
  if (count.partial > 0) return 'partial';
  return 'nodata';
}

/** 汇总所有服务（顶部/底部统计区） */
function longestFailureDayStreak(daily: DailyPoint[]): number {
  let best = 0;
  let current = 0;
  for (const point of daily) {
    if (point.status === 'failure') {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return best;
}

export function summarize(services: ServiceViewModel[]): { summary: Summary; overallStatus: StatusKind } {
  const list = Array.isArray(services) ? services : [];
  const total = list.length;
  const counts = { success: 0, failure: 0, partial: 0, nodata: 0 };
  let uptimeSum = 0;
  let uptimeCount = 0;
  let successRateSum = 0;
  let successRateCount = 0;
  let errorRateSum = 0;
  let errorRateCount = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let todayFailures = 0;
  let servicesWithFailures = 0;
  let maxConsecutiveDays = 0;
  let totalChecks = 0;
  let totalSuccessChecks = 0;
  let totalFailureChecks = 0;
  let longestOutageDays = 0;
  let lastFailureAtMs: number | null = null;

  for (const service of list) {
    counts[service.status] += 1;
    if (service.uptime !== null) {
      uptimeSum += service.uptime;
      uptimeCount += 1;
    }
    if (service.successRate !== null) {
      successRateSum += service.successRate;
      successRateCount += 1;
    }
    if (service.errorRate !== null) {
      errorRateSum += service.errorRate;
      errorRateCount += 1;
    }
    if (service.avgLatency !== null) {
      latencySum += service.avgLatency;
      latencyCount += 1;
    }
    todayFailures += service.todayFailures || 0;
    if ((service.todayFailures || 0) > 0) servicesWithFailures += 1;
    totalChecks += service.checks.total;
    totalSuccessChecks += service.checks.success;
    // “总故障次数”按非成功检查计数（含异常 + 故障），与总成功率互补。
    totalFailureChecks += service.checks.partial + service.checks.failure;
    longestOutageDays = Math.max(longestOutageDays, longestFailureDayStreak(service.daily));
    if (service.consecutiveOkDays > maxConsecutiveDays) maxConsecutiveDays = service.consecutiveOkDays;
    if (service.lastFailureAtMs !== null && (lastFailureAtMs === null || service.lastFailureAtMs > lastFailureAtMs)) {
      lastFailureAtMs = service.lastFailureAtMs;
    }
  }

  const overallStatus = computeOverallStatus(list.map((service) => service.status));
  let statusText: string;
  if (overallStatus === 'success') statusText = '所有服务运行正常';
  else if (overallStatus === 'failure') statusText = counts.failure === total && total > 0 ? '所有服务均不可用' : counts.failure + ' 个服务故障';
  else if (overallStatus === 'partial') statusText = counts.partial + ' 个服务异常';
  else if (counts.success > 0) statusText = '部分服务暂无数据';
  else statusText = '暂无监控数据';

  return {
    summary: {
      total,
      success: counts.success,
      partial: counts.partial,
      failure: counts.failure,
      nodata: counts.nodata,
      avgUptime: uptimeCount > 0 ? round2(uptimeSum / uptimeCount).toFixed(2) : '0.00',
      totalSuccessRate: totalChecks > 0 ? (Math.round((totalSuccessChecks / totalChecks) * 10000) / 100).toFixed(2) : '0.00',
      totalFailures: totalFailureChecks,
      longestOutageDays,
      avgSuccessRate: successRateCount > 0 ? (successRateSum / successRateCount).toFixed(2) : '0.00',
      avgErrorRate: errorRateCount > 0 ? (errorRateSum / errorRateCount).toFixed(2) : '0.00',
      avgLatency: latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0,
      todayFailures,
      servicesWithFailures,
      maxConsecutiveDays,
      lastFailureTime: lastFailureAtMs === null ? null : formatBeijingDateTime(lastFailureAtMs),
      statusText,
      statusClass: STATUS_TEXT_CLASS[overallStatus]
    },
    overallStatus
  };
}

/** 数据是否过期（now - generatedAtUnix > staleAfterMinutes） */
export function isStale(
  generatedAtUnix: number | null,
  now: number = Date.now(),
  staleAfterMinutes: number = DEFAULT_STALE_AFTER_MIN
): boolean {
  if (generatedAtUnix === null || !Number.isFinite(generatedAtUnix)) return false;
  return now / 1000 - generatedAtUnix > staleAfterMinutes * 60;
}

interface MetaFields {
  generatedAtMs: number | null;
  generatedAtText: string;
  relativeTime: string;
  lastUpdateText: string;
  stale: boolean;
  staleText: string;
}

function buildMeta(generatedAtUnix: number | null, now: number, staleAfterMinutes: number): MetaFields {
  const generatedAtMs = generatedAtUnix === null ? null : generatedAtUnix * 1000;
  const stale = isStale(generatedAtUnix, now, staleAfterMinutes);
  const relativeTime = generatedAtMs === null ? '' : formatRelativeTime(generatedAtMs, now);
  return {
    generatedAtMs,
    generatedAtText: generatedAtMs === null ? '' : formatBeijingDateTime(generatedAtMs),
    relativeTime,
    lastUpdateText: generatedAtMs === null ? '暂无数据' : formatBeijingDateTime(generatedAtMs) + '（' + relativeTime + '）',
    stale,
    staleText: stale ? '数据可能延迟（最后采集于 ' + formatBeijingDateTime(generatedAtMs) + '）' : ''
  };
}

/** 构建页面直接渲染的 dashboard */
export function buildDashboard(snapshot: StatusSnapshot, options: BuildOptions = {}): Dashboard {
  const now = options.now ?? Date.now();
  const staleAfterMinutes = options.staleAfterMinutes ?? DEFAULT_STALE_AFTER_MIN;
  const services = (Array.isArray(snapshot.services) ? snapshot.services : []).map((service) =>
    buildService(service, { now, maxDays: options.maxDays })
  );
  const overview = summarize(services);
  const generatedAtUnix = coerceUnixSeconds(snapshot.generatedAtUnix ?? snapshot.generatedAt);
  const meta = buildMeta(generatedAtUnix, now, staleAfterMinutes);
  const warnings: Warning[] = [];
  if (meta.stale) warnings.push({ type: 'stale', message: meta.staleText });

  return {
    schema: snapshot.schema,
    retentionDays: snapshot.retentionDays,
    generatedAtUnix,
    ...meta,
    services,
    summary: overview.summary,
    overallStatus: overview.overallStatus,
    statusText: overview.summary.statusText,
    statusClass: overview.summary.statusClass,
    warnings
  };
}

/** 刷新失败/定时刷新时只重算时间与过期字段，不重建服务数据 */
export function applyFreshness(dashboard: Dashboard, options: BuildOptions = {}): Dashboard {
  const now = options.now ?? Date.now();
  const staleAfterMinutes = options.staleAfterMinutes ?? DEFAULT_STALE_AFTER_MIN;
  const meta = buildMeta(dashboard.generatedAtUnix, now, staleAfterMinutes);
  const warnings = dashboard.warnings.filter((warning) => warning.type !== 'stale');
  if (meta.stale) warnings.push({ type: 'stale', message: meta.staleText });
  return { ...dashboard, ...meta, warnings };
}

/** 追加/替换同类型告警（如 refresh-failed） */
export function addWarning(dashboard: Dashboard, warning: Warning): Dashboard {
  const warnings = dashboard.warnings.filter((item) => item.type !== warning.type);
  warnings.push(warning);
  return { ...dashboard, warnings };
}

/** 图表数据：默认最近 maxHour+1 个整点；选中某天时取该天 00:00~当前/23:00，缺失小时为 null */
export function selectHourlyWindow(
  service: Pick<ServiceViewModel, 'hourly'> | null | undefined,
  selectedDay: string | null = null,
  options: { now?: number; maxHour?: number } = {}
): ChartPayload {
  const now = options.now ?? Date.now();
  const maxHour = Math.max(1, Number(options.maxHour) || DEFAULT_MAX_HOUR);
  const hourly = service && Array.isArray(service.hourly) ? service.hourly : [];
  const byHour = new Map<number, HourlyRow>();
  for (const row of hourly) byHour.set(row[0], row);

  const labels: string[] = [];
  const tooltipTitles: string[] = [];
  const median: Array<number | null> = [];
  const p95: Array<number | null> = [];
  const hourStartSec = (ms: number): number => Math.floor(ms / HOUR_MS) * 3600;

  if (selectedDay) {
    const dayStartMs = beijingDateStartMs(selectedDay);
    if (dayStartMs === null) return { labels, tooltipTitles, median, p95, yMax: 15 };
    const today = beijingDateStr(now);
    const endHour = selectedDay === today ? getBeijingHour(now) : 23;
    for (let hour = 0; hour <= endHour; hour += 1) {
      const row = byHour.get(hourStartSec(dayStartMs + hour * HOUR_MS));
      labels.push(pad2(hour) + ':00');
      tooltipTitles.push(selectedDay + ' ' + pad2(hour) + ':00');
      median.push(row ? row[1] : null);
      p95.push(row ? row[2] : null);
    }
  } else {
    const currentHourMs = Math.floor(now / HOUR_MS) * HOUR_MS;
    for (let offset = maxHour; offset >= 0; offset -= 1) {
      const hourMs = currentHourMs - offset * HOUR_MS;
      const row = byHour.get(Math.floor(hourMs / 1000));
      labels.push(pad2(getBeijingHour(hourMs)) + ':00');
      tooltipTitles.push(beijingDateStr(hourMs) + ' ' + pad2(getBeijingHour(hourMs)) + ':00');
      median.push(row ? row[1] : null);
      p95.push(row ? row[2] : null);
    }
  }

  const values: number[] = [];
  for (const value of median) if (value !== null && Number.isFinite(value)) values.push(value);
  for (const value of p95) if (value !== null && Number.isFinite(value)) values.push(value);
  const yMax = values.length === 0 || Math.max(...values) <= 14 ? 15 : null;
  return { labels, tooltipTitles, median, p95, yMax };
}

/** 选中日期对应的 daily 数据块 */
export function getSelectedDayPoint(service: ServiceViewModel, selectedDay: string | null): DailyPoint | null {
  if (!selectedDay) return null;
  return service.statusPoints.find((point) => point.date === selectedDay) ?? null;
}

/** 卡片下方“响应时间(ms)”行的文案 */
export function formatAvgLatencyText(service: ServiceViewModel, selectedDay: string | null): string {
  if (selectedDay) {
    const point = getSelectedDayPoint(service, selectedDay);
    return point && point.p50 !== null ? '当日 P50 延迟 ' + point.p50 + 'ms' : '当日暂无延迟数据';
  }
  return service.avgLatency !== null ? '24小时内平均延迟 ' + service.avgLatency + 'ms' : '24小时内暂无延迟数据';
}

export function formatUptime(service: Pick<ServiceViewModel, 'uptime'>): string {
  if (service.uptime === null || service.uptime === undefined) return '--';
  return service.uptime.toFixed(2);
}

/** 状态块悬浮/选中提示文案 */
export function formatStatusPoint(point: DailyPoint | null | undefined): string {
  if (!point) return '';
  const label = STATUS_LABELS[point.status] || point.status;
  const parts = [point.date, label];
  if (point.p50 !== null) parts.push('P50 ' + point.p50 + 'ms');
  if (point.p95 !== null) parts.push('P95 ' + point.p95 + 'ms');
  if (point.checks) parts.push(point.checks + ' 次检查');
  if (point.failures) parts.push(point.failures + ' 次失败');
  return parts.join(' · ');
}
