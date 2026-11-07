import { Hono } from 'hono';
import { runCollection } from './collect';
import { createStorage } from './storage';
import { getStatusPayload, primeStatusCache } from './status-cache';
import { seedDemoData } from './seed';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

/** 客户端缓存 60 秒；标签页每 5 分钟轮询一次，正常情况下每次请求都能命中边缘缓存。 */
const STATUS_CACHE_CONTROL = 'public, max-age=60';
/** 数据库不可用、只能回退到旧数据时，让客户端更快重试。 */
const STALE_CACHE_CONTROL = 'public, max-age=30';

function requestRetryAfterSeconds(nowMs: number): number {
  const nextUtcMidnight = Math.floor(nowMs / 86_400_000) * 86_400_000 + 86_400_000;
  return Math.max(60, Math.ceil((nextUtcMidnight - nowMs) / 1000));
}

function ifNoneMatchMatches(header: string, etag: string): boolean {
  return header
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === etag || value === `W/${etag}` || value === '*');
}

async function statusResponse(request: Request, env: Env): Promise<Response> {
  let payload;
  try {
    const storage = createStorage(env);
    payload = await getStatusPayload(() => storage.loadStatus());
  } catch (error) {
    console.error('[api/status] db read failed', error);
    const detail = error instanceof Error ? error.message : String(error);
    const quotaExceeded = /429|limit|quota|exceed|daily/i.test(detail);
    // 额度耗尽时重试到 UTC 零点（北京时间 08:00）才有意义；其它故障 60 秒后重试。
    const retryAfter = quotaExceeded ? requestRetryAfterSeconds(Date.now()) : 60;
    return new Response(
      JSON.stringify({
        error: 'database read failed',
        detail,
        hint: quotaExceeded
          ? 'D1 免费版每天 500 万行读 / 10 万行写，额度在 UTC 00:00（北京时间 08:00）重置'
          : '数据库暂时不可用，请稍后重试',
        retryAfterSeconds: retryAfter,
      }),
      {
        status: 500,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'retry-after': String(retryAfter),
          'access-control-allow-origin': '*',
        },
      },
    );
  }
  if (!payload) {
    return new Response(JSON.stringify({ error: 'no status data yet', retryAfterSeconds: 30 }), {
      status: 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '30',
        'access-control-allow-origin': '*',
      },
    });
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': payload.source === 'stale' ? STALE_CACHE_CONTROL : STATUS_CACHE_CONTROL,
    'access-control-allow-origin': '*',
    etag: payload.etag,
    'x-knloop-cache': payload.source,
  };
  if (payload.source === 'stale') headers['x-knloop-stale'] = '1';

  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatchMatches(ifNoneMatch, payload.etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(payload.body, { status: 200, headers });
}

const CORS_PREFLIGHT_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Accept, If-None-Match',
  'access-control-max-age': '86400',
};

function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_PREFLIGHT_HEADERS });
}

app.options('/api/status', () => preflightResponse());
app.options('/data/status.json', () => preflightResponse());

app.get('/api/status', (c) => statusResponse(c.req.raw, c.env));
app.get('/data/status.json', (c) => statusResponse(c.req.raw, c.env));

// 健康检查只反映 Worker 存活，不读数据库（外部监控高频请求不会再消耗存储额度）。
app.get('/healthz', (c) =>
  c.json({ ok: true, now: new Date().toISOString(), hasDb: Boolean(c.env.STATUS_DB) }, 200, {
    'cache-control': 'no-store',
  }),
);
app.get('/api/health', (c) =>
  c.json({ ok: true, now: new Date().toISOString(), hasDb: Boolean(c.env.STATUS_DB) }, 200, {
    'cache-control': 'no-store',
  }),
);

// 一次性注入 60 天测试数据（需要 ADMIN_TOKEN；已有数据时需 ?force=1）。
app.post('/api/admin/seed', async (c) => {
  const token = c.env.ADMIN_TOKEN;
  const authorization = c.req.header('authorization') ?? '';
  if (!token || authorization !== `Bearer ${token}`) return c.text('not found', 404);
  try {
    const storage = createStorage(c.env);
    const existing = await storage.loadStatus();
    if (existing && c.req.query('force') !== '1') {
      return c.json({ error: 'status data already exists', hint: 'retry with ?force=1 to replace it' }, 409);
    }
    const result = await seedDemoData(c.env, Date.now(), storage);
    const document = await storage.loadStatus();
    if (document) await primeStatusCache(document);
    return c.json({ ok: true, ...result }, 201);
  } catch (error) {
    console.error('[seed] failed', error);
    return c.json({ error: 'seed failed', detail: error instanceof Error ? error.message : String(error) }, 500);
  }
});

// 手动触发一次采集（需要 ADMIN_TOKEN；空值时路由不存在，避免生产误用）。
app.post('/api/admin/run', async (c) => {
  const token = c.env.ADMIN_TOKEN;
  const authorization = c.req.header('authorization') ?? '';
  if (!token || authorization !== `Bearer ${token}`) return c.text('not found', 404);
  c.executionCtx.waitUntil(
    runCollection(c.env).catch((error) => console.error('[collect] admin run failed', error)),
  );
  return c.json({ ok: true, started: true }, 202);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    // Cron 的 wall time 限制是 15 分钟；直接 await 比 waitUntil 的 30 秒窗口更适合完整采集。
    try {
      const document = await runCollection(env);
      console.log('[collect] cron done', JSON.stringify(document.services.map((service) => ({
        key: service.key,
        status: service.status,
        latency: service.latency,
        total: service.checks.total,
      }))));
    } catch (error) {
      console.error('[collect] cron failed', error);
      throw error;
    }
  },
};

export { app };
