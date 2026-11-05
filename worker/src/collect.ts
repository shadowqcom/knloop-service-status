import { applyOutcome, buildStatusDocument, createEmptyState, ensureServiceState, resetUsageIfNeeded } from './aggregate';
import { config } from './config';
import { probeService } from './probe';
import { loadState, saveState, saveStatus } from './storage';
import type { AppState, Env, ProbeOutcome, ServiceConfig, StatusDocument } from './types';
import { cstIso, errorText } from './util';

type FetchLike = typeof fetch;

export interface CollectionDeps {
  fetchImpl?: FetchLike;
  nowMs?: number;
}

export async function runCollection(env: Env, deps: CollectionDeps = {}): Promise<StatusDocument> {
  const nowMs = deps.nowMs ?? Date.now();
  const retentionDays = Number.parseInt(env.STATUS_RETENTION_DAYS ?? '', 10) || config.retentionDays;
  const state = await loadState(env.STATUS_KV, retentionDays, nowMs);
  resetUsageIfNeeded(state, nowMs);

  const services = config.services;
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

  await saveState(env.STATUS_KV, state);
  await saveStatus(env.STATUS_KV, document);
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
