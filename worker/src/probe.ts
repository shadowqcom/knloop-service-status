import type { Config } from './config';
import type { CheckStatus, ProbeOutcome, ProviderProbe, ProviderSnapshot, ServiceConfig, UsageState } from './types';
import { probeDirect } from './providers/direct';
import { probeGlobalping } from './providers/globalping';
import { probeUapis } from './providers/uapis';
import { probeXxapi } from './providers/xxapi';

type FetchLike = typeof fetch;

export interface ProbeDeps {
  token?: string;
  fetchImpl?: FetchLike;
}

/**
 * 三个来源并行：Globalping（主）、xxapi（并行佐证）、direct（免费降级）。
 * uapis 有 1500 次/月额度，只在 Globalping 异常/失败且当日预算未用完时调用。
 */
export async function probeService(
  service: ServiceConfig,
  cfg: Config,
  usage: UsageState,
  deps: ProbeDeps = {},
): Promise<ProbeOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const globalpingPromise = cfg.globalping.enabled
    ? probeGlobalping(service.url, cfg.globalping, deps.token, fetchImpl, service.acceptedStatusCodes)
    : Promise.resolve<ProviderProbe>({ name: 'globalping', ok: false, latencyMs: null, apiError: true, error: 'disabled' });
  const xxapiPromise = cfg.xxapi.enabled
    ? probeXxapi(service.url, fetchImpl)
    : Promise.resolve<ProviderProbe>({ name: 'xxapi', ok: false, latencyMs: null, apiError: true, error: 'disabled' });
  const directPromise = cfg.direct.enabled
    ? probeDirect(service.url, cfg.direct.timeoutMs, fetchImpl, service.acceptedStatusCodes)
    : Promise.resolve<ProviderProbe>({ name: 'direct', ok: false, latencyMs: null, apiError: true, error: 'disabled' });

  const [globalping, xxapi, direct] = await Promise.all([globalpingPromise, xxapiPromise, directPromise]);

  const globalpingStatus = globalpingStatusOf(globalping);
  const globalpingUsable = !globalping.apiError && globalpingStatus !== null;
  const needsPingCheck = !globalpingUsable || globalpingStatus === 'failure';

  let uapis: ProviderProbe | undefined;
  if (cfg.uapis.enabled && needsPingCheck && usage.uapis < cfg.uapis.dailyCap) {
    uapis = await probeUapis(service.url, fetchImpl);
    usage.uapis += 1;
  }

  const pingReachable = Boolean(xxapi.ok || uapis?.ok);
  let status: CheckStatus;
  if (globalpingUsable) {
    status = globalpingStatus as CheckStatus;
    if (status === 'failure' && pingReachable) status = 'partial';
  } else if (direct.ok) {
    status = 'success';
  } else if (pingReachable) {
    status = 'partial';
  } else {
    // 所有渠道都失败：区分“服务确实不可达”和“API 自身异常”。
    const definitive = !direct.apiError && !xxapi.apiError;
    status = definitive ? 'failure' : 'partial';
  }

  const latency = status === 'failure'
    ? null
    : firstLatency(globalping, direct, xxapi, uapis);

  return {
    status,
    latency,
    providers: [globalping, xxapi, direct, uapis]
      .filter((probe): probe is ProviderProbe => Boolean(probe))
      .map(toSnapshot),
  };
}

function globalpingStatusOf(probe: ProviderProbe): CheckStatus | null {
  if (probe.apiError) return null;
  const regions = probe.regions ?? [];
  if (regions.length === 0) return null;
  const okCount = regions.filter((region) => region.ok).length;
  if (okCount === regions.length) return 'success';
  if (okCount > 0) return 'partial';
  return 'failure';
}

function firstLatency(...probes: Array<ProviderProbe | undefined>): number | null {
  for (const probe of probes) {
    if (probe && probe.latencyMs !== null && Number.isFinite(probe.latencyMs)) return probe.latencyMs;
  }
  return null;
}

function toSnapshot(probe: ProviderProbe): ProviderSnapshot {
  return {
    name: probe.name,
    ok: probe.ok,
    latencyMs: probe.latencyMs,
    detail: probe.detail,
    error: probe.error,
  };
}
