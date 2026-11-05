export type CheckStatus = 'success' | 'partial' | 'failure';
export type DisplayStatus = CheckStatus | 'nodata';

export interface ServiceConfig {
  key: string;
  url: string;
}

export interface RegionResult {
  country: string;
  city?: string;
  ok: boolean;
  latencyMs: number | null;
  statusCode?: number;
  error?: string;
}

export interface ProviderProbe {
  name: string;
  ok: boolean;
  latencyMs: number | null;
  detail?: string;
  error?: string;
  /** true when the provider API itself failed (network/429/parse), not the target. */
  apiError?: boolean;
  regions?: RegionResult[];
}

export interface ProviderSnapshot {
  name: string;
  ok: boolean;
  latencyMs: number | null;
  detail?: string;
  error?: string;
}

export interface ProbeOutcome {
  status: CheckStatus;
  latency: number | null;
  providers: ProviderSnapshot[];
}

export interface DayStat {
  date: string;
  success: number;
  partial: number;
  failure: number;
  median: number | null;
  p95: number | null;
}

export interface HourStat {
  hourStart: number;
  median: number;
  p95: number;
}

export interface CurrentDayStat extends DayStat { 
  latencies: number[];
}

export interface ServiceState {
  key: string;
  url: string;
  /** Finalized past days only (max retentionDays). */
  daily: DayStat[];
  /** Finalized past hours only (max retentionDays * 24). */
  hourly: HourStat[];
  currentDay: CurrentDayStat;
  currentHourStart: number;
  currentHourLatencies: number[];
  lastStatus: CheckStatus;
  lastLatency: number | null;
  lastCheckAt: string;
  lastFailureAt: string | null;
  providers: ProviderSnapshot[];
}

export interface UsageState {
  date: string;
  uapis: number;
  xxapi: number;
}

export interface AppState {
  schema: 1;
  updatedAt: string;
  retentionDays: number;
  services: Record<string, ServiceState>;
  usage: UsageState;
}

export interface DailyRowOutput {
  // compact array [date, status, uptimePct, p50, p95, checks, failures]
}

export type DailyRow = [string, DisplayStatus, number, number | null, number | null, number, number];
export type HourlyRow = [number, number | null, number | null];

export interface ChecksOutput {
  success: number;
  partial: number;
  failure: number;
  total: number;
  todayTotal: number;
  todayFailures: number;
  lastFailureAt: string | null;
}

export interface ServiceOutput {
  key: string;
  url: string;
  status: CheckStatus;
  latency: number | null;
  lastCheckAt: string;
  uptime: number;
  checks: ChecksOutput;
  daily: DailyRow[];
  hourly: HourlyRow[];
  providers: ProviderSnapshot[];
}

export interface StatusDocument {
  schema: 2;
  generatedAt: string;
  generatedAtUnix: number;
  retentionDays: number;
  services: ServiceOutput[];
}

export interface Env {
  STATUS_KV: KVNamespace;
  ASSETS: Fetcher;
  GLOBALPING_TOKEN?: string;
  WEBHOOK_KEY?: string;
  STATUS_RETENTION_DAYS?: string;
  /** 可选：启用 POST /api/admin/run 手动触发一次采集（空/未设置时该路由返回 404）。 */
  ADMIN_TOKEN?: string;
}
