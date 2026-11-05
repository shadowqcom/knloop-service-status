// 前端 v2 单测：status.json 映射 / legacy 日志解析与聚合 / 状态计算 / 图表窗口 / 新鲜度。
// 运行：node --test tests
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  STATUS_DAY_COUNT,
  aggregateLegacyEntries,
  applyFreshness,
  beijingDateStr,
  buildDashboard,
  buildService,
  computeOverallStatus,
  deriveRemoteDataUrl,
  formatBeijingDateTime,
  formatRelativeTime,
  formatStatusPoint,
  parseLegacyLogText,
  pickFresher,
  selectHourlyWindow
} from '../src/js/statusModel.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
const mixed = fixture('status.mixed.json');
const NOW = mixed.generatedAtUnix * 1000 + 5 * 60 * 1000; // 2026-11-05 02:48 北京时间，gated 固定
const OPTS = { now: NOW, maxDays: 60, maxHour: 12, staleAfterMin: 45 };
const dayRow = (date, status, uptimePct, p50, p95, checks, failures) => [date, status, uptimePct, p50, p95, checks, failures];

test('status.json 映射：固定 60 块、缺失日补 nodata、结束于北京时间今天', () => {
  const dashboard = buildDashboard(mixed, OPTS);
  assert.equal(dashboard.services.length, 3);
  for (const service of dashboard.services) {
    assert.equal(service.statusPoints.length, STATUS_DAY_COUNT);
    assert.equal(service.daily, service.statusPoints);
  }

  const google = dashboard.services[0];
  assert.equal(google.statusPoints[0].date, '2026-09-07'); // 60 天窗口起点（今天 2026-11-05）
  assert.equal(google.statusPoints[59].date, '2026-11-05');
  const byDate = Object.fromEntries(google.statusPoints.map((point) => [point.date, point]));
  assert.equal(byDate['2026-11-01'].status, 'success');
  assert.equal(byDate['2026-11-02'].status, 'partial');
  assert.equal(byDate['2026-11-03'].status, 'nodata');
  assert.equal(byDate['2026-11-04'].status, 'failure');
  assert.equal(byDate['2026-11-05'].status, 'success');
  assert.equal(byDate['2026-09-07'].status, 'nodata'); // 窗口外/无记录 -> 补 nodata
});

test('字段映射：uptime/avgLatency/todayFailures/lastFailureTime/consecutiveOkDays', () => {
  const dashboard = buildDashboard(mixed, OPTS);
  const google = dashboard.services[0];
  assert.equal(google.lastStatus, 'success');
  assert.equal(google.uptime, 76.92); // 契约：按检查次数
  assert.equal(google.avgLatency, 69); // 最近 24h hourly median 均值 (65+68+70+72)/4 = 68.75
  assert.equal(google.todayFailures, 0);
  assert.equal(google.lastFailureTime, '2026-11-01 08:15');
  assert.equal(google.lastFailureAtMs, Date.parse('2026-11-01T08:15:00+08:00'));
  assert.equal(google.consecutiveOkDays, 1); // 今天 success，11-04 failure 打断

  const shadow = dashboard.services[1];
  assert.equal(shadow.avgLatency, null); // 无 24h hourly 数据
  assert.equal(shadow.uptime, 100);
  assert.equal(shadow.consecutiveOkDays, 3);

  const mojoo = dashboard.services[2];
  assert.equal(mojoo.lastStatus, 'nodata');
  assert.equal(mojoo.statusPoints.every((point) => point.status === 'nodata'), true);
});

test('总状态判定：契约 3.2 规则', () => {
  assert.equal(computeOverallStatus(['success', 'success']), 'success');
  assert.equal(computeOverallStatus(['failure', 'success']), 'failure');
  assert.equal(computeOverallStatus(['partial', 'success']), 'partial');
  assert.equal(computeOverallStatus(['nodata', 'nodata']), 'nodata');
  assert.equal(computeOverallStatus([]), 'nodata');
  // 契约未覆盖 success+nodata 混合：不虚构“正常”，按“部分服务暂无数据”展示
  assert.equal(computeOverallStatus(['success', 'nodata']), 'nodata');

  const dashboard = buildDashboard(mixed, OPTS);
  assert.equal(dashboard.overallStatus, 'nodata');
  assert.equal(dashboard.statusText, '部分服务暂无数据');
});

test('nodata 不计入也不打断连续天数；partial/failure 打断', () => {
  const withGap = buildService({
    key: 'Gap',
    status: 'success',
    daily: [
      dayRow('2026-11-02', 'success', 100, 60, 90, 8, 0),
      dayRow('2026-11-03', 'nodata', 0, null, null, 0, 0),
      dayRow('2026-11-04', 'success', 100, 62, 92, 8, 0),
      dayRow('2026-11-05', 'success', 100, 64, 94, 8, 0)
    ]
  }, OPTS);
  assert.equal(withGap.consecutiveOkDays, 3);

  const broken = buildService({
    key: 'Broken',
    status: 'success',
    daily: [
      dayRow('2026-11-03', 'success', 100, 60, 90, 8, 0),
      dayRow('2026-11-04', 'partial', 75, 60, 90, 8, 2),
      dayRow('2026-11-05', 'success', 100, 60, 90, 8, 0)
    ]
  }, OPTS);
  assert.equal(broken.consecutiveOkDays, 1);
});

test('uptime 缺省时按检查次数回退（success/total）', () => {
  const service = buildService({
    key: 'Fallback',
    status: 'success',
    daily: [],
    checks: { success: 99, partial: 0, failure: 1, total: 100, todayTotal: 4, todayFailures: 0 }
  }, OPTS);
  assert.equal(service.uptime, 99);
});

test('legacy 旧 5 行/组：只取前 2 行本地探测，第三方失败行忽略', () => {
  const text = [
    '{"time":"2026-11-05 01:00:00","status":"success","latency":72}',
    '{"time":"2026-11-05 01:00:00","status":"success","latency":80}',
    '{"time":"2026-11-05 01:00:00","status":"failure","latency":1200}',
    '{"time":"2026-11-05 01:00:00","status":"failure","latency":2500}',
    '{"time":"2026-11-05 01:00:00","status":"failure","latency":3000}',
    '{"time":"2026-11-05 02:00:00","status":"success","latency":82}',
    '{"time":"2026-11-05 02:00:00","status":"failure","latency":2400}',
    '{"time":"2026-11-05 02:00:00","status":"failure","latency":2600}',
    '{"time":"2026-11-05 03:00:00","status":"failure","latency":null}',
    '{"time":"2026-11-05 03:00:00","status":"failure","latency":null}',
    '{"time":"2026-11-05 03:00:00","status":"success","latency":60}'
  ].join('\n');

  const entries = parseLegacyLogText(text);
  assert.deepEqual(entries.map((entry) => [entry.status, entry.latency]), [
    ['success', 76], // (72+80)/2，第三方 1200/2500/3000 不参与
    ['partial', 82], // 本地 1 成功 1 失败
    ['failure', null] // 本地 2 失败；末行第三方 success 被忽略
  ]);
});

test('legacy 解析：v2 单行 / 旧单行 / 非法行', () => {
  const text = [
    '{"time":"2026-11-05 04:00:00","status":"success","latency":70,"ok":3,"tries":3}',
    '{"time":"2026-11-05 05:00:00","status":"partial","latency":null,"ok":1,"tries":3}',
    '{"time":"2026-11-05 06:00:00","status":"failure","latency":null}',
    'not-json',
    '{"bad":true}'
  ].join('\n');
  const entries = parseLegacyLogText(text);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((entry) => entry.status), ['success', 'partial', 'failure']);
  assert.equal(parseLegacyLogText('').length, 0);
  assert.equal(parseLegacyLogText(null).length, 0);
});

test('legacy 聚合：daily 规则 / uptime 按检查次数 / hourly（真实旧日志夹具）', () => {
  const text = fs.readFileSync(new URL('./fixtures/logs/Google_report.log', import.meta.url), 'utf8');
  const entries = parseLegacyLogText(text);
  const aggregate = aggregateLegacyEntries(entries, { now: NOW, maxDays: 60 });

  assert.equal(aggregate.checks.total, 12); // 20 组 - 8 条未来时间（> now）被忽略
  assert.deepEqual([aggregate.checks.success, aggregate.checks.partial, aggregate.checks.failure], [9, 2, 1]);
  assert.equal(aggregate.uptime, 75); // 9/12 按检查次数
  assert.equal(aggregate.daily.length, 2);
  assert.deepEqual(aggregate.daily[0].slice(0, 2), ['2026-11-04', 'partial']);
  assert.deepEqual(aggregate.daily[1].slice(0, 2), ['2026-11-05', 'success']);
  assert.equal(aggregate.daily[1][6], 0);
  assert.equal(aggregate.hourly.length, 12);
  assert.ok(aggregate.hourly.every((row) => row.length === 3 && Number.isFinite(row[0])));

  // 契约字面规则：0 失败 -> success（即使只有 partial 成功记录）；0 成功 -> failure
  const partialOnly = parseLegacyLogText('{"time":"2026-11-05 01:30:00","status":"partial","latency":55}');
  assert.equal(aggregateLegacyEntries(partialOnly, { now: NOW }).daily[0][1], 'success');
  const failureOnly = parseLegacyLogText('{"time":"2026-11-05 01:30:00","status":"failure","latency":null}');
  const failureAggregate = aggregateLegacyEntries(failureOnly, { now: NOW });
  assert.equal(failureAggregate.daily[0][1], 'failure');
  assert.equal(failureAggregate.uptime, 0);
});

test('legacy 回退 dashboard：60 块、fallback 告警、不因单源失败空白', () => {
  const text = fs.readFileSync(new URL('./fixtures/logs/ShadowQ_report.log', import.meta.url), 'utf8');
  const entries = parseLegacyLogText(text);
  const aggregate = aggregateLegacyEntries(entries, { now: NOW, maxDays: 60 });
  const dashboard = buildDashboard({
    kind: 'legacy',
    services: [{ key: 'ShadowQ', url: 'https://www.shadowq.com', ...aggregate }],
    generatedAtUnix: aggregate.generatedAtUnix,
    sourceLabel: '日志回退（legacy 解析）',
    warnings: [{ type: 'fallback', message: '实时数据源不可用，已回退到日志解析模式' }]
  }, OPTS);

  assert.equal(dashboard.kind, 'legacy');
  assert.equal(dashboard.services[0].statusPoints.length, 60);
  assert.equal(dashboard.overallStatus, 'success');
  assert.equal(dashboard.services[0].uptime, 100);
  assert.ok(dashboard.warnings.some((warning) => warning.type === 'fallback'));
  assert.equal(dashboard.sourceLabel, '日志回退（legacy 解析）');
});

test('图表窗口：最近 maxHour+1 整点、缺失小时 null、无数据 yMax=15', () => {
  const dashboard = buildDashboard(mixed, OPTS);
  const google = dashboard.services[0];

  const window = selectHourlyWindow(google, null, { now: NOW, maxHour: 12 });
  assert.equal(window.labels.length, 13);
  assert.deepEqual(window.labels, ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '00:00', '01:00', '02:00']);
  assert.equal(window.median[0], null); // 缺失小时保持 x 轴连续
  assert.equal(window.median[8], 68);
  assert.equal(window.median[9], null);
  assert.equal(window.median[10], 70);
  assert.equal(window.median[12], 72);
  assert.equal(window.yMax, null);

  const selected = selectHourlyWindow(google, '2026-11-05', { now: NOW, maxHour: 12 });
  assert.deepEqual(selected.labels, ['00:00', '01:00', '02:00']);
  assert.deepEqual(selected.median, [70, null, 72]);
  assert.deepEqual(selected.p95, [95, null, 101]);

  const empty = selectHourlyWindow(dashboard.services[1], null, { now: NOW, maxHour: 12 });
  assert.equal(empty.labels.length, 13);
  assert.ok(empty.median.every((value) => value === null));
  assert.equal(empty.yMax, 15);
});

test('图表 yMax：峰值 <= 14 时固定 15，超过则自适应', () => {
  const hourMs = Math.floor(NOW / 3600000) * 3600000;
  const low = buildService({
    key: 'Low',
    status: 'success',
    hourly: [[Math.floor(hourMs / 1000), 10, 12]]
  }, OPTS);
  assert.equal(selectHourlyWindow(low, null, { now: NOW, maxHour: 1 }).yMax, 15);

  const high = buildService({
    key: 'High',
    status: 'success',
    hourly: [[Math.floor(hourMs / 1000), 120, 150]]
  }, OPTS);
  assert.equal(selectHourlyWindow(high, null, { now: NOW, maxHour: 1 }).yMax, null);
});

test('远程数据源推导：dataUrl 优先 > logspath > 默认 raw.githubusercontent.com', () => {
  assert.equal(
    deriveRemoteDataUrl({ logspath: 'https://raw.github.knloop.com/knloop-service-status/page/logs' }),
    'https://raw.github.knloop.com/knloop-service-status/page/data/status.json'
  );
  assert.equal(deriveRemoteDataUrl({ dataUrl: 'https://x/y.json', logspath: 'https://a/b/logs' }), 'https://x/y.json');
  assert.equal(deriveRemoteDataUrl({}), 'https://raw.githubusercontent.com/shadowqcom/knloop-service-status/page/data/status.json');
  assert.equal(deriveRemoteDataUrl({ dataUrl: '  ' }), 'https://raw.githubusercontent.com/shadowqcom/knloop-service-status/page/data/status.json');
});

test('pickFresher：选 generatedAtUnix 更大的成功响应', () => {
  const older = { generatedAtUnix: 100 };
  const newer = { generatedAtUnix: 200 };
  assert.equal(pickFresher(null, newer), newer);
  assert.equal(pickFresher(older, null), older);
  assert.equal(pickFresher(newer, older), newer);
  assert.equal(pickFresher(older, newer), newer);
  const tie = { generatedAtUnix: 100 };
  assert.equal(pickFresher(older, tie), older); // 同值优先第一个（同源优先）
  const iso = { generatedAt: '2026-11-05T02:43:28+08:00' };
  assert.equal(pickFresher(iso, { generatedAtUnix: 999 }), iso); // 秒级时间戳更旧 -> 保留 ISO 快照
  assert.equal(pickFresher({ generatedAtUnix: 999 }, iso), iso);
});

test('新鲜度：stale 告警 / 北京时间 + 相对时间 / 不隐藏数据', () => {
  const dashboard = buildDashboard(mixed, OPTS);
  assert.equal(dashboard.stale, false);
  assert.equal(dashboard.lastUpdateText, '2026-11-05 02:43（5 分钟前）');
  assert.deepEqual(dashboard.warnings, []);

  const stale = buildDashboard(mixed, { ...OPTS, now: NOW + 46 * 60000 });
  assert.equal(stale.stale, true);
  assert.ok(stale.warnings.some((warning) => warning.type === 'stale'));
  assert.match(stale.staleText, /数据可能延迟/);
  assert.equal(stale.services.length, dashboard.services.length); // 数据仍在，只是提示

  const refreshed = applyFreshness(dashboard, { now: NOW + 120 * 60000, staleAfterMin: 45 });
  assert.equal(refreshed.stale, true);
  assert.equal(refreshed.services, dashboard.services);
  assert.equal(refreshed.lastUpdateText, '2026-11-05 02:43（2 小时前）');
});

test('相对时间与状态块提示文案', () => {
  const base = NOW;
  assert.equal(formatRelativeTime(base, base), '刚刚');
  assert.equal(formatRelativeTime(base, base + 60000), '1 分钟前');
  assert.equal(formatRelativeTime(base, base + 3600000), '1 小时前');
  assert.equal(formatRelativeTime(base, base + 2 * 86400000), '2 天前');
  assert.equal(formatBeijingDateTime(Date.parse('2026-11-05T02:43:28+08:00')), '2026-11-05 02:43');
  assert.equal(beijingDateStr(Date.parse('2026-11-04T16:00:00Z')), '2026-11-05');
  assert.equal(
    formatStatusPoint({ date: '2026-11-05', status: 'success', p50: 72, p95: 101, checks: 8, failures: 0 }),
    '2026-11-05 · 正常 · P50 72ms · P95 101ms · 8 次检查'
  );
  assert.equal(
    formatStatusPoint({ date: '2026-11-04', status: 'failure', p50: null, p95: null, checks: 8, failures: 8 }),
    '2026-11-04 · 故障 · 8 次检查 · 8 次失败'
  );
});

test('全 success 快照：总状态 success、汇总统计正确', () => {
  const dashboard = buildDashboard(fixture('status.v2.json'), OPTS);
  assert.equal(dashboard.overallStatus, 'success');
  assert.equal(dashboard.summary.total, 3);
  assert.equal(dashboard.summary.success, 3);
  assert.equal(dashboard.summary.failure, 0);
  assert.equal(dashboard.summary.nodata, 0);
  assert.ok(Number.parseFloat(dashboard.summary.avgUptime) > 99);
  assert.ok(dashboard.summary.avgLatency > 0);
  assert.equal(dashboard.services.length, 3);
  assert.ok(dashboard.services.every((service) => service.statusPoints.length === 60));
  assert.equal(dashboard.services[1].avgLatency, null); // Mojoo 无 24h hourly 数据（降级不空白）
  assert.equal(dashboard.warnings.length, 0);
});

test('全 nodata 快照：总状态 nodata、无数据也不空白（服务列表仍在）', () => {
  const dashboard = buildDashboard(fixture('status.nodata.json'), OPTS);
  assert.equal(dashboard.overallStatus, 'nodata');
  assert.equal(dashboard.statusText, '暂无监控数据');
  assert.equal(dashboard.summary.total, 3);
  assert.equal(dashboard.summary.nodata, 3);
  assert.equal(dashboard.services.length, 3);
  assert.ok(dashboard.services.every((service) => service.statusPoints.length === 60));
});