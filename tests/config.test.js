// 约束测试：src/config.json 必须包含契约 v2 的前端/Go 共用配置键。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deriveRemoteDataUrl } from '../src/js/statusModel.js';

const config = JSON.parse(fs.readFileSync(new URL('../src/config.json', import.meta.url), 'utf8'));

test('config.json：保留旧键 + 新增契约 v2 键', () => {
  // 旧键（Go/旧前端兼容）
  for (const key of ['maxDays', 'maxHour', 'maxLogLines', 'logspath', 'reloadReportsdata', 'reloadReportstime', 'webhook', 'maxRetries', 'retryDelayMs', 'requestTimeoutMs']) {
    assert.ok(key in config, '缺少旧配置键 ' + key);
  }
  assert.equal(config.maxDays, 60);
  assert.equal(config.maxHour, 12);
  assert.equal(config.services.length, 3);

  // 契约 1.1 新增
  assert.equal(config.attempts, 3);
  assert.equal(config.minSuccess, 2);
  assert.deepEqual(config.peerCheck, { enabled: true, timeoutMs: 5000 });
  assert.equal(config.retentionDays, 60);
  assert.match(config.userAgent, /knloop-status\/2\.0/);

  // 契约 3.1 前端轮询/新鲜度
  assert.equal(config.pollIntervalSec, 60);
  assert.equal(config.staleAfterMin, 45);
  assert.match(config.dataUrl, /^https:\/\/raw\.githubusercontent\.com\/.+\/page\/data\/status\.json$/);
  assert.equal(deriveRemoteDataUrl(config), config.dataUrl);
  assert.equal(config.webhook.enabled, false);
});
