import { describe, expect, it } from 'vitest';
import { seedDemoData } from '../src/seed';
import { loadStatus, loadState, STATE_KEY, STATUS_KEY } from '../src/storage';
import type { AppState, Env } from '../src/types';

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

describe('seedDemoData', () => {
  it('fills a 60-day window with four services and hourly points', async () => {
    const kv = new MemoryKV();
    const env = {
      STATUS_KV: kv as unknown as KVNamespace,
      ASSETS: {} as Fetcher,
      STATUS_RETENTION_DAYS: '60',
    } satisfies Env;
    const now = Date.parse('2026-11-06T07:30:00+08:00');

    const result = await seedDemoData(env, now);
    expect(result.services).toBe(4);
    expect(result.days).toBe(60);
    expect(result.checks).toBeGreaterThan(60_000);

    const document = await loadStatus(env.STATUS_KV);
    expect(document).not.toBeNull();
    expect(document!.services).toHaveLength(4);
    for (const service of document!.services) {
      expect(service.daily).toHaveLength(60);
      expect(service.daily.filter((day) => day[1] !== 'nodata')).toHaveLength(60);
      expect(service.hourly.length).toBeGreaterThan(1_000);
      expect(service.checks.total).toBeGreaterThan(15_000);
      expect(service.status).toBe('success');
    }

    const state = (await loadState(env.STATUS_KV, 60, now)) as AppState;
    expect(Object.keys(state.services)).toHaveLength(4);
    expect(kv.raw(STATE_KEY)).toBeTruthy();
    expect(kv.raw(STATUS_KEY)).toBeTruthy();
  });
});
