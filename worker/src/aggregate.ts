import type {
  AppState,
  ChecksOutput,
  CheckStatus,
  CurrentDayStat,
  DailyRow,
  DisplayStatus,
  HourlyRow,
  ProbeOutcome,
  ServiceConfig,
  ServiceOutput,
  ServiceState,
  StatusDocument,
} from './types';
import {
  cstDate,
  cstHourStart,
  cstIso,
  median,
  percentile,
  round1,
  startOfCstDay,
} from './util';

export function createEmptyState(retentionDays: number, nowMs: number): AppState {
  return {
    schema: 1,
    updatedAt: cstIso(nowMs),
    retentionDays,
    services: {},
    usage: { date: cstDate(nowMs), uapis: 0, xxapi: 0 },
  };
}

export function ensureServiceState(state: AppState, service: ServiceConfig, nowMs: number): ServiceState {
  let serviceState = state.services[service.key];
  if (!serviceState) {
    serviceState = {
      key: service.key,
      url: service.url,
      daily: [],
      hourly: [],
      currentDay: emptyDay(cstDate(nowMs)),
      currentHourStart: cstHourStart(nowMs),
      currentHourLatencies: [],
      lastStatus: 'failure',
      lastLatency: null,
      lastCheckAt: cstIso(nowMs),
      lastFailureAt: null,
      providers: [],
    };
    state.services[service.key] = serviceState;
  }
  serviceState.url = service.url;
  return serviceState;
}

export function resetUsageIfNeeded(state: AppState, nowMs: number): void {
  const date = cstDate(nowMs);
  if (state.usage.date !== date) {
    state.usage = { date, uapis: 0, xxapi: 0 };
  }
}

export function applyOutcome(state: AppState, service: ServiceConfig, outcome: ProbeOutcome, nowMs: number): void {
  const serviceState = ensureServiceState(state, service, nowMs);
  const date = cstDate(nowMs);
  const hourStart = cstHourStart(nowMs);

  if (serviceState.currentDay.date !== date) {
    finalizeDay(serviceState);
    serviceState.currentDay = emptyDay(date);
  }
  if (serviceState.currentHourStart !== hourStart) {
    finalizeHour(serviceState);
    serviceState.currentHourStart = hourStart;
    serviceState.currentHourLatencies = [];
  }

  const day = serviceState.currentDay;
  if (outcome.status === 'success') day.success += 1;
  else if (outcome.status === 'partial') day.partial += 1;
  else day.failure += 1;

  if (outcome.latency !== null && Number.isFinite(outcome.latency) && outcome.status !== 'failure') {
    day.latencies.push(outcome.latency);
    serviceState.currentHourLatencies.push(outcome.latency);
  }

  serviceState.lastStatus = outcome.status;
  serviceState.lastLatency = outcome.latency;
  serviceState.lastCheckAt = cstIso(nowMs);
  serviceState.providers = outcome.providers;
  if (outcome.status === 'failure') serviceState.lastFailureAt = cstIso(nowMs);

  trim(serviceState, state.retentionDays, nowMs);
}

export function buildStatusDocument(state: AppState, nowMs: number): StatusDocument {
  const retentionDays = state.retentionDays;
  const windowStartMs = startOfCstDay(nowMs) - (retentionDays - 1) * 86_400_000;
  const windowStartSec = Math.floor(windowStartMs / 1000);
  const today = cstDate(nowMs);

  const services = Object.values(state.services).map((serviceState) =>
    buildService(serviceState, retentionDays, nowMs, today, windowStartMs, windowStartSec),
  );

  return {
    schema: 2,
    generatedAt: cstIso(nowMs),
    generatedAtUnix: Math.floor(nowMs / 1000),
    retentionDays,
    services,
  };
}

function buildService(
  state: ServiceState,
  retentionDays: number,
  nowMs: number,
  today: string,
  windowStartMs: number,
  windowStartSec: number,
): ServiceOutput {
  const finalizedByDate = new Map(state.daily.map((day) => [day.date, day]));
  const daily: DailyRow[] = [];
  let success = 0;
  let partial = 0;
  let failure = 0;

  for (let offset = 0; offset < retentionDays; offset += 1) {
    const date = cstDate(windowStartMs + offset * 86_400_000);
    const current = date === today ? state.currentDay : undefined;
    const finalized = finalizedByDate.get(date);
    if (current) {
      daily.push(dayRow(current.date, current.success, current.partial, current.failure, current.latencies));
      success += current.success;
      partial += current.partial;
      failure += current.failure;
    } else if (finalized) {
      daily.push([
        finalized.date,
        dayStatus(finalized.success, finalized.partial, finalized.failure),
        uptimePct(finalized.success, finalized.success + finalized.partial + finalized.failure),
        finalized.median === null ? null : round1(finalized.median),
        finalized.p95 === null ? null : round1(finalized.p95),
        finalized.success + finalized.partial + finalized.failure,
        finalized.failure,
      ]);
      success += finalized.success;
      partial += finalized.partial;
      failure += finalized.failure;
    } else {
      daily.push([date, 'nodata', 0, null, null, 0, 0]);
    }
  }

  const hourly: HourlyRow[] = state.hourly
    .filter((hour) => hour.hourStart >= windowStartSec)
    .map((hour) => [hour.hourStart, round1(hour.median), round1(hour.p95)] as HourlyRow);
  if (state.currentHourLatencies.length > 0 && state.currentHourStart >= windowStartSec) {
    const currentMedian = median(state.currentHourLatencies);
    const currentP95 = percentile(state.currentHourLatencies, 95);
    hourly.push([
      state.currentHourStart,
      currentMedian === null ? null : round1(currentMedian),
      currentP95 === null ? null : round1(currentP95),
    ]);
  }
  hourly.sort((a, b) => a[0] - b[0]);

  const checks: ChecksOutput = {
    success,
    partial,
    failure,
    total: success + partial + failure,
    todayTotal: state.currentDay.success + state.currentDay.partial + state.currentDay.failure,
    todayFailures: state.currentDay.failure,
    lastFailureAt: state.lastFailureAt,
  };

  const total = checks.total;
  return {
    key: state.key,
    url: state.url,
    status: state.lastStatus,
    latency: state.lastLatency,
    lastCheckAt: state.lastCheckAt,
    uptime: uptimePct(success, total),
    successRate: total > 0 ? Math.round((success / total) * 10000) / 100 : 0,
    errorRate: total > 0 ? Math.round(((partial + failure) / total) * 10000) / 100 : 0,
    checks,
    daily,
    hourly,
    providers: state.providers,
  };
}

function emptyDay(date: string): CurrentDayStat {
  return { date, success: 0, partial: 0, failure: 0, median: null, p95: null, latencies: [] };
}

function finalizeDay(state: ServiceState): void {
  const day = state.currentDay;
  const checks = day.success + day.partial + day.failure;
  if (checks > 0) {
    state.daily.push({
      date: day.date,
      success: day.success,
      partial: day.partial,
      failure: day.failure,
      median: median(day.latencies),
      p95: percentile(day.latencies, 95),
    });
  }
}

function finalizeHour(state: ServiceState): void {
  if (state.currentHourLatencies.length === 0) return;
  state.hourly.push({
    hourStart: state.currentHourStart,
    median: median(state.currentHourLatencies) ?? 0,
    p95: percentile(state.currentHourLatencies, 95) ?? 0,
  });
}

function trim(state: ServiceState, retentionDays: number, nowMs: number): void {
  const keepDays = Math.max(1, retentionDays);
  if (state.daily.length > keepDays) state.daily = state.daily.slice(-keepDays);
  const windowStartSec = Math.floor((startOfCstDay(nowMs) - (keepDays - 1) * 86_400_000) / 1000);
  state.hourly = state.hourly.filter((hour) => hour.hourStart >= windowStartSec);
  if (state.currentDay.latencies.length > 400) {
    state.currentDay.latencies = state.currentDay.latencies.slice(-400);
  }
  if (state.currentHourLatencies.length > 60) {
    state.currentHourLatencies = state.currentHourLatencies.slice(-60);
  }
}

function dayRow(date: string, success: number, partial: number, failure: number, latencies: number[]): DailyRow {
  const checks = success + partial + failure;
  const p50 = median(latencies);
  const p95 = percentile(latencies, 95);
  return [
    date,
    dayStatus(success, partial, failure),
    uptimePct(success, checks),
    p50 === null ? null : round1(p50),
    p95 === null ? null : round1(p95),
    checks,
    failure,
  ];
}

function dayStatus(success: number, partial: number, failure: number): DisplayStatus {
  const total = success + partial + failure;
  if (total === 0) return 'nodata';
  if (success === total) return 'success';
  if (success > 0) return 'partial';
  if (failure > 0) return 'failure';
  return 'partial';
}

function uptimePct(success: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((success / total) * 10000) / 100;
}
