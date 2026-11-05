import { describe, expect, it } from 'vitest';
import { runCollection } from '../src/collect';
import { STATUS_KEY } from '../src/storage';
import type { Env } from '../src/types';

class MemoryKV {
  private readonly store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  raw(key: string): string | undefined {
    return this.store.get(key);
  }
}

function fakeFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('api.globalping.io')) {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'm1', probesCount: 2 }), { status: 202, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        id: 'm1',
        status: 'finished',
        results: [
          { probe: { country: 'CN' }, result: { status: 'finished', statusCode: 200, timings: { total: 100 } } },
          { probe: { country: 'US' }, result: { status: 'finished', statusCode: 200, timings: { total: 120 } } },
        ],
      }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('v2.xxapi.cn')) {
      return new Response(JSON.stringify({ code: 200, data: { server: 'CN', time: '90ms' } }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;
}

describe('runCollection', () => {
  it('writes state and status into KV and can be read by the API layer', async () => {
    const kv = new MemoryKV();
    const env = {
      STATUS_KV: kv as unknown as KVNamespace,
      ASSETS: {} as Fetcher,
      STATUS_RETENTION_DAYS: '60',
    } satisfies Env;
    const now = Date.parse('2026-11-05T20:50:00+08:00');
    const document = await runCollection(env, { fetchImpl: fakeFetch(), nowMs: now });

    expect(document.services).toHaveLength(3);
    expect(document.services[0].status).toBe('success');
    expect(document.services[0].daily.at(-1)?.[0]).toBe('2026-11-05');
    expect(kv.raw(STATUS_KEY)).toContain('"schema":2');
    expect(document.generatedAtUnix).toBe(Math.floor(now / 1000));
  });
});
