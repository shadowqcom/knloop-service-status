import type { ProviderProbe } from '../types';
import { errorText, round1, targetHost, truncate } from '../util';

type FetchLike = typeof fetch;

const ENDPOINT = 'https://v2.xxapi.cn/api/ping';

export async function probeXxapi(targetUrl: string, fetchImpl: FetchLike = fetch): Promise<ProviderProbe> {
  const name = 'xxapi';
  try {
    const url = `${ENDPOINT}?url=${encodeURIComponent(targetHost(targetUrl))}`;
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': 'knloop-status-worker/1.0' },
      signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();
    if (!response.ok) {
      return { name, ok: false, latencyMs: null, apiError: true, error: `http ${response.status}: ${truncate(text)}` };
    }
    const payload = JSON.parse(text) as { code?: number; msg?: string; data?: { ip?: string; server?: string; time?: string } };
    if (payload.code !== 200) {
      return { name, ok: false, latencyMs: null, error: truncate(payload.msg ?? `code ${payload.code}`) };
    }
    const match = /([\d.]+)\s*ms/i.exec(payload.data?.time ?? '');
    const latency = match ? round1(Number.parseFloat(match[1])) : null;
    return {
      name,
      ok: true,
      latencyMs: latency,
      detail: [payload.data?.server, payload.data?.ip].filter(Boolean).join(' / ') || undefined,
    };
  } catch (error) {
    return { name, ok: false, latencyMs: null, apiError: true, error: truncate(errorText(error)) };
  }
}
