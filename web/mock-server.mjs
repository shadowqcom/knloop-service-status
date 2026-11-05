#!/usr/bin/env node
// 本地验收用 mock server：
// - GET /api/status 读取仓库 data/status.json 作为夹具并托管 worker/public 构建产物；
// - generatedAt / generatedAtUnix 改为当前时间（契约要求）；
// - 夹具的 daily/hourly 会整体平移到"今天 / 当前小时"，否则最近 12h 图表为空、60 天窗口错位；
// - 环境变量：MOCK_STALE_MINUTES=120 模拟过期数据；MOCK_ERROR=1 模拟 503；MOCK_EMPTY=1 模拟空服务列表。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const DIST_ROOT = resolve(WEB_ROOT, '..', 'worker', 'public');
const FIXTURE_PATH = resolve(WEB_ROOT, '..', 'data', 'status.json');

const PORT = Number(process.env.PORT || 4173);
const STALE_MINUTES = Number(process.env.MOCK_STALE_MINUTES || 0);
const ERROR_MODE = process.env.MOCK_ERROR === '1';
const EMPTY_MODE = process.env.MOCK_EMPTY === '1';

// /__mock?stale=120&error=1&empty=1 可在运行时切换，便于截图不同状态
let modeOverride = null;

function currentMode() {
  return modeOverride || { staleMinutes: STALE_MINUTES, error: ERROR_MODE, empty: EMPTY_MODE, delayMs: 0 };
}

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const BEIJING_OFFSET_MS = 8 * HOUR_MS;

const FIXTURE = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function beijingDateStr(ms) {
  const date = new Date(ms + BEIJING_OFFSET_MS);
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
}

function beijingDateStartMs(dateStr) {
  return Date.parse(dateStr + 'T00:00:00+08:00');
}

function shiftDate(dateStr, days) {
  const ms = beijingDateStartMs(dateStr) + days * DAY_MS;
  const date = new Date(ms + BEIJING_OFFSET_MS);
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
}

function beijingIso(ms) {
  return new Date(ms + BEIJING_OFFSET_MS).toISOString().replace('Z', '+08:00');
}

function buildPayload(now, empty) {
  const services = [];
  for (const service of FIXTURE.services) {
    const copy = JSON.parse(JSON.stringify(service));

    const daily = Array.isArray(copy.daily) ? copy.daily : [];
    let dayShift = 0;
    if (daily.length > 0) {
      const lastDate = daily[daily.length - 1][0];
      const today = beijingDateStr(now);
      dayShift = Math.round((beijingDateStartMs(today) - beijingDateStartMs(lastDate)) / DAY_MS);
      copy.daily = daily.map((row) => [shiftDate(row[0], dayShift)].concat(row.slice(1)));
    }

    const hourly = Array.isArray(copy.hourly) ? copy.hourly : [];
    const currentHourSec = Math.floor(now / HOUR_MS) * 3600;
    if (hourly.length > 0) {
      const lastHourSec = hourly[hourly.length - 1][0];
      const shiftSec = currentHourSec - lastHourSec;
      const shifted = hourly.map((row) => [row[0] + shiftSec, row[1], row[2]]);

      // 仅 mock 的演示增强：夹具采集频率约 5-7 次/天，最近 12h 往往只有 1 个点；
      // 为验收图表视觉，把最近 13 个整点中缺失的小时用相邻夹具点线性插值补齐。
      // 生产 /api/status 不经过 mock，缺失小时仍为 null（图表按虚线断点展示）。
      const byHour = new Map(shifted.map((row) => [row[0], row]));
      const sorted = shifted.slice().sort((a, b) => a[0] - b[0]);
      for (let offset = 12; offset >= 0; offset -= 1) {
        const hourSec = currentHourSec - offset * 3600;
        if (byHour.has(hourSec)) continue;
        let prev = null;
        let next = null;
        for (const row of sorted) {
          if (row[0] < hourSec) prev = row;
          else if (row[0] > hourSec) { next = row; break; }
        }
        let p50 = null;
        let p95 = null;
        if (prev && next) {
          const ratio = (hourSec - prev[0]) / (next[0] - prev[0]);
          p50 = prev[1] === null || next[1] === null ? prev[1] : Math.round(prev[1] + (next[1] - prev[1]) * ratio);
          p95 = prev[2] === null || next[2] === null ? prev[2] : Math.round(prev[2] + (next[2] - prev[2]) * ratio);
        } else if (prev) {
          p50 = prev[1];
          p95 = prev[2];
        } else if (next) {
          p50 = next[1];
          p95 = next[2];
        }
        if (p50 !== null) byHour.set(hourSec, [hourSec, p50, p95]);
      }
      copy.hourly = Array.from(byHour.values()).sort((a, b) => a[0] - b[0]);
    }

    copy.lastCheckAt = beijingIso(now - 60 * 1000);
    services.push(copy);
  }

  return {
    schema: FIXTURE.schema ?? 2,
    generatedAt: beijingIso(now),
    generatedAtUnix: Math.floor(now / 1000),
    retentionDays: FIXTURE.retentionDays ?? 60,
    services: empty ? [] : services
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendText(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function serveStatic(res, pathname) {
  const requestPath = pathname === '/' ? '/index.html' : pathname;
  let filePath = resolve(DIST_ROOT, '.' + requestPath);
  if (filePath !== DIST_ROOT && !filePath.startsWith(DIST_ROOT + sep)) {
    sendText(res, 404, 'Not Found');
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) throw new Error('is directory');
  } catch {
    filePath = join(DIST_ROOT, 'index.html');
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  } catch {
    sendText(res, 404, 'Not Found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1:' + PORT);
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname === '/__mock') {
      const hasParams = Array.from(url.searchParams.keys()).length > 0;
      if (!hasParams || url.searchParams.get('reset') === '1') {
        modeOverride = null;
      } else {
        modeOverride = {
          staleMinutes: Number(url.searchParams.get('stale') || 0),
          error: url.searchParams.get('error') === '1',
          empty: url.searchParams.get('empty') === '1',
          delayMs: Number(url.searchParams.get('delay') || 0)
        };
      }
      sendJson(res, 200, { ok: true, mode: currentMode() });
      return;
    }
    if (pathname === '/api/status') {
      const mode = currentMode();
      if (mode.delayMs > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, mode.delayMs));
      }
      if (mode.error) {
        sendJson(res, 503, { error: 'mock 503：模拟 /api/status 失败' });
        return;
      }
      const now = mode.staleMinutes > 0 ? Date.now() - mode.staleMinutes * 60000 : Date.now();
      sendJson(res, 200, buildPayload(now, mode.empty));
      console.log('[mock] GET /api/status -> 200', beijingIso(now), 'empty=' + mode.empty + ' stale=' + mode.staleMinutes + 'm');
      return;
    }
    if (pathname === '/healthz') {
      sendJson(res, 200, { ok: true, generatedAt: beijingIso(Date.now()) });
      return;
    }
    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }
    await serveStatic(res, pathname);
  } catch (error) {
    sendText(res, 500, 'Internal Server Error: ' + error.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[mock] fixture:', FIXTURE_PATH);
  console.log('[mock] static root:', DIST_ROOT);
  console.log('[mock] listening http://127.0.0.1:' + PORT + '/ (stale=' + STALE_MINUTES + 'min, error=' + ERROR_MODE + ', empty=' + EMPTY_MODE + ')');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
