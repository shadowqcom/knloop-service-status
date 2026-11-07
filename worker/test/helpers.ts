import { createEmptyState } from '../src/aggregate';
import type { AppState, StatusDocument } from '../src/types';
import type { StatusStorage } from '../src/storage';

/** 采集/seed 测试用的内存存储，避免依赖 SQL 细节。 */
export class MemoryStorage implements StatusStorage {
  state: AppState | null = null;
  document: StatusDocument | null = null;
  saveAllCalls = 0;
  saveAllError: Error | null = null;

  constructor(init?: { state?: AppState; document?: StatusDocument }) {
    this.state = init?.state ?? null;
    this.document = init?.document ?? null;
  }

  async loadState(retentionDays = 60, nowMs = Date.now()): Promise<AppState> {
    return this.state ?? createEmptyState(retentionDays, nowMs);
  }

  async loadStatus(): Promise<StatusDocument | null> {
    return this.document;
  }

  async saveState(state: AppState): Promise<void> {
    this.state = state;
  }

  async saveStatus(document: StatusDocument): Promise<void> {
    this.document = document;
  }

  async saveAll(state: AppState, document: StatusDocument): Promise<void> {
    this.saveAllCalls += 1;
    if (this.saveAllError) throw this.saveAllError;
    this.state = state;
    this.document = document;
  }
}

interface BoundStatement {
  run(): Promise<unknown>;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}

/** 只理解本项目用到的那几条 SQL 的 D1 假实现。 */
export class FakeD1 {
  private readonly rows = new Map<string, string>();
  execCalls = 0;
  prepareCalls = 0;
  batchCalls = 0;
  rowsWritten = 0;
  lastExecSql: string | null = null;
  failure: Error | null = null;

  seedRow(key: string, value: unknown): void {
    this.rows.set(key, JSON.stringify(value));
  }

  seedRaw(key: string, raw: string): void {
    this.rows.set(key, raw);
  }

  rawRow(key: string): string | undefined {
    return this.rows.get(key);
  }

  jsonRow<T>(key: string): T | null {
    const raw = this.rows.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  async exec(sql?: string): Promise<unknown> {
    this.execCalls += 1;
    this.lastExecSql = sql ?? null;
    if (this.failure) throw this.failure;
    return { count: 0, duration: 0 };
  }

  prepare(sql: string): BoundStatement {
    this.prepareCalls += 1;
    if (this.failure) throw this.failure;
    return {
      bind: (...args: unknown[]): BoundStatement => ({
        first: async <T>(): Promise<T | null> => {
          if (/SELECT value FROM status_store/i.test(sql)) {
            const key = String(args[0]);
            const value = this.rows.get(key);
            return value === undefined ? null : ({ value } as T);
          }
          throw new Error('unexpected first() SQL: ' + sql);
        },
        run: async (): Promise<unknown> => {
          if (/INSERT INTO status_store/i.test(sql)) {
            const [key, value] = args as [string, string];
            this.rows.set(key, value);
            this.rowsWritten += 1;
            return { success: true, meta: {} };
          }
          throw new Error('unexpected run() SQL: ' + sql);
        },
        all: async <T>(): Promise<{ results: T[] }> => ({ results: [] }),
      }),
    } as unknown as BoundStatement;
  }

  async batch(statements: BoundStatement[]): Promise<unknown[]> {
    this.batchCalls += 1;
    const results: unknown[] = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }
}

