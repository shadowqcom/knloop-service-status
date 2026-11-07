import { beforeEach, describe, expect, it } from 'vitest';
import {
  FRESH_DATA_AGE_MS,
  MEMORY_TTL_MS,
  SOURCE_ERROR_BACKOFF_MS,
  STALE_DATA_REFRESH_MS,
  STALE_MAX_MS,
  getStatusPayload,
  primeStatusCache,
  resetStatusCacheForTests,
} from '../src/status-cache';
import type { StatusCache } from '../src/status-cache';
import type { StatusDocument } from '../src/types';

const T0 = Date.parse('2026-11-07T10:00:00+08:00');

function fixture(unix: number = Math.floor(T0 / 1000)): StatusDocument {
  return {
    schema: 2,
    generatedAt: '2026-11-07T10:00:00+08:00',
    generatedAtUnix: unix,
    retentionDays: 60,
    services: [],
  };
}

class FakeLoader {
  calls = 0;

  constructor(
    public document: StatusDocument | null = fixture(),
    public failure: Error | null = null,
  ) {}

  load = async (): Promise<StatusDocument | null> => {
    this.calls += 1;
    if (this.failure) throw this.failure;
    return this.document ? (JSON.parse(JSON.stringify(this.document)) as StatusDocument) : null;
  };
}

class MemoryCache implements StatusCache {
  readonly entries = new Map<string, Response>();
  puts = 0;

  async match(request: Request): Promise<Response | undefined> {
    const stored = this.entries.get(request.url);
    return stored ? stored.clone() : undefined;
  }

  async put(request: Request, response: Response): Promise<void> {
    this.puts += 1;
    this.entries.set(request.url, response.clone());
  }
}

class ThrowingMatchCache extends MemoryCache {
  override async match(): Promise<Response | undefined> {
    throw new Error('cache.match unavailable');
  }
}

class ThrowingPutCache extends MemoryCache {
  override async put(): Promise<void> {
    throw new Error('cache.put unavailable');
  }
}

beforeEach(() => {
  resetStatusCacheForTests();
});

describe('getStatusPayload', () => {
  it('loads the document once, then serves from memory and edge cache within their windows', async () => {
    const loader = new FakeLoader();
    const cache = new MemoryCache();

    const first = await getStatusPayload(loader.load, { nowMs: T0, cache });
    expect(first?.source).toBe('db');
    expect(loader.calls).toBe(1);
    expect(cache.puts).toBe(1);

    const fromMemory = await getStatusPayload(loader.load, { nowMs: T0 + MEMORY_TTL_MS - 1, cache });
    expect(fromMemory?.source).toBe('memory');
    expect(loader.calls).toBe(1);

    const fromEdge = await getStatusPayload(loader.load, { nowMs: T0 + MEMORY_TTL_MS + 1, cache });
    expect(fromEdge?.source).toBe('edge');
    expect(loader.calls).toBe(1);

    // 超过“数据新鲜窗口”后才重新读数据源（数据每 5 分钟采集一次，窗口 6 分钟）。
    const refreshed = await getStatusPayload(loader.load, { nowMs: T0 + FRESH_DATA_AGE_MS + 1, cache });
    expect(refreshed?.source).toBe('db');
    expect(loader.calls).toBe(2);
  });

  it('serves the stale edge copy when the data source throws', async () => {
    const cache = new MemoryCache();
    await primeStatusCache(fixture(), T0, cache);

    const failing = new FakeLoader(fixture(), new Error('D1_ERROR: network connection lost'));
    const stale = await getStatusPayload(failing.load, { nowMs: T0 + FRESH_DATA_AGE_MS + 1, cache });

    expect(stale?.source).toBe('stale');
    expect(stale?.etag).toBe(`"status-${fixture().generatedAtUnix}"`);
    expect(JSON.parse(stale!.body).schema).toBe(2);
    expect(failing.calls).toBe(1);
  });

  it('backs off data source retries for a minute after a failure while serving stale data', async () => {
    const cache = new MemoryCache();
    await primeStatusCache(fixture(), T0, cache);

    const failing = new FakeLoader(fixture(), new Error('D1_ERROR: unavailable'));
    const at = T0 + FRESH_DATA_AGE_MS + 1;
    const first = await getStatusPayload(failing.load, { nowMs: at, cache });
    expect(first?.source).toBe('stale');
    expect(failing.calls).toBe(1);

    const withinBackoff = await getStatusPayload(failing.load, { nowMs: at + 1_000, cache });
    expect(withinBackoff?.source).toBe('stale');
    expect(failing.calls).toBe(1);

    const afterBackoff = await getStatusPayload(failing.load, { nowMs: at + SOURCE_ERROR_BACKOFF_MS + 1, cache });
    expect(afterBackoff?.source).toBe('stale');
    expect(failing.calls).toBe(2);
  });

  it('serves stale cache when the data source returns null during an outage', async () => {
    const cache = new MemoryCache();
    await primeStatusCache(fixture(), T0, cache);

    const empty = new FakeLoader(null);
    const at = T0 + FRESH_DATA_AGE_MS + 1;
    const stale = await getStatusPayload(empty.load, { nowMs: at, cache });
    expect(stale?.source).toBe('stale');
    expect(empty.calls).toBe(1);

    const backedOff = await getStatusPayload(empty.load, { nowMs: at + 1_000, cache });
    expect(backedOff?.source).toBe('stale');
    expect(empty.calls).toBe(1);
  });

  it('throws when the data source fails and there is no cached copy', async () => {
    const failing = new FakeLoader(fixture(), new Error('D1_ERROR: unavailable'));
    await expect(getStatusPayload(failing.load, { nowMs: T0, cache: null })).rejects.toThrow('D1_ERROR');
  });

  it('does not serve cache entries older than the stale window', async () => {
    const cache = new MemoryCache();
    await primeStatusCache(fixture(), T0, cache);

    const failing = new FakeLoader(fixture(), new Error('D1_ERROR: unavailable'));
    await expect(
      getStatusPayload(failing.load, { nowMs: T0 + STALE_MAX_MS + 60_000, cache }),
    ).rejects.toThrow('D1_ERROR');
  });

  it('returns null when the data source has no data and no cache exists', async () => {
    const empty = new FakeLoader(null);
    const result = await getStatusPayload(empty.load, { nowMs: T0, cache: null });
    expect(result).toBeNull();
    expect(empty.calls).toBe(1);
  });

  it('primeStatusCache stores body/etag without loading the data source', async () => {
    const loader = new FakeLoader();
    const cache = new MemoryCache();

    await primeStatusCache(fixture(1_794_007_200), T0, cache);
    expect(loader.calls).toBe(0);
    expect(cache.puts).toBe(1);

    const hit = await getStatusPayload(loader.load, { nowMs: T0 + 1_000, cache: null });
    expect(hit?.source).toBe('memory');
    expect(hit?.generatedAtUnix).toBe(1_794_007_200);
    expect(hit?.etag).toBe('"status-1794007200"');
  });

  it('reuses a refreshed cache entry for 5 minutes when the data itself is stale', async () => {
    const loader = new FakeLoader(fixture(Math.floor(T0 / 1000) - 3_600));
    const cache = new MemoryCache();

    const first = await getStatusPayload(loader.load, { nowMs: T0, cache });
    expect(first?.source).toBe('db');
    expect(loader.calls).toBe(1);

    const withinStaleWindow = await getStatusPayload(loader.load, { nowMs: T0 + STALE_DATA_REFRESH_MS - 1, cache });
    expect(withinStaleWindow?.source).toBe('edge');
    expect(loader.calls).toBe(1);

    const afterStaleWindow = await getStatusPayload(loader.load, { nowMs: T0 + STALE_DATA_REFRESH_MS + 1, cache });
    expect(afterStaleWindow?.source).toBe('db');
    expect(loader.calls).toBe(2);
  });

  it('degrades to the data source when cache.match throws', async () => {
    const loader = new FakeLoader();
    const result = await getStatusPayload(loader.load, { nowMs: T0, cache: new ThrowingMatchCache() });
    expect(result?.source).toBe('db');
    expect(loader.calls).toBe(1);
  });

  it('still serves the document when cache.put throws', async () => {
    const loader = new FakeLoader();
    const result = await getStatusPayload(loader.load, { nowMs: T0, cache: new ThrowingPutCache() });
    expect(result?.source).toBe('db');
    expect(result?.generatedAtUnix).toBe(fixture().generatedAtUnix);
  });

  it('ignores malformed cache entries', async () => {
    const cache = new MemoryCache();
    const cacheKey = 'https://knloop-status.internal/__cache/status-v2';
    cache.entries.set(cacheKey, new Response('{}', { status: 200, headers: { 'cache-control': 'public, max-age=86400' } }));

    const loader = new FakeLoader();
    const result = await getStatusPayload(loader.load, { nowMs: T0, cache });
    expect(result?.source).toBe('db');
    expect(loader.calls).toBe(1);
  });

  it('does not overwrite a newer cached version with an older load result', async () => {
    const cachedUnix = Math.floor(T0 / 1000) - 3_600;
    const cache = new MemoryCache();
    await primeStatusCache(fixture(cachedUnix), T0, cache);

    // 缓存已过期、需要重新加载；但 loader 返回更旧的数据（并发/复制延迟场景）。
    const loader = new FakeLoader(fixture(cachedUnix - 3_600));
    const result = await getStatusPayload(loader.load, { nowMs: T0 + FRESH_DATA_AGE_MS + 1, cache });

    expect(result?.source).toBe('edge');
    expect(result?.generatedAtUnix).toBe(cachedUnix);
    expect(loader.calls).toBe(1);
    expect(cache.puts).toBe(1); // 只有 prime 那次写入，旧数据没有覆盖缓存
  });
});
