import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  STATUS_DAY_COUNT,
  applyFreshness,
  beijingDateStr,
  buildDashboard,
  buildService,
  computeConsecutiveOkDays,
  computeOverallStatus,
  formatAvgLatencyText,
  formatBeijingDateTime,
  formatRelativeTime,
  formatStatusPoint,
  formatUptime,
  getSelectedDayPoint,
  isStale,
  parseStatusJson,
  parseStatusSnapshot,
  selectHourlyWindow,
  startOfBeijingDayMs
} from '../src/lib/status';
import type { DailyPoint } from '../src/lib/status';

const FIXTURE_TEXT = readFileSync(new URL('../../data/status.json', import.meta.url), 'utf8');
const FIXTURE = JSON.parse(FIXTURE_TEXT);

// 夹具生成时间：2026-11-05T03:12:14+08:00
const FIXTURE_GENERATED_AT = 1793819534 * 1000;
const FRESH_NOW = FIXTURE_GENERATED_AT + 5 * 60 * 1000; // 生成后 5 分钟，未过期
const STALE_NOW = FIXTURE_GENERATED_AT + 46 * 60 * 1000; // 超过 45 分钟
const NOW = Date.parse('2026-11-05T20:50:00+08:00');

function dashboardAt(now: number, text: string = FIXTURE_TEXT) {
  return buildDashboard(parseStatusJson(text), { now, staleAfterMinutes: 45 });
}

describe('解析 status.json', () => {
  it('解析 schema 2 快照与 3 个服务', () => {
    const snapshot = parseStatusJson(FIXTURE_TEXT);
    expect(snapshot.schema).toBe(2);
    expect(snapshot.generatedAtUnix).toBe(1793819534);
    expect(snapshot.retentionDays).toBe(60);
    expect(snapshot.services).toHaveLength(3);
    expect(snapshot.services.map((service) => service.key)).toEqual(['ShadowQ', 'Mojoo', 'Google']);
  });

  it('结构非法时抛出可读错误', () => {
    expect(() => parseStatusJson('not-json')).toThrow(/不是合法 JSON/);
    expect(() => parseStatusJson('{}')).toThrow(/缺少 services 数组/);
    expect(() => parseStatusSnapshot(null)).toThrow(/根节点必须是对象/);
  });

  it('容忍缺失的可选字段并过滤非对象服务', () => {
    const snapshot = parseStatusSnapshot({ services: [{ key: 'A' }, 'bad', null] });
    expect(snapshot.schema).toBe(2);
    expect(snapshot.retentionDays).toBe(60);
    expect(snapshot.generatedAtUnix).toBeNull();
    expect(snapshot.services).toHaveLength(1);
  });
});

describe('60 个日状态块与汇总', () => {
  const dashboard = dashboardAt(NOW);

  it('每个服务固定 60 块，最后一块是北京时间今天', () => {
    expect(dashboard.services).toHaveLength(3);
    for (const service of dashboard.services) {
      expect(service.statusPoints).toHaveLength(STATUS_DAY_COUNT);
    }
    const points = dashboard.services[0].statusPoints;
    expect(points[0].date).toBe('2026-09-07');
    expect(points[59].date).toBe('2026-11-05');
    expect(points[59].status).toBe('success');
    // 相邻日期相差一天（按北京时间 00:00 计算）
    for (let index = 1; index < points.length; index += 1) {
      expect(startOfBeijingDayMs(Date.parse(points[index].date + 'T00:00:00+08:00')) - startOfBeijingDayMs(Date.parse(points[index - 1].date + 'T00:00:00+08:00'))).toBe(86400000);
    }
  });

  it('缺失日期补 nodata，不虚构数据', () => {
    const sparseDaily = [
      ['2026-11-03', 'success', 100, 100, 120, 5, 0],
      ['2026-11-04', 'failure', 0, null, null, 3, 3],
      ['2026-11-05', 'success', 100, 90, 99, 2, 0]
    ];
    const service = buildService({ key: 'X', status: 'failure', daily: sparseDaily }, { now: NOW });
    expect(service.statusPoints).toHaveLength(60);
    expect(service.statusPoints[57].date).toBe('2026-11-03');
    expect(service.statusPoints[58].status).toBe('failure');
    expect(service.statusPoints.filter((point) => point.status === 'nodata')).toHaveLength(57);
    expect(service.statusPoints[59].date).toBe('2026-11-05');
  });

  it('checks 缺失时按 daily 回退计算', () => {
    const sparseDaily = [
      ['2026-11-03', 'success', 100, 100, 120, 5, 0],
      ['2026-11-04', 'failure', 0, null, null, 3, 3],
      ['2026-11-05', 'success', 100, 90, 99, 2, 0]
    ];
    const service = buildService({ key: 'X', daily: sparseDaily }, { now: NOW });
    expect(service.checks.total).toBe(10);
    expect(service.checks.success).toBe(7);
    expect(service.checks.failure).toBe(3);
    expect(service.uptime).toBe(70);
    expect(service.status).toBe('success'); // 无顶层 status 时按最近有数据的一天推导
  });

  it('汇总统计来自 status.json（可用率/延迟/今日故障/连续正常）', () => {
    const summary = dashboard.summary;
    expect(dashboard.overallStatus).toBe('success');
    expect(dashboard.statusText).toBe('所有服务运行正常');
    expect(summary.total).toBe(3);
    expect(summary.success).toBe(3);
    expect(summary.partial).toBe(0);
    expect(summary.failure).toBe(0);
    expect(summary.nodata).toBe(0);
    expect(summary.avgUptime).toBe('98.68');
    expect(summary.avgLatency).toBeGreaterThan(0);
    expect(summary.todayFailures).toBe(0);
    expect(summary.maxConsecutiveDays).toBe(60);
    expect(summary.lastFailureTime).toBe('2026-10-23 23:30');
    expect(dashboard.services[1].avgLatency).toBeGreaterThan(0);
  });

  it('总状态规则与旧页面一致', () => {
    expect(computeOverallStatus([])).toBe('nodata');
    expect(computeOverallStatus(['success', 'success'])).toBe('success');
    expect(computeOverallStatus(['success', 'failure'])).toBe('failure');
    expect(computeOverallStatus(['success', 'partial'])).toBe('partial');
    expect(computeOverallStatus(['nodata', 'nodata'])).toBe('nodata');
    expect(computeOverallStatus(['success', 'nodata'])).toBe('nodata');
  });

  it('空数据 dashboard 不抛错', () => {
    const empty = buildDashboard(parseStatusSnapshot({ schema: 2, services: [] }), { now: NOW });
    expect(empty.services).toHaveLength(0);
    expect(empty.overallStatus).toBe('nodata');
    expect(empty.statusText).toBe('暂无监控数据');
    expect(empty.statusClass).toBe('text-nodata');
    expect(empty.lastUpdateText).toBe('暂无数据');
    expect(empty.warnings).toHaveLength(0);
  });
});

describe('过期判定', () => {
  it('45 分钟阈值', () => {
    const generatedAtUnix = Math.floor(FIXTURE_GENERATED_AT / 1000);
    expect(isStale(generatedAtUnix, FIXTURE_GENERATED_AT + 44 * 60 * 1000, 45)).toBe(false);
    expect(isStale(generatedAtUnix, FIXTURE_GENERATED_AT + 46 * 60 * 1000, 45)).toBe(true);
    expect(isStale(null, NOW, 45)).toBe(false);
  });

  it('过期时只追加 stale 告警，数据照常展示', () => {
    const fresh = dashboardAt(FRESH_NOW);
    expect(fresh.stale).toBe(false);
    expect(fresh.warnings).toHaveLength(0);

    const stale = dashboardAt(STALE_NOW);
    expect(stale.stale).toBe(true);
    expect(stale.warnings).toHaveLength(1);
    expect(stale.warnings[0].type).toBe('stale');
    expect(stale.warnings[0].message).toContain('数据可能延迟');
    expect(stale.services).toHaveLength(3);
    expect(stale.summary.total).toBe(3);
  });

  it('applyFreshness 不重建服务且不重复追加 stale 告警', () => {
    const fresh = dashboardAt(FRESH_NOW);
    const stale = applyFreshness(fresh, { now: STALE_NOW, staleAfterMinutes: 45 });
    expect(stale.services).toBe(fresh.services);
    expect(stale.stale).toBe(true);
    expect(stale.warnings.filter((warning) => warning.type === 'stale')).toHaveLength(1);
    const again = applyFreshness(stale, { now: STALE_NOW + 60000, staleAfterMinutes: 45 });
    expect(again.warnings.filter((warning) => warning.type === 'stale')).toHaveLength(1);
    expect(again.relativeTime).toContain('分钟前');
  });
});

describe('选中日图表数据', () => {
  const dashboard = dashboardAt(NOW);
  const shadowq = dashboard.services[0];

  it('默认窗口为最近 maxHour+1 个整点，缺失小时为 null', () => {
    const payload = selectHourlyWindow(shadowq, null, { now: FRESH_NOW, maxHour: 12 });
    expect(payload.labels).toHaveLength(13);
    expect(payload.labels[0]).toBe('15:00');
    expect(payload.labels[12]).toBe('03:00');
    expect(payload.median[11]).toBe(294); // 02:00 有数据
    expect(payload.median[12]).toBeNull(); // 03:00 尚未聚合
    expect(payload.p95[11]).toBe(294);
    expect(payload.yMax).toBeNull();
  });

  it('选中过去某天时展示 00:00~23:00 全天', () => {
    const day = '2026-11-04';
    const payload = selectHourlyWindow(shadowq, day, { now: NOW, maxHour: 12 });
    expect(payload.labels).toHaveLength(24);
    expect(payload.labels[0]).toBe('00:00');
    expect(payload.labels[23]).toBe('23:00');

    const expected = new Map<number, { median: number | null; p95: number | null }>();
    for (const row of FIXTURE.services[0].hourly) {
      const ms = row[0] * 1000;
      if (beijingDateStr(ms) !== day) continue;
      expected.set(new Date(ms + 8 * 3600 * 1000).getUTCHours(), { median: row[1], p95: row[2] });
    }
    // 夹具每小时最多一条数据（采集频率约 5-7 次/天），只校验映射与缺口补 null
    let expectedWithData = 0;
    payload.labels.forEach((label, hour) => {
      const item = expected.get(hour);
      if (item && item.median !== null) expectedWithData += 1;
      expect(payload.median[hour]).toBe(item ? item.median : null);
      expect(payload.p95[hour]).toBe(item ? item.p95 : null);
    });
    expect(expectedWithData).toBeGreaterThan(0);
    expect(payload.median.filter((value) => value !== null)).toHaveLength(expectedWithData);
    expect(payload.yMax).toBeNull();
  });

  it('选中今天时只到当前整点', () => {
    const mojoo = dashboard.services[1];
    const payload = selectHourlyWindow(mojoo, '2026-11-05', { now: NOW, maxHour: 12 });
    expect(payload.labels).toHaveLength(21); // 00:00 ~ 20:00
    expect(payload.labels[20]).toBe('20:00');
    expect(payload.median[2]).toBe(986); // 02:00 有数据
    expect(payload.median[3]).toBeNull();
    expect(payload.median[20]).toBeNull();
  });

  it('选中日期 -> 最近一天数据块（用于底部文案与图表联动）', () => {
    const point = getSelectedDayPoint(shadowq, '2026-11-04');
    expect(point).not.toBeNull();
    expect(point?.date).toBe('2026-11-04');
    expect(getSelectedDayPoint(shadowq, '2026-01-01')).toBeNull();
    expect(getSelectedDayPoint(shadowq, null)).toBeNull();
  });

  it('非法选中日期与全低延迟数据', () => {
    const invalid = selectHourlyWindow(shadowq, 'not-a-date', { now: NOW, maxHour: 12 });
    expect(invalid.labels).toHaveLength(0);

    const hour = Math.floor(NOW / 3600000) * 3600;
    const low = buildService({ key: 'L', hourly: [[hour, 5, 9]] }, { now: NOW });
    const payload = selectHourlyWindow(low, null, { now: NOW, maxHour: 12 });
    expect(payload.median[12]).toBe(5);
    expect(payload.yMax).toBe(15);
  });
});

describe('相对时间与提示文案', () => {
  it('北京时间与相对时间文案', () => {
    expect(beijingDateStr(Date.parse('2026-11-05T00:30:00+08:00'))).toBe('2026-11-05');
    expect(formatBeijingDateTime(Date.parse('2026-11-05T20:50:00+08:00'))).toBe('2026-11-05 20:50');
    expect(formatBeijingDateTime(null)).toBe('暂无数据');
    expect(formatRelativeTime(NOW - 30 * 1000, NOW)).toBe('刚刚');
    expect(formatRelativeTime(NOW - 5 * 60 * 1000, NOW)).toBe('5 分钟前');
    expect(formatRelativeTime(NOW - 3 * 3600 * 1000, NOW)).toBe('3 小时前');
    expect(formatRelativeTime(NOW - 2 * 86400 * 1000, NOW)).toBe('2 天前');
    expect(formatRelativeTime(NOW + 1000, NOW)).toBe('刚刚');
    expect(formatRelativeTime(null, NOW)).toBe('');
  });

  it('状态块悬浮文案与卡片延迟文案', () => {
    const point: DailyPoint = {
      date: '2026-11-05',
      status: 'partial',
      uptimePct: 83.3,
      p50: 216,
      p95: 260,
      checks: 24,
      failures: 4
    };
    expect(formatStatusPoint(point)).toBe('2026-11-05 · 异常 · P50 216ms · P95 260ms · 24 次检查 · 4 次失败');
    expect(formatStatusPoint(null)).toBe('');

    const dashboard = dashboardAt(NOW);
    const service = dashboard.services[0];
    expect(formatAvgLatencyText(service, null)).toContain('24小时内平均延迟');
    expect(formatAvgLatencyText(service, '2026-11-04')).toContain('当日 P50 延迟');
    const noLatency = buildService({ key: 'N', status: 'nodata' }, { now: NOW });
    expect(formatAvgLatencyText(noLatency, null)).toBe('24小时内暂无延迟数据');
    expect(formatUptime(noLatency)).toBe('--');
    expect(formatUptime(service)).toBe('100.00');
  });

  it('连续正常天数：nodata 跳过、异常中断', () => {
    const points: DailyPoint[] = [
      { date: '2026-11-01', status: 'success', uptimePct: 100, p50: null, p95: null, checks: 1, failures: 0 },
      { date: '2026-11-02', status: 'partial', uptimePct: 50, p50: null, p95: null, checks: 1, failures: 1 },
      { date: '2026-11-03', status: 'nodata', uptimePct: null, p50: null, p95: null, checks: 0, failures: 0 },
      { date: '2026-11-04', status: 'success', uptimePct: 100, p50: null, p95: null, checks: 1, failures: 0 },
      { date: '2026-11-05', status: 'success', uptimePct: 100, p50: null, p95: null, checks: 1, failures: 0 }
    ];
    expect(computeConsecutiveOkDays(points)).toBe(2);
  });
});
