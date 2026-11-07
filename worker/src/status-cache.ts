import type { StatusDocument } from './types';

/**
 * 状态文档的读取缓存层。
 *
 * 设计目标：把「每次 /api/status 请求都读一次数据库」变成「按数据新鲜度读数据库」：
 * - L1：模块内存，15 秒（同一 isolate 内的突发请求）；
 * - L2：Cloudflare Cache API，数据在 6 分钟窗口内时直接返回，不产生 D1 读；
 *   缓存条目本身保留 24 小时，D1 查询失败时可以继续用旧数据兜底；
 * - L3：数据源（D1，由调用方传入 loader）。
 *
 * 缓存命中不产生数据库操作；D1 免费版每天 500 万行读，配合缓存基本用不到 1%。
 */
export interface StatusCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export type StatusSource = 'memory' | 'edge' | 'db' | 'stale';

export interface StatusPayload {
  /** 序列化后的 StatusDocument，直接作为响应体。 */
  body: string;
  etag: string;
  generatedAtUnix: number;
  /** 写入内存 / 边缘缓存的时间（epoch ms）。 */
  storedAtMs: number;
  source: StatusSource;
}

type StoredPayload = Omit<StatusPayload, 'source'>;

/** 数据源加载器：正常是 D1 查询，测试里可以注入。 */
export type StatusLoader = () => Promise<StatusDocument | null>;

/** 合成缓存键：与真实请求 URL 无关，保证所有请求共享同一条缓存。 */
const CACHE_URL = 'https://knloop-status.internal/__cache/status-v2';
const MEMORY_TTL_MS = 15_000;
/**
 * 数据“新鲜”的时间窗：采集每 5 分钟一次，留 60 秒 Cron 抖动余量。
 * 窗口内直接返回边缘缓存、不读 D1，代价是最多比最新 D1 值晚一个采集周期（状态页可接受）。
 */
const FRESH_DATA_AGE_MS = 6 * 60 * 1000;
/**
 * 数据本身已过期（例如 Cron 连续失败）时，读回 D1 后至少 5 分钟不再重复读：
 * 否则每个有流量的数据中心会退化成“每分钟一次 D1 读”。
 */
const STALE_DATA_REFRESH_MS = 5 * 60 * 1000;
/** 数据源读取失败 / 读到空值后的退避时间，避免故障期间每个请求都重试。 */
const SOURCE_ERROR_BACKOFF_MS = 60_000;
/** 数据源不可用时最多回退到多久以前的数据。 */
const STALE_MAX_MS = 6 * 60 * 60 * 1000;
/** 边缘缓存条目保留时长（不是客户端 TTL，客户端 TTL 见 index.ts）。 */
const CACHE_STORE_SECONDS = 24 * 60 * 60;

let memory: StoredPayload | null = null;
let sourceRetryAfterMs = 0;

export interface GetStatusOptions {
  nowMs?: number;
  /** 测试注入；undefined = 使用 caches.default，null = 禁用边缘缓存。 */
  cache?: StatusCache | null;
}

export async function getStatusPayload(
  loadDocument: StatusLoader,
  options: GetStatusOptions = {},
): Promise<StatusPayload | null> {
  const nowMs = options.nowMs ?? Date.now();
  const cache = options.cache === undefined ? defaultCache() : options.cache;

  if (memory && nowMs - memory.storedAtMs <= MEMORY_TTL_MS) {
    return { ...memory, source: 'memory' };
  }

  const cached = await readFromCache(cache);
  if (cached && isFresh(cached, nowMs)) {
    memory = cached;
    return { ...cached, source: 'edge' };
  }

  // 数据源刚失败过：60 秒内直接沿用旧缓存，避免故障期间每个请求都重试、刷日志。
  if (cached && nowMs < sourceRetryAfterMs && isServeableStale(cached, nowMs)) {
    return { ...cached, source: 'stale' };
  }

  try {
    const document = await loadDocument();
    if (!document) {
      sourceRetryAfterMs = nowMs + SOURCE_ERROR_BACKOFF_MS;
      return cached && isServeableStale(cached, nowMs) ? { ...cached, source: 'stale' } : null;
    }
    const fresh = toPayload(document, nowMs);
    // 写回竞态保护：并发请求中更旧的读结果晚到时，不要把缓存覆盖回旧版本。
    if (cached && cached.generatedAtUnix > fresh.generatedAtUnix) {
      memory = cached;
      return { ...cached, source: 'edge' };
    }
    sourceRetryAfterMs = 0;
    memory = fresh;
    await writeToCache(cache, fresh);
    return { ...fresh, source: 'db' };
  } catch (error) {
    sourceRetryAfterMs = nowMs + SOURCE_ERROR_BACKOFF_MS;
    if (cached && isServeableStale(cached, nowMs)) {
      console.error('[status-cache] data source read failed, serving stale cache', error);
      return { ...cached, source: 'stale' };
    }
    console.error('[status-cache] data source read failed', error);
    throw error;
  }
}

/** 采集完成后预热缓存，让 /api/status 立即拿到新数据。 */
export async function primeStatusCache(
  document: StatusDocument,
  nowMs: number = Date.now(),
  cacheOverride?: StatusCache | null,
): Promise<void> {
  const cache = cacheOverride === undefined ? defaultCache() : cacheOverride;
  const payload = toPayload(document, nowMs);
  sourceRetryAfterMs = 0;
  memory = payload;
  await writeToCache(cache, payload);
}

/** 仅测试使用：清空模块内存缓存与数据源退避状态。 */
export function resetStatusCacheForTests(): void {
  memory = null;
  sourceRetryAfterMs = 0;
}

function dataAgeMs(payload: StoredPayload, nowMs: number): number {
  return nowMs - payload.generatedAtUnix * 1000;
}

function isFresh(payload: StoredPayload, nowMs: number): boolean {
  if (dataAgeMs(payload, nowMs) <= FRESH_DATA_AGE_MS) return true;
  // 数据本身已过期（Cron 失败/写失败）：读回 D1 后至少 5 分钟内不再重复读。
  return nowMs - payload.storedAtMs <= STALE_DATA_REFRESH_MS;
}

function isServeableStale(payload: StoredPayload, nowMs: number): boolean {
  return dataAgeMs(payload, nowMs) <= STALE_MAX_MS;
}

function toPayload(document: StatusDocument, nowMs: number): StoredPayload {
  return {
    body: JSON.stringify(document),
    etag: `"status-${document.generatedAtUnix}"`,
    generatedAtUnix: document.generatedAtUnix,
    storedAtMs: nowMs,
  };
}

function defaultCache(): StatusCache | null {
  try {
    // WebWorker lib 里的 caches 类型没有 default，这里按运行时对象读取，兼容 Workers 与 Node 测试环境。
    const storage = (globalThis as unknown as { caches?: { default?: StatusCache } }).caches;
    return storage?.default ?? null;
  } catch {
    return null;
  }
}

async function readFromCache(cache: StatusCache | null): Promise<StoredPayload | null> {
  if (!cache) return null;
  try {
    const response = await cache.match(new Request(CACHE_URL));
    if (!response) return null;
    const body = await response.text();
    const etag = response.headers.get('etag');
    const generatedAtUnixHeader = response.headers.get('x-generated-at-unix');
    const storedAtHeader = response.headers.get('x-stored-at');
    if (!body || !etag || !generatedAtUnixHeader || !storedAtHeader) return null;
    const generatedAtUnix = Number(generatedAtUnixHeader);
    const storedAtMs = Number(storedAtHeader);
    if (!Number.isFinite(generatedAtUnix) || generatedAtUnix <= 0) return null;
    if (!Number.isFinite(storedAtMs) || storedAtMs <= 0) return null;
    return { body, etag, generatedAtUnix, storedAtMs };
  } catch (error) {
    console.warn('[status-cache] cache.match failed', error);
    return null;
  }
}

async function writeToCache(cache: StatusCache | null, payload: StoredPayload): Promise<void> {
  if (!cache) return;
  try {
    await cache.put(
      new Request(CACHE_URL),
      new Response(payload.body, {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          // 保留较长时间，数据源不可用时仍可兜底；新鲜度由上面的 FRESH_DATA_AGE_MS 判断。
          'cache-control': `public, max-age=${CACHE_STORE_SECONDS}`,
          etag: payload.etag,
          'x-stored-at': String(payload.storedAtMs),
          'x-generated-at-unix': String(payload.generatedAtUnix),
        },
      }),
    );
  } catch (error) {
    console.warn('[status-cache] cache.put failed', error);
  }
}

export {
  CACHE_URL as STATUS_CACHE_KEY_URL,
  MEMORY_TTL_MS,
  FRESH_DATA_AGE_MS,
  STALE_DATA_REFRESH_MS,
  SOURCE_ERROR_BACKOFF_MS,
  STALE_MAX_MS,
};
