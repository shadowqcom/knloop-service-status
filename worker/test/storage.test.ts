import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyState } from '../src/aggregate';
import { createStorage, resetSchemaForTests, STATE_KEY, STATUS_KEY } from '../src/storage';
import { FakeD1 } from './helpers';
import type { AppState, StatusDocument } from '../src/types';

const NOW = Date.parse('2026-11-07T10:00:00+08:00');

function fixtureDoc(unix = Math.floor(NOW / 1000)): StatusDocument {
  return {
    schema: 2,
    generatedAt: '2026-11-07T10:00:00+08:00',
    generatedAtUnix: unix,
    retentionDays: 60,
    services: [],
  };
}

function fixtureState(): AppState {
  return createEmptyState(60, NOW);
}

beforeEach(() => {
  resetSchemaForTests();
});

describe('createStorage (D1)', () => {
  it('creates the schema lazily once and saves both rows in a single batch', async () => {
    const db = new FakeD1();
    const storage = createStorage({ STATUS_DB: db as unknown as D1Database });

    await storage.saveAll(fixtureState(), fixtureDoc());
    expect(db.execCalls).toBe(1);
    expect(db.batchCalls).toBe(1);
    expect(db.rowsWritten).toBe(2);
    expect(db.jsonRow<AppState>(STATE_KEY)?.schema).toBe(1);
    expect(db.jsonRow<StatusDocument>(STATUS_KEY)?.schema).toBe(2);

    // 后续调用不会重复建表
    await storage.saveState(fixtureState());
    expect(db.execCalls).toBe(1);
  });

  it('round-trips state and document', async () => {
    const db = new FakeD1();
    const storage = createStorage({ STATUS_DB: db as unknown as D1Database });
    const state = fixtureState();
    const document = fixtureDoc();

    await storage.saveAll(state, document);

    const loadedDocument = await storage.loadStatus();
    expect(loadedDocument?.generatedAtUnix).toBe(document.generatedAtUnix);

    const loadedState = await storage.loadState(60, NOW);
    expect(loadedState.schema).toBe(1);
    expect(Object.keys(loadedState.services)).toHaveLength(0);
    expect(loadedState.usage).toEqual({ date: expect.any(String), uapis: 0, xxapi: 0 });
  });

  it('starts from an empty state when D1 has no rows', async () => {
    const db = new FakeD1();
    const storage = createStorage({ STATUS_DB: db as unknown as D1Database });

    const state = await storage.loadState(60, NOW);
    expect(state.schema).toBe(1);
    expect(Object.keys(state.services)).toHaveLength(0);
    expect(await storage.loadStatus()).toBeNull();
  });

  it('treats corrupted D1 rows as empty without crashing', async () => {
    const db = new FakeD1();
    db.seedRaw(STATUS_KEY, '{not-json');
    db.seedRaw(STATE_KEY, '{not-json');
    const storage = createStorage({ STATUS_DB: db as unknown as D1Database });

    expect(await storage.loadStatus()).toBeNull();
    const state = await storage.loadState(60, NOW);
    expect(Object.keys(state.services)).toHaveLength(0);
  });

  it('retries schema creation after a transient failure', async () => {
    const db = new FakeD1();
    const storage = createStorage({ STATUS_DB: db as unknown as D1Database });

    db.failure = new Error('D1_EXEC_ERROR: temporary failure');
    await expect(storage.loadStatus()).rejects.toThrow('temporary failure');

    db.failure = null;
    await expect(storage.loadStatus()).resolves.toBeNull();
    expect(db.execCalls).toBe(2);
  });

  it('uses a single-line DDL statement (local D1 exec rejects multi-line DDL)', async () => {
    const db = new FakeD1();
    const storage = createStorage({ STATUS_DB: db as unknown as D1Database });

    await storage.loadStatus();
    expect(db.lastExecSql).toContain('CREATE TABLE IF NOT EXISTS status_store');
    expect(db.lastExecSql).not.toContain('\n');
  });
});
