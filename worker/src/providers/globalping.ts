import type { GlobalpingConfig } from '../config';
import type { ProviderProbe, RegionResult } from '../types';
import { errorText, median, round1, targetHost, targetPath, truncate } from '../util';

type FetchLike = typeof fetch;

interface GlobalpingProbeResponse {
  probe?: { country?: string; city?: string; network?: string };
  result?: {
    status?: string;
    statusCode?: number;
    timings?: { total?: number; firstByte?: number };
    stats?: { avg?: number; rcv?: number; loss?: number };
    rawOutput?: string;
  };
}

interface MeasurementResponse {
  status?: string;
  results?: GlobalpingProbeResponse[];
}

const BASE_URL = 'https://api.globalping.io/v1';

export async function probeGlobalping(
  targetUrl: string,
  cfg: GlobalpingConfig,
  token?: string,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderProbe> {
  const name = 'globalping';
  try {
    const host = targetHost(targetUrl);
    const path = targetPath(targetUrl);
    let protocol = 'HTTPS';
    try { if (new URL(targetUrl).protocol === 'http:') protocol = 'HTTP'; } catch {}
    const body: Record<string, unknown> = {
      type: cfg.type,
      target: host,
      locations: cfg.locations.map((location) => ({ ...location, limit: location.limit ?? 1 })),
      measurementOptions:
        cfg.type === 'http'
          ? { protocol, request: { method: cfg.method, path } }
          : { packets: 3 },
    };
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'knloop-status-worker/1.0 (+https://status.knloop.com)',
    };
    if (token) headers.authorization = `Bearer ${token}`;

    const createRes = await fetchImpl(`${BASE_URL}/measurements`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const createdText = await createRes.text();
    if (!createRes.ok) {
      return { name, ok: false, latencyMs: null, apiError: true, error: `create ${createRes.status}: ${truncate(createdText)}` };
    }
    const created = JSON.parse(createdText) as { id?: string; probesCount?: number };
    if (!created.id) return { name, ok: false, latencyMs: null, apiError: true, error: 'no measurement id' };

    const deadline = Date.now() + cfg.timeoutMs;
    while (Date.now() < deadline) {
      const pollRes = await fetchImpl(`${BASE_URL}/measurements/${created.id}`, {
        headers: { accept: 'application/json', 'user-agent': 'knloop-status-worker/1.0' },
        signal: AbortSignal.timeout(10_000),
      });
      const pollText = await pollRes.text();
      if (!pollRes.ok) {
        return { name, ok: false, latencyMs: null, apiError: true, error: `poll ${pollRes.status}: ${truncate(pollText)}` };
      }
      const measurement = JSON.parse(pollText) as MeasurementResponse;
      if (measurement.status === 'finished') {
        const probes = measurement.results ?? [];
        if (probes.length === 0) return { name, ok: false, latencyMs: null, apiError: true, error: 'empty measurement results' };
        return summarize(probes, cfg, created.probesCount ?? probes.length);
      }
      if (measurement.status && measurement.status !== 'in-progress') {
        return { name, ok: false, latencyMs: null, apiError: true, error: `measurement status ${measurement.status}` };
      }
      await new Promise((resolve) => setTimeout(resolve, cfg.pollIntervalMs));
    }
    return { name, ok: false, latencyMs: null, apiError: true, error: 'measurement polling timeout' };
  } catch (error) {
    return { name, ok: false, latencyMs: null, apiError: true, error: truncate(errorText(error)) };
  }
}

function summarize(probes: GlobalpingProbeResponse[], cfg: GlobalpingConfig, total: number): ProviderProbe {
  const regions: RegionResult[] = [];
  const latencies: number[] = [];
  for (const probe of probes) {
    const country = probe.probe?.country ?? '?';
    const city = probe.probe?.city ?? undefined;
    const result = probe.result;
    if (!result || result.status !== 'finished') {
      regions.push({ country, city, ok: false, latencyMs: null, error: truncate(result?.rawOutput ?? 'probe failed') });
      continue;
    }
    if (cfg.type === 'ping') {
      const rcv = result.stats?.rcv ?? 0;
      if (rcv <= 0) {
        regions.push({ country, city, ok: false, latencyMs: null, error: 'no ping replies' });
        continue;
      }
      const latency = round1(result.stats?.avg ?? 0);
      latencies.push(latency);
      regions.push({ country, city, ok: true, latencyMs: latency });
      continue;
    }
    const statusCode = result.statusCode ?? 0;
    if (statusCode < 200 || statusCode >= 400) {
      regions.push({ country, city, ok: false, latencyMs: null, statusCode, error: `status ${statusCode}` });
      continue;
    }
    const timing = result.timings?.total || result.timings?.firstByte || 0;
    if (!(timing > 0)) {
      regions.push({ country, city, ok: false, latencyMs: null, statusCode, error: 'missing timing' });
      continue;
    }
    const latency = round1(timing);
    latencies.push(latency);
    regions.push({ country, city, ok: true, latencyMs: latency, statusCode });
  }
  const okCount = regions.filter((region) => region.ok).length;
  const boundedTotal = Math.max(total, regions.length);
  return {
    name: 'globalping',
    ok: okCount > 0,
    latencyMs: median(latencies),
    detail: `${okCount}/${boundedTotal} probes ok`,
    regions,
  };
}
