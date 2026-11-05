import { describe, expect, it } from 'vitest';
import { probeDirect } from '../src/providers/direct';
import { probeGlobalping } from '../src/providers/globalping';
import { probeUapis } from '../src/providers/uapis';
import { probeXxapi } from '../src/providers/xxapi';
import type { GlobalpingConfig } from '../src/config';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const globalpingConfig: GlobalpingConfig = {
  enabled: true,
  type: 'http',
  method: 'HEAD',
  locations: [{ country: 'CN', limit: 1 }, { country: 'US', limit: 1 }],
  timeoutMs: 2_000,
  pollIntervalMs: 5,
};

describe('globalping provider', () => {
  it('parses a finished measurement', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === 'POST') return jsonResponse({ id: 'm1', probesCount: 2 }, 202);
      return jsonResponse({
        id: 'm1',
        status: 'finished',
        results: [
          { probe: { country: 'CN', city: 'Beijing' }, result: { status: 'finished', statusCode: 200, timings: { total: 120 } } },
          { probe: { country: 'US', city: 'New York' }, result: { status: 'finished', statusCode: 200, timings: { total: 220 } } },
        ],
      });
    }) as typeof fetch;

    const probe = await probeGlobalping('https://www.shadowq.com/path', globalpingConfig, undefined, fetchImpl);
    expect(probe.apiError).toBeFalsy();
    expect(probe.ok).toBe(true);
    expect(probe.latencyMs).toBe(170);
    expect(probe.regions).toHaveLength(2);
    expect(probe.detail).toBe('2/2 probes ok');
    expect(calls[0]).toContain('POST');
  });

  it('reports API failure separately from target failure', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'rate limited' }, 429)) as typeof fetch;
    const probe = await probeGlobalping('https://www.shadowq.com', globalpingConfig, undefined, fetchImpl);
    expect(probe.apiError).toBe(true);
    expect(probe.ok).toBe(false);
  });

  it('marks unreachable probes as failures', async () => {
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ id: 'm1', probesCount: 2 }, 202);
      return jsonResponse({
        id: 'm1',
        status: 'finished',
        results: [
          { probe: { country: 'CN' }, result: { status: 'finished', statusCode: 200, timings: { total: 100 } } },
          { probe: { country: 'US' }, result: { status: 'failed', rawOutput: 'timeout' } },
        ],
      });
    }) as typeof fetch;

    const probe = await probeGlobalping('https://www.shadowq.com', globalpingConfig, undefined, fetchImpl);
    expect(probe.apiError).toBeFalsy();
    expect(probe.ok).toBe(true);
    expect(probe.regions?.filter((region) => region.ok)).toHaveLength(1);
  });
});

describe('xxapi provider', () => {
  it('parses code 200 and time string', async () => {
    const fetchImpl = (async () => jsonResponse({ code: 200, msg: 'ok', data: { server: '中国山东', time: '19.371ms', ip: '1.2.3.4' } })) as typeof fetch;
    const probe = await probeXxapi('https://www.shadowq.com', fetchImpl);
    expect(probe.ok).toBe(true);
    expect(probe.latencyMs).toBe(19.4);
    expect(probe.detail).toContain('中国山东');
  });

  it('does not mark target ok on non-200 code', async () => {
    const fetchImpl = (async () => jsonResponse({ code: -2, msg: '请求失败' })) as typeof fetch;
    const probe = await probeXxapi('https://www.shadowq.com', fetchImpl);
    expect(probe.ok).toBe(false);
    expect(probe.error).toContain('请求失败');
  });
});

describe('uapis provider', () => {
  it('parses avg latency', async () => {
    const fetchImpl = (async () => jsonResponse({ host: 'baidu.com', avg: 60.697, location: '中国 河北' })) as typeof fetch;
    const probe = await probeUapis('https://baidu.com', fetchImpl);
    expect(probe.ok).toBe(true);
    expect(probe.latencyMs).toBe(60.7);
  });

  it('marks missing host as failure', async () => {
    const fetchImpl = (async () => jsonResponse({ code: 'INVALID_PARAMETER', message: 'Ping失败' })) as typeof fetch;
    const probe = await probeUapis('https://baidu.com', fetchImpl);
    expect(probe.ok).toBe(false);
  });
});

describe('direct provider', () => {
  it('works with 2xx/3xx and records latency', async () => {
    const fetchImpl = (async () => new Response(null, { status: 204 })) as typeof fetch;
    const probe = await probeDirect('https://www.shadowq.com', 1_000, fetchImpl);
    expect(probe.ok).toBe(true);
    expect(probe.latencyMs).not.toBeNull();
  });

  it('fails on 5xx', async () => {
    const fetchImpl = (async () => new Response('err', { status: 503 })) as typeof fetch;
    const probe = await probeDirect('https://www.shadowq.com', 1_000, fetchImpl);
    expect(probe.ok).toBe(false);
  });
});
