import { Hono } from 'hono';
import { runCollection } from './collect';
import { loadStatus } from './storage';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

async function statusResponse(env: Env): Promise<Response> {
  const document = await loadStatus(env.STATUS_KV);
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
  const document = await loadStatus(c.env.STATUS_KV);
  return c.json({ ok: true, now: new Date().toISOString(), hasStatus: document !== null });
});
app.get('/api/health', async (c) => {
  const document = await loadStatus(c.env.STATUS_KV);
  return c.json({ ok: true, hasStatus: document !== null });
});

// 手动触发一次采集（需要 ADMIN_TOKEN；空值时路由不存在，避免生产误用）。
app.post('/api/admin/run', async (c) => {
  const token = c.env.ADMIN_TOKEN;
  const authorization = c.req.header('authorization') ?? '';
  if (!token || authorization !== `Bearer ${token}`) return c.text('not found', 404);
  c.executionCtx.waitUntil(runCollection(c.env));
  return c.json({ ok: true, started: true }, 202);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCollection(env));
  },
};
