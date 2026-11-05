import type { ProviderProbe } from '../types';
import { errorText, round1, targetHost, truncate } from '../util';

type FetchLike = typeof fetch;

const ENDPOINT = 'https://uapis.cn/api/v1/network/ping';

export async function probeUapis(targetUrl: string, fetchImpl: FetchLike = fetch): Promise<ProviderProbe> {
  const name = 'uapis';
  try {
    const url = `${ENDPOINT}?host=${encodeURIComponent(targetHost(targetUrl).replace(/^www\./, ''))}`;
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': 'knloop-status-worker/1.0' },
      signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();
    if (!response.ok) {
      return { name, ok: false, latencyMs: null, apiError: true, error: `http ${response.status}: ${truncate(text)}` };
    }
    const payload = JSON.parse(text) as { host?: string; ip?: string; location?: string; avg?: number };
    if (!payload.host) {
      return { name, ok: false, latencyMs: null, error: truncate(text) };
    }
    return {
      name,
      ok: true,
      latencyMs: typeof payload.avg === 'number' ? round1(payload.avg) : null,
      detail: [payload.location, payload.ip].filter(Boolean).join(' / ') || undefined,
    };
  } catch (error) {
    return { name, ok: false, latencyMs: null, apiError: true, error: truncate(errorText(error)) };
  }
}
