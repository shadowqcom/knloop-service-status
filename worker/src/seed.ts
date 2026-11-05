import { buildStatusDocument } from './aggregate';
import { config } from './config';
import { saveState, saveStatus } from './storage';
import { cstDate, cstHourStart, cstIso, startOfCstDay } from './util';
import type {
  AppState,
  CurrentDayStat,
  DayStat,
  Env,
  HourStat,
  ProviderSnapshot,
  ServiceState,
} from './types';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const CHECKS_PER_DAY = 288;
const CHECKS_PER_HOUR = 12;

/** 稳定的伪随机数，保证每次 seed 的数据分布一致。 */
function hash(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function latency(base: number, seed: number, spread = 0.18): number {
  return round1(Math.max(60, base * (1 + (hash(seed) - 0.5) * spread)));
}

function planDay(serviceIndex: number, dayOffset: number): { success: number; partial: number; failure: number } {
  // 固定放几个可见的中断/异常日，其余日期以成功为主，避免整页全绿。
  const failures = [47, 38, 55, 51];
  const partials = [23, 12, 31, 19];
  if (dayOffset === failures[serviceIndex]) return { success: 0, partial: 0, failure: CHECKS_PER_DAY };
  if (dayOffset === partials[serviceIndex]) return { success: 270, partial: 18, failure: 0 };
  if (hash(serviceIndex * 7919 + dayOffset * 13) > 0.94) return { success: 282, partial: 6, failure: 0 };
  return { success: CHECKS_PER_DAY, partial: 0, failure: 0 };
}

function makeDay(date: string, plan: { success: number; partial: number; failure: number }, base: number, seed: number): DayStat {
  const total = plan.success + plan.partial + plan.failure;
  const median = total > 0 ? latency(base, seed, 0.12) : null;
  const p95 = median === null ? null : round1(median * (1.18 + hash(seed + 1) * 0.12));
  return {
    date,
    success: plan.success,
    partial: plan.partial,
    failure: plan.failure,
    median,
    p95,
  };
}

function makeHour(hourStart: number, base: number, seed: number): HourStat {
  const median = latency(base, seed, 0.22);
  return { hourStart, median, p95: round1(median * (1.12 + hash(seed + 2) * 0.16)) };
}

export interface SeedResult {
  services: number;
  days: number;
  checks: number;
}

/**
 * 一次性填充 60 天演示数据；写入 state:v1 和 status:v2，之后正常 Cron 会继续在今天的 currentDay 上累积。
 * 仅供手动测试使用，不应在正常采集流程中调用。
 */
export async function seedDemoData(env: Env, nowMs: number = Date.now()): Promise<SeedResult> {
  const retentionDays = Number.parseInt(env.STATUS_RETENTION_DAYS ?? '', 10) || config.retentionDays;
  const todayStart = startOfCstDay(nowMs);
  const today = cstDate(nowMs);
  const currentHourStart = cstHourStart(nowMs);
  const elapsedTodayChecks = Math.max(CHECKS_PER_HOUR, Math.floor((nowMs - todayStart) / 300_000));
  const windowStart = todayStart - (retentionDays - 1) * DAY_MS;

  const state: AppState = {
    schema: 1,
    updatedAt: cstIso(nowMs),
    retentionDays,
    services: {},
    usage: { date: today, uapis: 0, xxapi: 0 },
  };

  const baseLatencies = [620, 880, 920, 440];

  config.services.forEach((service, serviceIndex) => {
    const base = baseLatencies[serviceIndex] ?? 700;
    const daily: DayStat[] = [];
    const hourly: HourStat[] = [];
    let lastFailureAt: string | null = null;

    // 过去 59 天：daily + 每小时数据。
    for (let dayOffset = 0; dayOffset < retentionDays - 1; dayOffset += 1) {
      const dayStart = windowStart + dayOffset * DAY_MS;
      const date = cstDate(dayStart);
      const plan = planDay(serviceIndex, dayOffset);
      daily.push(makeDay(date, plan, base, serviceIndex * 10000 + dayOffset));
      if (plan.failure > 0) lastFailureAt = cstIso(dayStart + 12 * HOUR_MS);
      for (let hour = 0; hour < 24; hour += 1) {
        hourly.push(makeHour(Math.floor(dayStart / 1000) + hour * 3600, base, serviceIndex * 10000 + dayOffset * 24 + hour));
      }
    }

    // 今天已经过去的整点也用演示数据填上，保证 24 小时折线是满的。
    for (let hour = 0; hour < Math.floor((nowMs - todayStart) / HOUR_MS); hour += 1) {
      hourly.push(makeHour(Math.floor(todayStart / 1000) + hour * 3600, base, serviceIndex * 10000 + 900 + hour));
    }

    const currentLatencies: number[] = [];
    for (let i = 0; i < elapsedTodayChecks; i += 1) {
      currentLatencies.push(latency(base, serviceIndex * 10000 + 5000 + i, 0.14));
    }
    const currentDay: CurrentDayStat = {
      date: today,
      success: elapsedTodayChecks,
      partial: 0,
      failure: 0,
      median: null,
      p95: null,
      latencies: currentLatencies,
    };
    const currentHourLatencies = currentLatencies.slice(-Math.min(CHECKS_PER_HOUR, currentLatencies.length));
    const lastLatency = currentLatencies.at(-1) ?? latency(base, serviceIndex * 10000 + 9999, 0.12);
    const providers: ProviderSnapshot[] = [
      { name: 'globalping', ok: true, latencyMs: lastLatency, detail: '2/2 probes ok · 测试数据' },
      { name: 'xxapi', ok: true, latencyMs: round1(lastLatency * 0.22), detail: '中国 山东 · 测试数据' },
      { name: 'direct', ok: true, latencyMs: round1(lastLatency * 1.08), detail: 'HTTP 200 · 测试数据' },
    ];

    const serviceState: ServiceState = {
      key: service.key,
      url: service.url,
      daily,
      hourly,
      currentDay,
      currentHourStart,
      currentHourLatencies,
      lastStatus: 'success',
      lastLatency,
      lastCheckAt: cstIso(nowMs),
      lastFailureAt,
      providers,
    };
    state.services[service.key] = serviceState;
  });

  const document = buildStatusDocument(state, nowMs);
  await saveState(env.STATUS_KV, state);
  await saveStatus(env.STATUS_KV, document);

  return {
    services: document.services.length,
    days: document.services[0]?.daily.length ?? 0,
    checks: document.services.reduce((sum, service) => sum + service.checks.total, 0),
  };
}
