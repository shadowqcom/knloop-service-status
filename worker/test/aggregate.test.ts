import { describe, expect, it } from 'vitest';
import { applyOutcome, buildStatusDocument, createEmptyState, ensureServiceState } from '../src/aggregate';
import type { ProbeOutcome, ServiceConfig } from '../src/types';

const service: ServiceConfig = { key: 'Example', url: 'https://example.com' };

function outcome(status: ProbeOutcome['status'], latency: number | null): ProbeOutcome {
  return { status, latency, providers: [] };
}

function at(value: string): number {
  return Date.parse(value);
}

describe('aggregate', () => {
  it('builds a 60-day document with today and current hour', () => {
    const now = at('2026-11-05T20:05:00+08:00');
    const state = createEmptyState(60, now);
    ensureServiceState(state, service, now);
    applyOutcome(state, service, outcome('success', 125), now);

    const document = buildStatusDocument(state, now);
    expect(document.schema).toBe(2);
    expect(document.retentionDays).toBe(60);
    expect(document.services).toHaveLength(1);
    const output = document.services[0];
    expect(output.daily).toHaveLength(60);
    expect(output.daily.at(-1)).toEqual(['2026-11-05', 'success', 100, 125, 125, 1, 0]);
    expect(output.hourly).toHaveLength(1);
    expect(output.hourly[0][0]).toBe(Math.floor(at('2026-11-05T20:00:00+08:00') / 1000));
    expect(output.status).toBe('success');
    expect(output.checks.total).toBe(1);
    expect(output.uptime).toBe(100);
  });

  it('rolls over day and hour and computes p50/p95', () => {
    const day1 = at('2026-11-05T20:05:00+08:00');
    const state = createEmptyState(60, day1);
    ensureServiceState(state, service, day1);
    applyOutcome(state, service, outcome('success', 100), day1);
    applyOutcome(state, service, outcome('success', 200), at('2026-11-05T20:15:00+08:00'));
    applyOutcome(state, service, outcome('success', 300), at('2026-11-05T21:15:00+08:00'));
    const day2 = at('2026-11-06T09:00:00+08:00');
    applyOutcome(state, service, outcome('failure', null), day2);

    const document = buildStatusDocument(state, day2);
    const output = document.services[0];
    expect(output.daily).toHaveLength(60);
    const yesterday = output.daily.at(-2)!;
    expect(yesterday[0]).toBe('2026-11-05');
    expect(yesterday[1]).toBe('success');
    expect(yesterday[5]).toBe(3);
    expect(yesterday[3]).toBe(200);
    expect(output.daily.at(-1)![1]).toBe('failure');
    expect(output.status).toBe('failure');
    expect(output.checks.todayFailures).toBe(1);
    expect(output.checks.total).toBe(4);
    expect(output.uptime).toBe(75);
    expect(output.hourly.length).toBeGreaterThanOrEqual(2);
  });

  it('fills missing days with nodata and keeps empty service nodata', () => {
    const now = at('2026-11-05T20:05:00+08:00');
    const state = createEmptyState(60, now);
    ensureServiceState(state, service, now);
    const document = buildStatusDocument(state, now);
    const output = document.services[0];
    expect(output.daily).toHaveLength(60);
    expect(output.daily.every((row) => row[1] === 'nodata')).toBe(true);
    expect(output.checks.total).toBe(0);
  });

  it('counts partial as non-success for uptime but keeps latency', () => {
    const now = at('2026-11-05T12:00:00+08:00');
    const state = createEmptyState(60, now);
    ensureServiceState(state, service, now);
    applyOutcome(state, service, outcome('success', 100), now);
    applyOutcome(state, service, outcome('partial', 200), at('2026-11-05T12:10:00+08:00'));
    applyOutcome(state, service, outcome('partial', 300), at('2026-11-05T12:20:00+08:00'));
    const output = buildStatusDocument(state, now).services[0];
    expect(output.checks.success).toBe(1);
    expect(output.checks.partial).toBe(2);
    expect(output.uptime).toBeCloseTo(33.33, 1);
    expect(output.hourly[0][1]).toBe(200);
  });

  it('marks a partial-only day as partial', () => {
    const now = at('2026-11-05T12:00:00+08:00');
    const state = createEmptyState(60, now);
    ensureServiceState(state, service, now);
    applyOutcome(state, service, outcome('partial', 95), now);
    const output = buildStatusDocument(state, now).services[0];
    expect(output.daily.at(-1)?.[1]).toBe('partial');
    expect(output.checks.partial).toBe(1);
  });
});
