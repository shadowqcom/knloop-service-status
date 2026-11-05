#!/usr/bin/env node
// 用 Chrome DevTools Protocol 校验页面：控制台错误、首屏数据、60 块、图表渲染、移动端溢出。
// 用法：node scripts/verify.mjs http://127.0.0.1:4173/
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TARGET_URL = process.argv[2] || 'http://127.0.0.1:4173/';

function desktopCheck() {
  const canvases = Array.prototype.slice.call(document.querySelectorAll('canvas'));
  let paintedCanvases = 0;
  for (const canvas of canvases) {
    const context = canvas.getContext('2d');
    if (!context || canvas.width === 0 || canvas.height === 0) continue;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) painted += 1;
    }
    if (painted > 500) paintedCanvases += 1;
  }
  const summary = document.querySelector('[data-testid="summary"]');
  return {
    title: document.title,
    cards: document.querySelectorAll('[data-testid="service-card"]').length,
    blocks: document.querySelectorAll('[data-testid="status-block"]').length,
    canvases: canvases.length,
    paintedCanvases: paintedCanvases,
    summaryText: summary ? summary.innerText : null,
    bodyHasUptimeText: document.body.innerText.indexOf('60天内可用率') !== -1,
    skeletonCount: document.querySelectorAll('[data-testid="skeleton"]').length,
    warningCount: document.querySelectorAll('[data-testid="warning"]').length,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    fontFamily: getComputedStyle(document.body).fontFamily
  };
}

function mobileCheck() {
  const scroller = document.querySelector('[data-testid="status-scroll"]');
  return {
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    blocks: document.querySelectorAll('[data-testid="status-block"]').length,
    cards: document.querySelectorAll('[data-testid="service-card"]').length,
    canvases: document.querySelectorAll('canvas').length,
    summary: Boolean(document.querySelector('[data-testid="summary"]')),
    scroller: scroller
      ? { clientWidth: scroller.clientWidth, scrollWidth: scroller.scrollWidth, scrollLeft: Math.round(scroller.scrollLeft) }
      : null
  };
}

const userDataDir = await mkdtemp(join(tmpdir(), 'knloop-verify-'));
let chrome = null;
let socket = null;
let nextId = 1;
const pending = new Map();
const consoleErrors = [];
const seenErrors = new Set();

function addConsoleError(message) {
  if (!message || seenErrors.has(message)) return;
  seenErrors.add(message);
  consoleErrors.push(message);
}

function send(method, params) {
  return new Promise((resolvePromise, rejectPromise) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
    socket.send(JSON.stringify({ id: id, method: method, params: params || {} }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression: expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error('页面内执行失败: ' + (result.exceptionDetails.text || 'unknown'));
  }
  return result.result.value;
}

function check(name, ok, detail) {
  if (ok) return null;
  return detail === undefined ? name : name + ' (' + JSON.stringify(detail) + ')';
}

try {
  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      '--window-size=1440,1000',
      '--user-data-dir=' + userDataDir,
      'about:blank'
    ],
    { stdio: 'ignore' }
  );

  let debugPort = 0;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const text = await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8');
      debugPort = Number(text.split('\n')[0]);
      if (debugPort > 0) break;
    } catch {
      // 等待 Chrome 启动
    }
    await delay(250);
  }
  if (!debugPort) throw new Error('Chrome 未暴露 DevTools 端口');

  const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('未找到 Chrome 页面 target');

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolvePromise, rejectPromise) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', rejectPromise, { once: true });
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      addConsoleError('exception: ' + (details.exception && details.exception.description ? details.exception.description : details.text));
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      const args = message.params.args.map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description || arg.type));
      addConsoleError('console.error: ' + args.join(' '));
    } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      addConsoleError('log.error: ' + message.params.entry.text);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  await send('Page.navigate', { url: TARGET_URL });
  await delay(5000);
  await evaluate('document.fonts.ready.then(function () { return true; })');
  const desktop = await evaluate('(' + desktopCheck.toString() + ')()');

  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await send('Page.reload', { ignoreCache: true });
  await delay(5000);
  const mobile = await evaluate('(' + mobileCheck.toString() + ')()');

  const failures = [];
  const failureList = [
    check('桌面端服务卡数量应为 3', desktop.cards === 3, desktop.cards),
    check('桌面端状态块数量应为 180', desktop.blocks === 180, desktop.blocks),
    check('桌面端图表数量应为 3', desktop.canvases === 3, desktop.canvases),
    check('桌面端图表应全部完成绘制', desktop.paintedCanvases === 3, desktop.paintedCanvases),
    check('桌面端摘要卡应包含总状态文案', Boolean(desktop.summaryText && desktop.summaryText.indexOf('所有服务运行正常') !== -1)),
    check('桌面端摘要卡应包含 60天可用率', Boolean(desktop.summaryText && desktop.summaryText.indexOf('60天可用率') !== -1)),
    check('桌面端首屏应有数据', desktop.bodyHasUptimeText === true),
    check('桌面端不应残留 skeleton', desktop.skeletonCount === 0, desktop.skeletonCount),
    check('桌面端页面不应横向溢出', desktop.scrollWidth <= desktop.innerWidth + 1, { scrollWidth: desktop.scrollWidth, innerWidth: desktop.innerWidth }),
    check('移动端状态块数量应为 180', mobile.blocks === 180, mobile.blocks),
    check('移动端服务卡数量应为 3', mobile.cards === 3, mobile.cards),
    check('移动端图表数量应为 3', mobile.canvases === 3, mobile.canvases),
    check('移动端应有 60 块横向滚动容器', Boolean(mobile.scroller && mobile.scroller.scrollWidth > mobile.scroller.clientWidth), mobile.scroller),
    check('移动端页面不应横向溢出', mobile.scrollWidth <= mobile.innerWidth + 1, { scrollWidth: mobile.scrollWidth, innerWidth: mobile.innerWidth }),
    check('控制台不应有 JS 错误', consoleErrors.length === 0, consoleErrors)
  ];
  for (const item of failureList) {
    if (item) failures.push(item);
  }

  console.log(JSON.stringify({
    url: TARGET_URL,
    desktop: desktop,
    mobile: mobile,
    consoleErrors: consoleErrors,
    failures: failures
  }, null, 2));

  if (failures.length > 0) process.exitCode = 1;
} catch (error) {
  console.error('[verify] 失败:', error && error.stack ? error.stack : error);
  process.exitCode = 1;
} finally {
  try {
    if (socket) socket.close();
  } catch {
    // ignore
  }
  if (chrome && chrome.pid) {
    spawnSync('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  await delay(300);
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}
