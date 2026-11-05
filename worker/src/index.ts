import { Hono } from 'hono';
import { runCollection } from './collect';
import { loadStatus } from './storage';
import { seedDemoData } from './seed';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

async function statusResponse(env: Env): Promise<Response> {
  let document;
  try {
    document = await loadStatus(env.STATUS_KV);
  } catch (error) {
    console.error('[api/status] kv read failed', error);
    return new Response(JSON.stringify({ error: 'KV read failed', detail: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (!document) {
    return new Response(JSON.stringify({ error: 'no status data yet' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return new Response(JSON.stringify(document), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60',
      'access-control-allow-origin': '*',
    },
  });
}

app.get('/api/status', (c) => statusResponse(c.env));
app.get('/data/status.json', (c) => statusResponse(c.env));
app.get('/healthz', async (c) => {
  try {
    const document = await loadStatus(c.env.STATUS_KV);
    return c.json({ ok: true, now: new Date().toISOString(), hasKv: Boolean(c.env.STATUS_KV), hasStatus: document !== null });
  } catch (error) {
    console.error('[healthz] kv read failed', error);
    return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
app.get('/api/health', async (c) => {
  try {
    const document = await loadStatus(c.env.STATUS_KV);
    return c.json({ ok: true, hasKv: Boolean(c.env.STATUS_KV), hasStatus: document !== null });
  } catch (error) {
    return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

// 一次性注入 60 天测试数据（需要 ADMIN_TOKEN；已有数据时需 ?force=1）。
app.post('/api/admin/seed', async (c) => {
  const token = c.env.ADMIN_TOKEN;
  const authorization = c.req.header('authorization') ?? '';
  if (!token || authorization !== `Bearer ${token}`) return c.text('not found', 404);
  try {
    const existing = await loadStatus(c.env.STATUS_KV);
    if (existing && c.req.query('force') !== '1') {
      return c.json({ error: 'status data already exists', hint: 'retry with ?force=1 to replace it' }, 409);
    }
    const result = await seedDemoData(c.env);
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
