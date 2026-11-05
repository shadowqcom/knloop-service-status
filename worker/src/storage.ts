import type { AppState, Env, StatusDocument } from './types';
import { createEmptyState } from './aggregate';

export const STATE_KEY = 'state:v1';
export const STATUS_KEY = 'status:v2';

export async function loadState(kv: KVNamespace, retentionDays: number, nowMs: number): Promise<AppState> {
  const stored = (await kv.get(STATE_KEY, 'json')) as AppState | null;
  if (!stored || stored.schema !== 1 || !stored.services) {
    return createEmptyState(retentionDays, nowMs);
  }
  stored.retentionDays = retentionDays;
  stored.usage = stored.usage ?? { date: '', uapis: 0, xxapi: 0 };
  return stored;
}

export async function saveState(kv: KVNamespace, state: AppState): Promise<void> {
  await kv.put(STATE_KEY, JSON.stringify(state));
}

export async function saveStatus(kv: KVNamespace, document: StatusDocument): Promise<void> {
  await kv.put(STATUS_KEY, JSON.stringify(document));
}

export async function loadStatus(kv: KVNamespace): Promise<StatusDocument | null> {
  return (await kv.get(STATUS_KEY, 'json')) as StatusDocument | null;
}

export type Bindings = Env;
