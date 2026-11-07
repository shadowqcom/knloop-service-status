import { describe, expect, it } from 'vitest';
import { runCollection } from '../src/collect';
import { createEmptyState, ensureServiceState } from '../src/aggregate';
import { MemoryStorage } from './helpers';
import type { Env } from '../src/types';

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

function envWith(): Env {
  return {
    STATUS_DB: {} as D1Database,
    ASSETS: {} as Fetcher,
    STATUS_RETENTION_DAYS: '60',
  } as Env;
}

describe('runCollection', () => {
  it('removes services that are no longer configured', async () => {
    const now = Date.parse('2026-11-05T20:50:00+08:00');
    const oldState = createEmptyState(60, now);
    ensureServiceState(oldState, { key: 'OldService', url: 'https://old.example.com' }, now);
    const storage = new MemoryStorage({ state: oldState });

    const document = await runCollection(envWith(), { fetchImpl: fakeFetch(), nowMs: now, storage });
    expect(document.services).toHaveLength(4);
    expect(document.services.some((service) => service.key === 'OldService')).toBe(false);
    expect(Object.keys(storage.state!.services)).not.toContain('OldService');
  });

  it('saves state and status through the storage layer and returns the API document', async () => {
    const storage = new MemoryStorage();
    const now = Date.parse('2026-11-05T20:50:00+08:00');
    const document = await runCollection(envWith(), { fetchImpl: fakeFetch(), nowMs: now, storage });

    expect(document.services).toHaveLength(4);
    expect(document.services[0].status).toBe('success');
    expect(document.services[0].daily.at(-1)?.[0]).toBe('2026-11-05');
    expect(document.generatedAtUnix).toBe(Math.floor(now / 1000));
    expect(storage.saveAllCalls).toBe(1);
    expect(storage.document).toBe(document);
    expect(JSON.stringify(storage.state)).toContain('"schema":1');
    expect(JSON.stringify(storage.document)).toContain('"schema":2');
  });

  it('still returns the new document when storage writes fail (for example write quota exhausted)', async () => {
    const storage = new MemoryStorage();
    storage.saveAllError = new Error('D1_ERROR: daily write limit exceeded');
    const now = Date.parse('2026-11-05T20:50:00+08:00');

    const document = await runCollection(envWith(), { fetchImpl: fakeFetch(), nowMs: now, storage });
    expect(document.services).toHaveLength(4);
    expect(document.generatedAtUnix).toBe(Math.floor(now / 1000));
  });
});
