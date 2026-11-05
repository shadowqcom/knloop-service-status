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
    { key: 'app.knloop.com', url: 'https://app.knloop.com' },
    // API 根路径返回 404，但服务本身可达；把 404/401/403 也视为“可达”。
    { key: 'api.knloop.com', url: 'https://api.knloop.com', acceptedStatusCodes: [200, 204, 301, 302, 307, 401, 403, 404] },
    { key: 'mojoo.org', url: 'https://mojoo.org' },
    { key: 'shadowq.com', url: 'https://shadowq.com' },
  ],
  globalping: {
    enabled: true,
    type: 'http',
    method: 'HEAD',
    // 4 服务 × 2 地区 × 每 5 分钟 = 96 probes/小时（匿名额度 250/小时）
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
