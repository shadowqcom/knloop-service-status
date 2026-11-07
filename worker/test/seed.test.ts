import { describe, expect, it } from 'vitest';
import { seedDemoData } from '../src/seed';
import { MemoryStorage } from './helpers';
import type { AppState, Env } from '../src/types';

function envWith(): Env {
  return {
    STATUS_DB: {} as D1Database,
    ASSETS: {} as Fetcher,
    STATUS_RETENTION_DAYS: '60',
  } as Env;
}

describe('seedDemoData', () => {
  it('fills a 60-day window with four services and hourly points', async () => {
    const storage = new MemoryStorage();
    const now = Date.parse('2026-11-06T07:30:00+08:00');

    const result = await seedDemoData(envWith(), now, storage);
    expect(result.services).toBe(4);
    expect(result.days).toBe(60);
    expect(result.checks).toBeGreaterThan(60_000);

    const document = await storage.loadStatus();
    expect(document).not.toBeNull();
    expect(document!.services).toHaveLength(4);
    for (const service of document!.services) {
      expect(service.daily).toHaveLength(60);
      expect(service.daily.filter((day) => day[1] !== 'nodata')).toHaveLength(60);
      expect(service.hourly.length).toBeGreaterThan(1_000);
      expect(service.checks.total).toBeGreaterThan(15_000);
      expect(service.status).toBe('success');
    }

    const state = (await storage.loadState()) as AppState;
    expect(Object.keys(state.services)).toHaveLength(4);
    expect(storage.saveAllCalls).toBe(1);
  });
});
