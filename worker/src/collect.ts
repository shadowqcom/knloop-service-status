import { applyOutcome, buildStatusDocument, createEmptyState, ensureServiceState, resetUsageIfNeeded } from './aggregate';
import { config } from './config';
import { probeService } from './probe';
import { primeStatusCache } from './status-cache';
import { createStorage } from './storage';
import type { StatusStorage } from './storage';
import type { AppState, Env, ProbeOutcome, ServiceConfig, StatusDocument } from './types';
import { cstIso, errorText } from './util';

type FetchLike = typeof fetch;

export interface CollectionDeps {
  fetchImpl?: FetchLike;
  nowMs?: number;
  /** 测试注入；默认使用 D1 存储层。 */
  storage?: StatusStorage;
}

export async function runCollection(env: Env, deps: CollectionDeps = {}): Promise<StatusDocument> {
  const nowMs = deps.nowMs ?? Date.now();
  const retentionDays = Number.parseInt(env.STATUS_RETENTION_DAYS ?? '', 10) || config.retentionDays;
  const storage = deps.storage ?? createStorage(env);
  const state = await storage.loadState(retentionDays, nowMs);
  resetUsageIfNeeded(state, nowMs);

  const services = config.services;
  // 配置中删除的服务不再保留历史 key，避免页面继续显示旧服务。
  const keepKeys = new Set(services.map((service) => service.key));
  for (const key of Object.keys(state.services)) {
    if (!keepKeys.has(key)) delete state.services[key];
  }
  for (const service of services) ensureServiceState(state, service, nowMs);

  console.log('[collect] start', new Date(nowMs).toISOString(), 'services=' + services.length);

  const outcomes = await Promise.all(
    services.map(async (service): Promise<{ service: ServiceConfig; outcome: ProbeOutcome }> => ({
      service,
      outcome: await safeProbe(service, state, env, deps.fetchImpl, nowMs),
    })),
  );

  for (const { service, outcome } of outcomes) {
    applyOutcome(state, service, outcome, nowMs);
  }

  state.retentionDays = retentionDays;
  state.updatedAt = cstIso(nowMs);
  const document = buildStatusDocument(state, nowMs);

  // 写入失败（例如 D1 日写入额度耗尽）不应让整个 Cron 丢数据/报错：记录后继续；
  // 页面此时只能依赖边缘缓存里的旧数据兜底（最多 6 小时），D1 的读写额度是共享的，写满后读也会失败。
  try {
    await storage.saveAll(state, document);
  } catch (error) {
    console.error('[collect] D1 write failed', error);
  }

  // 采集完立即预热边缘缓存，让 /api/status 拿到本次结果而不是上一次的数据库值。
  await primeStatusCache(document, nowMs);
  return document;
}

async function safeProbe(
  service: ServiceConfig,
  state: AppState,
  env: Env,
  fetchImpl: FetchLike | undefined,
  nowMs: number,
): Promise<ProbeOutcome> {
  try {
    return await probeService(service, config, state.usage, {
      token: env.GLOBALPING_TOKEN,
      fetchImpl,
    });
  } catch (error) {
    return {
      status: 'partial',
      latency: null,
      providers: [{ name: 'internal', ok: false, latencyMs: null, error: errorText(error) }],
    };
  }
}

export async function getEmptyDocument(nowMs: number, retentionDays: number): Promise<StatusDocument> {
  const state = createEmptyState(retentionDays, nowMs);
  return buildStatusDocument(state, nowMs);
}
