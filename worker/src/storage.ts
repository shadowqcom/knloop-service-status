import { createEmptyState } from './aggregate';
import type { AppState, Env, StatusDocument } from './types';

export const STATE_KEY = 'state:v1';
export const STATUS_KEY = 'status:v2';

const TABLE = 'status_store';
/** key -> JSON 文本；一张表足够，读写都是按主键的单行操作。 */
const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);`;

const UPSERT_SQL = `INSERT INTO ${TABLE} (key, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;

/**
 * D1 建表只需执行一次。这里用 WeakMap<D1Database, Promise> 做懒初始化：
 * - 避免首次部署还要手动跑 migration；
 * - 每个 isolate / 每个 D1 binding 只执行一次；失败时删除缓存，下次请求重试；
 * - DDL 用单行 SQL：本地与线上 D1 的 exec() 对多行 DDL 兼容性不同，单行 + 分号最稳。
 */
let schemaReady = new WeakMap<D1Database, Promise<void>>();

function ensureSchema(db: D1Database): Promise<void> {
  const existing = schemaReady.get(db);
  if (existing) return existing;
  const promise = db.exec(SCHEMA_SQL).then(
    () => undefined,
    (error: unknown) => {
      schemaReady.delete(db);
      throw error;
    },
  );
  schemaReady.set(db, promise);
  return promise;
}

export interface StatusStorage {
  loadState(retentionDays: number, nowMs: number): Promise<AppState>;
  loadStatus(): Promise<StatusDocument | null>;
  saveState(state: AppState): Promise<void>;
  saveStatus(document: StatusDocument): Promise<void>;
  /** 一次 batch 写入 state + status（2 行写入、1 次查询）。 */
  saveAll(state: AppState, document: StatusDocument): Promise<void>;
}

/** 生产环境传 Env；测试可以只传这个字段。 */
export type StorageEnv = Pick<Env, 'STATUS_DB'>;

export function createStorage(env: StorageEnv): StatusStorage {
  const db = env.STATUS_DB;

  return {
    async loadState(retentionDays: number, nowMs: number): Promise<AppState> {
      await ensureSchema(db);
      const stored = await readRowJson<AppState>(db, STATE_KEY);
      if (!stored || stored.schema !== 1 || !stored.services) {
        return createEmptyState(retentionDays, nowMs);
      }
      stored.retentionDays = retentionDays;
      stored.usage = stored.usage ?? { date: '', uapis: 0, xxapi: 0 };
      return stored;
    },

    async loadStatus(): Promise<StatusDocument | null> {
      await ensureSchema(db);
      return readRowJson<StatusDocument>(db, STATUS_KEY);
    },

    async saveState(state: AppState): Promise<void> {
      await ensureSchema(db);
      await writeRow(db, STATE_KEY, JSON.stringify(state));
    },

    async saveStatus(document: StatusDocument): Promise<void> {
      await ensureSchema(db);
      await writeRow(db, STATUS_KEY, JSON.stringify(document));
    },

    async saveAll(state: AppState, document: StatusDocument): Promise<void> {
      await ensureSchema(db);
      const statement = db.prepare(UPSERT_SQL);
      const now = Date.now();
      await db.batch([
        statement.bind(STATE_KEY, JSON.stringify(state), now),
        statement.bind(STATUS_KEY, JSON.stringify(document), now),
      ]);
    },
  };
}

/** 仅测试使用：重置懒建表状态。 */
export function resetSchemaForTests(): void {
  schemaReady = new WeakMap<D1Database, Promise<void>>();
}

async function readRowJson<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db.prepare(`SELECT value FROM ${TABLE} WHERE key = ?`).bind(key).first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch (error) {
    console.warn('[storage] corrupted JSON in D1, treating the row as empty', key, error);
    return null;
  }
}

async function writeRow(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(UPSERT_SQL).bind(key, value, Date.now()).run();
}
