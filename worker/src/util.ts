import type { ServiceConfig } from './types';

const CST_OFFSET_MS = 8 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function cstDate(ms: number): string {
  const d = new Date(ms + CST_OFFSET_MS);
  return [d.getUTCFullYear(), pad2(d.getUTCMonth() + 1), pad2(d.getUTCDate())].join('-');
}

export function cstIso(ms: number): string {
  const d = new Date(ms + CST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}+08:00`;
}

export function cstHourStart(ms: number): number {
  return Math.floor(ms / HOUR_MS) * 3600;
}

export function startOfCstDay(ms: number): number {
  return Math.floor((ms + CST_OFFSET_MS) / 86400000) * 86400000 - CST_OFFSET_MS;
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function targetHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

export function targetPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || '/'}${parsed.search || ''}`;
  } catch {
    return '/';
  }
}

export function withTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function truncate(value: string, max = 160): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function groupByService(services: ServiceConfig[]): ServiceConfig[] {
  return services.filter((service) => service.key && service.url);
}
