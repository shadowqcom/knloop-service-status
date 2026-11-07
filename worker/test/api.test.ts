import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { resetStatusCacheForTests } from '../src/status-cache';
import { STATUS_KEY } from '../src/storage';
import { FakeD1 } from './helpers';
import type { Env, StatusDocument } from '../src/types';

const DOC: StatusDocument = {
  schema: 2,
  generatedAt: '2026-11-07T10:00:00+08:00',
  generatedAtUnix: 1_794_007_200,
  retentionDays: 60,
  services: [],
};

function dbWithDocument(): FakeD1 {
  const db = new FakeD1();
  db.seedRow(STATUS_KEY, DOC);
  return db;
}

function envWith(db: FakeD1): Env {
  return {
    STATUS_DB: db as unknown as D1Database,
    ASSETS: {} as Fetcher,
    STATUS_RETENTION_DAYS: '60',
  } as Env;
}

beforeEach(() => {
  resetStatusCacheForTests();
});

describe('GET /api/status', () => {
  it('returns cacheable JSON from D1 with ETag and a cache-source header', async () => {
    const db = dbWithDocument();
    const response = await app.request('/api/status', { method: 'GET' }, envWith(db));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(response.headers.get('etag')).toBe('"status-1794007200"');
    expect(response.headers.get('x-knloop-cache')).toBe('db');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect((await response.json()) as StatusDocument).toMatchObject({ schema: 2, generatedAtUnix: 1_794_007_200 });
    expect(db.prepareCalls).toBeGreaterThan(0);
  });

  it('serves repeat requests from memory without another database query', async () => {
    const db = dbWithDocument();
    const env = envWith(db);

    await app.request('/api/status', { method: 'GET' }, env);
    const prepareCallsAfterFirst = db.prepareCalls;
    const second = await app.request('/api/status', { method: 'GET' }, env);

    expect(second.headers.get('x-knloop-cache')).toBe('memory');
    expect(db.prepareCalls).toBe(prepareCallsAfterFirst);
  });

  it('answers 304 with cache headers when If-None-Match matches the current ETag', async () => {
    const response = await app.request(
      '/api/status',
      { method: 'GET', headers: { 'If-None-Match': '"status-1794007200"' } },
      envWith(dbWithDocument()),
    );

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
    expect(response.headers.get('etag')).toBe('"status-1794007200"');
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(response.headers.get('x-knloop-cache')).toBe('db');
  });

  it('supports weak and wildcard If-None-Match values', async () => {
    const env = envWith(dbWithDocument());

    const weak = await app.request(
      '/api/status',
      { method: 'GET', headers: { 'If-None-Match': 'W/"status-1794007200"' } },
      env,
    );
    expect(weak.status).toBe(304);

    const wildcard = await app.request('/api/status', { method: 'GET', headers: { 'If-None-Match': '*' } }, env);
    expect(wildcard.status).toBe(304);
  });

  it('returns 200 when If-None-Match does not match', async () => {
    const response = await app.request(
      '/api/status',
      { method: 'GET', headers: { 'If-None-Match': '"status-1"' } },
      envWith(dbWithDocument()),
    );

    expect(response.status).toBe(200);
    expect(((await response.json()) as StatusDocument).schema).toBe(2);
  });

  it('returns 503 without cache when the database has no data', async () => {
    const response = await app.request('/api/status', { method: 'GET' }, envWith(new FakeD1()));

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('retry-after')).toBe('30');
  });

  it('answers CORS preflight for /api/status', async () => {
    const response = await app.request('/api/status', { method: 'OPTIONS' }, envWith(new FakeD1()));

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')).toContain('If-None-Match');
  });

  it('returns 500 with a Retry-After pointing at the quota reset when storage is rate limited', async () => {
    const db = dbWithDocument();
    db.failure = new Error('D1_ERROR: 429 daily read limit exceeded');
    const response = await app.request('/api/status', { method: 'GET' }, envWith(db));

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(60);
  });

  it('returns 500 with a short Retry-After for generic storage failures', async () => {
    const db = dbWithDocument();
    db.failure = new Error('network connection lost');
    const response = await app.request('/api/status', { method: 'GET' }, envWith(db));

    expect(response.status).toBe(500);
    expect(response.headers.get('retry-after')).toBe('60');
  });

  it('also serves the same document at /data/status.json', async () => {
    const response = await app.request('/data/status.json', { method: 'GET' }, envWith(dbWithDocument()));
    expect(response.status).toBe(200);
    expect((await response.json()) as StatusDocument).toMatchObject({ schema: 2 });
  });
});

describe('health endpoints', () => {
  it('GET /healthz does not query the database', async () => {
    const db = new FakeD1();
    const response = await app.request('/healthz', { method: 'GET' }, envWith(db));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ ok: true, hasDb: true });
    expect(db.prepareCalls).toBe(0);
    expect(db.execCalls).toBe(0);
  });

  it('GET /api/health does not query the database either', async () => {
    const db = new FakeD1();
    const response = await app.request('/api/health', { method: 'GET' }, envWith(db));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, hasDb: true });
    expect(db.prepareCalls).toBe(0);
  });
});
