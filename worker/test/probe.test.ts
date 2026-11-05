import { describe, expect, it } from 'vitest';
import type { Config } from '../src/config';
import { config as defaultConfig } from '../src/config';
import { probeService } from '../src/probe';
import type { UsageState } from '../src/types';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const service = { key: 'Example', url: 'https://example.com' };

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...defaultConfig,
    uapis: { enabled: true, dailyCap: 2 },
    ...overrides,
  };
}

function fakeFetch(options: {
  globalping?: 'success' | 'partial' | 'failure' | 'api-error';
  xxapi?: 'ok' | 'fail';
  uapis?: 'ok' | 'fail';
  direct?: number;
}) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('api.globalping.io')) {
      if (options.globalping === 'api-error') return json({ error: 'rate limited' }, 429);
      if (init?.method === 'POST') return json({ id: 'm1', probesCount: 2 }, 202);
      const regions = options.globalping === 'failure'
        ? [{ probe: { country: 'CN' }, result: { status: 'failed', rawOutput: 'timeout' } }, { probe: { country: 'US' }, result: { status: 'failed', rawOutput: 'timeout' } }]
        : options.globalping === 'partial'
          ? [{ probe: { country: 'CN' }, result: { status: 'finished', statusCode: 200, timings: { total: 100 } } }, { probe: { country: 'US' }, result: { status: 'failed', rawOutput: 'timeout' } }]
          : [{ probe: { country: 'CN' }, result: { status: 'finished', statusCode: 200, timings: { total: 100 } } }, { probe: { country: 'US' }, result: { status: 'finished', statusCode: 200, timings: { total: 300 } } }];
      return json({ id: 'm1', status: 'finished', results: regions });
    }
    if (url.includes('v2.xxapi.cn')) {
      return options.xxapi === 'ok' ? json({ code: 200, data: { server: 'CN', time: '88ms' } }) : json({ code: -2, msg: '请求失败' });
    }
    if (url.includes('uapis.cn')) {
      return options.uapis === 'ok' ? json({ host: 'example.com', avg: 42.2 }) : json({ message: 'Ping失败' });
    }
    return new Response(null, { status: options.direct ?? 200 });
  }) as typeof fetch;
}

function usage(): UsageState { return { date: '2026-11-05', uapis: 0, xxapi: 0 }; }

describe('probeService merge', () => {
  it('uses Globalping as primary when all regions succeed', async () => {
    const outcome = await probeService(service, testConfig(), usage(), {
      fetchImpl: fakeFetch({ globalping: 'success', xxapi: 'ok', direct: 200 }),
    });
    expect(outcome.status).toBe('success');
    expect(outcome.latency).toBe(200);
    expect(outcome.providers.map((provider) => provider.name)).toContain('globalping');
    expect(outcome.providers.map((provider) => provider.name)).toContain('xxapi');
  });

  it('promotes Globalping failure to partial when ping APIs reach the host', async () => {
    const outcome = await probeService(service, testConfig(), usage(), {
      fetchImpl: fakeFetch({ globalping: 'failure', xxapi: 'ok', direct: 503 }),
    });
    expect(outcome.status).toBe('partial');
  });

  it('falls back to direct when Globalping API is unavailable', async () => {
    const outcome = await probeService(service, testConfig(), usage(), {
      fetchImpl: fakeFetch({ globalping: 'api-error', xxapi: 'fail', direct: 200 }),
    });
    expect(outcome.status).toBe('success');
    expect(outcome.latency).not.toBeNull();
  });

  it('reports failure when Globalping and direct and ping APIs all fail definitively', async () => {
    const outcome = await probeService(service, testConfig(), usage(), {
      fetchImpl: fakeFetch({ globalping: 'failure', xxapi: 'fail', direct: 503 }),
    });
    expect(outcome.status).toBe('failure');
    expect(outcome.latency).toBeNull();
  });

  it('only calls uapis when Globalping is abnormal and budget allows', async () => {
    const state = usage();
    const cfg = testConfig();
    const first = await probeService(service, cfg, state, {
      fetchImpl: fakeFetch({ globalping: 'failure', xxapi: 'ok', direct: 503, uapis: 'ok' }),
    });
    expect(state.uapis).toBe(1);
    expect(first.providers.map((provider) => provider.name)).toContain('uapis');
    await probeService(service, cfg, state, { fetchImpl: fakeFetch({ globalping: 'success', xxapi: 'ok', direct: 200, uapis: 'ok' }) });
    expect(state.uapis).toBe(1);
  });
});
