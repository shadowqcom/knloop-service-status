import type { ServiceConfig } from './types';

export interface GlobalpingLocation {
  country?: string;
  city?: string;
  asn?: number;
  limit?: number;
}

export interface ProviderConfig {
  enabled: boolean;
}

export interface GlobalpingConfig extends ProviderConfig {
  type: 'http' | 'ping';
  method: 'HEAD' | 'GET';
  locations: GlobalpingLocation[];
  timeoutMs: number;
  pollIntervalMs: number;
}

export interface UapisConfig extends ProviderConfig {
  /** 1500 credits/month anonymous => keep a conservative daily cap. */
  dailyCap: number;
}

export interface Config {
  retentionDays: number;
  services: ServiceConfig[];
  globalping: GlobalpingConfig;
  xxapi: ProviderConfig;
  uapis: UapisConfig;
  direct: ProviderConfig & { timeoutMs: number };
}

// 服务列表与 provider 配置。改这里即可，不需要动 Worker 逻辑。
export const config: Config = {
  retentionDays: 60,
  services: [
    { key: 'ShadowQ', url: 'https://www.shadowq.com' },
    { key: 'Mojoo', url: 'https://mojoo.org' },
    { key: 'Google', url: 'https://www.google.com' },
  ],
  globalping: {
    enabled: true,
    type: 'http',
    method: 'HEAD',
    // 3 服务 × 2 地区 × 每 10 分钟 = 36 probes/小时（匿名额度 250/小时）
    locations: [
      { country: 'CN', limit: 1 },
      { country: 'US', limit: 1 },
    ],
    timeoutMs: 20_000,
    pollIntervalMs: 1_000,
  },
  xxapi: { enabled: true },
  uapis: { enabled: true, dailyCap: 30 },
  direct: { enabled: true, timeoutMs: 5_000 },
};
