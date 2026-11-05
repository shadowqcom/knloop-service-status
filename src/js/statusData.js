// 页面 v2 数据层：并行拉取 data/status.json -> 选新 -> localStorage 缓存 -> 轮询/新鲜度。
// 网络/缓存/定时器全部集中在这里，app.js 只消费 dashboard 视图模型。
import { getConfig, loadConfig } from './configLoader.js';
import {
  applyFreshness,
  buildDashboard,
  deriveRemoteDataUrl,
  parseLegacyLogText,
  pickFresher,
  aggregateLegacyEntries
} from './statusModel.js';

export const CACHE_KEY = 'knloop:status:v2';
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_POLL_SECONDS = 60;
const DEFAULT_STALE_AFTER_MIN = 45;
const FETCH_TIMEOUT_MS = 8000;
// 远程源（raw.githubusercontent.com）可能被墙：短超时，同源快照优先，避免每轮多等 8s
const REMOTE_FETCH_TIMEOUT_MS = 4000;

function safeStorage() {
  try {
    const storage = window.localStorage;
    const probe = '__knloop_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/** 读取 localStorage 缓存 dashboard（>24h 直接丢弃） */
export function readCachedDashboard(now = Date.now()) {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.dashboard) return null;
    if (typeof parsed.savedAt !== 'number' || now - parsed.savedAt > CACHE_MAX_AGE_MS) {
      storage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed.dashboard;
  } catch {
    return null;
  }
}

/** 写入缓存（存储失败静默降级，不影响页面） */
export function writeCachedDashboard(dashboard, now = Date.now()) {
  const storage = safeStorage();
  if (!storage || !dashboard) return false;
  try {
    storage.setItem(CACHE_KEY, JSON.stringify({
      version: 2,
      savedAt: now,
      generatedAtUnix: dashboard.generatedAtUnix,
      dashboard
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearCachedDashboard() {
  const storage = safeStorage();
  try {
    storage?.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

async function fetchWithTimeout(url, { cache = 'no-store', timeout = FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      cache,
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, { timeout = FETCH_TIMEOUT_MS } = {}) {
  // no-cache：带 ETag/Last-Modified 做条件请求，未变化时服务端返回 304（轮询省流量）
  const response = await fetchWithTimeout(url, { cache: 'no-cache', timeout });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}`);
  }
  return response.text();
}

/** 并行请求同源 ./data/status.json 与远程 dataUrl，选 generatedAtUnix 更新者（契约 3.1） */
export async function fetchStatusSources(config = {}) {
  const sources = [
    { label: '同源 data/status.json', url: './data/status.json', timeout: FETCH_TIMEOUT_MS },
    { label: '远程 dataUrl', url: deriveRemoteDataUrl(config), timeout: REMOTE_FETCH_TIMEOUT_MS }
  ].filter((source) => source.url);

  const settled = await Promise.allSettled(sources.map(async (source) => ({
    ...source,
    json: await fetchJson(source.url, { timeout: source.timeout })
  })));

  const valid = [];
  const errors = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const payload = result.value.json;
      if (payload && Array.isArray(payload.services)) valid.push(result.value);
      else errors.push({ url: sources[index].url, message: '返回内容缺少 services 数组' });
    } else {
      errors.push({ url: sources[index].url, message: result.reason?.message || String(result.reason) });
    }
  });

  if (valid.length === 0) {
    const error = new Error('status.json 数据源全部不可用');
    error.details = errors;
    throw error;
  }

  const best = valid.reduce((current, candidate) => pickFresher(current, candidate));
  return {
    snapshot: {
      kind: 'status',
      services: best.json.services,
      generatedAtUnix: best.json.generatedAtUnix,
      generatedAt: best.json.generatedAt,
      retentionDays: best.json.retentionDays,
      sourceLabel: best.label
    },
    errors
  };
}

/** 回退：逐服务读取 logs/<key>_report.log，单遍解析（契约 3.1） */
export async function fetchLegacySnapshot(config = {}) {
  const services = Array.isArray(config.services) ? config.services : [];
  const logspath = typeof config.logspath === 'string' ? config.logspath.trim().replace(/\/+$/, '') : '';

  const results = await Promise.all(services.map(async (service) => {
    const urls = [`./logs/${service.key}_report.log`];
    if (logspath) urls.push(`${logspath}/${service.key}_report.log`);

    let text = null;
    const errors = [];
    for (const url of urls) {
      try {
        text = await fetchText(url);
        break;
      } catch (error) {
        errors.push({ url, message: error.message });
      }
    }
    if (text === null) throw new Error(`${service.key} 日志全部不可用: ${errors.map((item) => item.message).join('; ')}`);

    return { key: service.key, url: service.url, entries: parseLegacyLogText(text) };
  }));

  const entries = results.flatMap((result) => result.entries);
  const latestUnix = entries.reduce((max, entry) => Math.max(max, Math.floor(entry.ts / 1000)), 0);

  return {
    snapshot: {
      kind: 'legacy',
      services: results.map((result) => {
        const aggregate = aggregateLegacyEntries(result.entries, {
          now: Date.now(),
          maxDays: config.maxDays || 60,
          maxHour: config.maxHour || 12
        });
        return { key: result.key, url: result.url, ...aggregate };
      }),
      generatedAtUnix: latestUnix || null,
      sourceLabel: '日志回退（legacy 解析）',
      warnings: [{ type: 'fallback', message: '实时数据源不可用，已回退到日志解析模式' }]
    },
    errors: []
  };
}

/**
 * 创建状态控制器：缓存先渲染、后台刷新、60s 轮询、hidden 暂停、可见立即刷新。
 */
export function createStatusController({ onUpdate, onPhase, now = () => Date.now() } = {}) {
  let config = null;
  let timer = null;
  let stopped = true;
  let inFlight = null;
  let latest = null;
  let lastGeneratedAtUnix = null;
  let started = false;

  const pollMs = () => {
    const seconds = Number(config?.pollIntervalSec);
    if (Number.isFinite(seconds) && seconds > 0) return Math.max(15, seconds) * 1000;
    return DEFAULT_POLL_SECONDS * 1000;
  };
  const staleAfterMin = () => {
    const minutes = Number(config?.staleAfterMin);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_STALE_AFTER_MIN;
  };
  const buildOptions = () => ({
    now: now(),
    maxDays: Number(config?.maxDays) || 60,
    maxHour: Number(config?.maxHour) || 12,
    staleAfterMin: staleAfterMin()
  });

  async function fetchSnapshot() {
    let sourceError = null;
    try {
      const { snapshot } = await fetchStatusSources(config || {});
      return snapshot;
    } catch (error) {
      sourceError = error;
    }

    try {
      const { snapshot } = await fetchLegacySnapshot(config || {});
      return snapshot;
    } catch (error) {
      const combined = new Error(sourceError ? `${sourceError.message} / legacy: ${error.message}` : error.message);
      combined.details = [...(sourceError?.details || []), { url: 'legacy logs', message: error.message }];
      throw combined;
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(tick, pollMs());
  }

  async function tick() {
    if (stopped) return;
    if (document.hidden) {
      // 隐藏时暂停轮询；visibilitychange 回到前台会立即刷新
      schedule();
      return;
    }
    try {
      await refresh();
    } finally {
      schedule();
    }
  }

  async function refresh() {
    if (stopped && started) return latest;
    if (inFlight) return inFlight;

    onPhase?.({ refreshing: true, loading: !latest, error: null });

    inFlight = (async () => {
      try {
        const snapshot = await fetchSnapshot();
        const dashboard = buildDashboard(snapshot, buildOptions());
        const changed = latest === null || dashboard.generatedAtUnix !== lastGeneratedAtUnix;
        lastGeneratedAtUnix = dashboard.generatedAtUnix;
        latest = dashboard;
        if (changed) writeCachedDashboard(dashboard, now()); // 仅数据变化时写缓存，避免每 60s 无谓写 localStorage
        onUpdate?.(dashboard, { changed, cached: false, error: null });
        onPhase?.({ refreshing: false, loading: false, error: null });
        return dashboard;
      } catch (error) {
        const message = '数据加载失败，请检查网络后重试';
        if (latest) {
          latest = applyFreshness(latest, buildOptions());
          latest = { ...latest, warnings: [...(latest.warnings || []).filter((warning) => warning.type !== 'refresh-failed'), { type: 'refresh-failed', message: `刷新失败，显示缓存数据（${latest.lastUpdateText}）` }] };
          onUpdate?.(latest, { changed: false, cached: true, error });
        } else {
          onUpdate?.(null, { changed: false, cached: false, error });
        }
        onPhase?.({ refreshing: false, loading: false, error, message });
        return latest;
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  let lastHidden = typeof document !== 'undefined' ? Boolean(document.hidden) : false;

  function onVisibilityChange() {
    const nowHidden = Boolean(document.hidden);
    const becameVisible = lastHidden && !nowHidden;
    lastHidden = nowHidden;
    if (!becameVisible) return; // 只处理“隐藏 -> 可见”，避免启动阶段无意义的重复刷新
    clearTimeout(timer);
    refresh().finally(schedule);
  }

  function start() {
    if (started) return Promise.resolve(latest);
    started = true;
    stopped = false;
    lastHidden = Boolean(document.hidden);

    // 1) 先用 localStorage 缓存立即渲染（stale-while-revalidate），不等网络
    const cached = readCachedDashboard(now());
    if (cached) {
      latest = applyFreshness(cached, { now: now(), staleAfterMin: DEFAULT_STALE_AFTER_MIN });
      lastGeneratedAtUnix = latest.generatedAtUnix ?? null;
      onUpdate?.(latest, { changed: true, cached: true, error: null });
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    // 2) 配置就绪后后台刷新真实数据
    return loadConfig()
      .then(() => {
        config = getConfig() || {};
        return refresh();
      })
      .finally(schedule);
  }

  function stop() {
    started = false;
    stopped = true;
    clearTimeout(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  async function manualRefresh() {
    clearTimeout(timer);
    const result = await refresh();
    schedule();
    return result;
  }

  return {
    start,
    stop,
    refresh,
    manualRefresh,
    getDashboard: () => latest,
    getPollMs: pollMs,
    getStaleAfterMin: staleAfterMin
  };
}