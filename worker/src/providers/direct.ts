import type { ProviderProbe } from '../types';
import { errorText, round1, truncate } from '../util';

type FetchLike = typeof fetch;

export async function probeDirect(
  targetUrl: string,
  timeoutMs: number,
  fetchImpl: FetchLike = fetch,
  acceptedStatusCodes?: number[],
): Promise<ProviderProbe> {
  const name = 'direct';
  try {
    const start = performance.now();
    const response = await fetchImpl(targetUrl, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; knloop-status/2.0; +https://status.knloop.com)' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latency = round1(performance.now() - start);
    try { await response.body?.cancel(); } catch {}
    const ok = acceptedStatusCodes && acceptedStatusCodes.length > 0
      ? acceptedStatusCodes.includes(response.status)
      : response.status >= 200 && response.status < 400;
    return {
      name,
      ok,
      latencyMs: ok ? latency : null,
      detail: `HTTP ${response.status}`,
      error: ok ? undefined : `status ${response.status}`,
    };
  } catch (error) {
    return { name, ok: false, latencyMs: null, error: truncate(errorText(error)) };
  }
}
