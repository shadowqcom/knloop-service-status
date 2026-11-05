#!/usr/bin/env node
// Chrome headless 截图（CDP）：桌面 1440x1000、移动 390x844、整页，以及过期/错误/空态。
// 为什么不用 chrome --screenshot --window-size=390,844：
//   Windows 上 Chrome 对普通窗口有约 504px 的最小宽度，--window-size=390 会被放大，
//   截图被裁切（实测 innerWidth=504）。这里用 Emulation.setDeviceMetricsOverride 精确模拟 390x844。
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE_URL = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT_DIR = resolve(process.cwd(), 'screenshots');
const userDataDir = await mkdtemp(join(tmpdir(), 'knloop-shots-'));
await mkdir(OUT_DIR, { recursive: true });

let chrome = null;
let socket = null;
let nextId = 1;
const pending = new Map();
const consoleErrors = [];
const seenErrors = new Set();
const results = [];

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
  if (result.exceptionDetails) throw new Error('页面内执行失败: ' + (result.exceptionDetails.text || 'unknown'));
  return result.result.value;
}

async function setViewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: width,
    height: height,
    deviceScaleFactor: 1,
    mobile: mobile
  });
}

async function capture(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buffer = Buffer.from(shot.data, 'base64');
  await writeFile(join(OUT_DIR, name + '.png'), buffer);
  results.push({
    name: name,
    file: join(OUT_DIR, name + '.png'),
    bytes: buffer.length,
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  });
}

async function setMockMode(query) {
  const response = await fetch(BASE_URL.replace(/\/$/, '') + '/__mock' + query);
  if (!response.ok) throw new Error('设置 mock 模式失败: HTTP ' + response.status);
}

try {
  chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
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
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');

  // 1) 桌面 1440x1000
  await setViewport(1440, 1000, false);
  await send('Page.navigate', { url: BASE_URL });
  await delay(5000);
  await capture('desktop');

  // 2) 桌面整页（用于检查顶部汇总卡）
  const desktopMetrics = await send('Page.getLayoutMetrics');
  const desktopHeight = Math.ceil(desktopMetrics.cssContentSize.height);
  await setViewport(1440, desktopHeight, false);
  await delay(1200);
  await capture('desktop-full');

  // 3) 移动 390x844
  await setViewport(390, 844, true);
  await send('Page.reload', { ignoreCache: true });
  await delay(5000);
  await capture('mobile');

  // 4) 移动整页
  const mobileMetrics = await send('Page.getLayoutMetrics');
  const mobileHeight = Math.ceil(mobileMetrics.cssContentSize.height);
  await setViewport(390, mobileHeight, true);
  await delay(1200);
  await capture('mobile-full');

  // 5) 不同数据状态（桌面视口）：首屏 loading / 过期 / 错误 / 空数据
  await setViewport(1440, 1000, false);
  await setMockMode('?delay=5000');
  await evaluate('localStorage.clear()');
  await send('Page.reload', { ignoreCache: true });
  await delay(900);
  await capture('desktop-loading');
  await delay(4500);

  await setMockMode('?stale=120');
  await evaluate('localStorage.clear()');
  await send('Page.reload', { ignoreCache: true });
  await delay(4500);
  await capture('desktop-stale');

  await setMockMode('?error=1');
  await evaluate('localStorage.clear()');
  await send('Page.reload', { ignoreCache: true });
  await delay(3000);
  await capture('desktop-error');

  await setMockMode('?empty=1');
  await evaluate('localStorage.clear()');
  await send('Page.reload', { ignoreCache: true });
  await delay(3000);
  await capture('desktop-empty');

  // 6) 刷新失败但已有数据：保留数据 + 缓存提示（手动刷新）
  await setMockMode('?reset=1');
  await evaluate('localStorage.clear()');
  await send('Page.reload', { ignoreCache: true });
  await delay(4500);
  await setMockMode('?error=1');
  await evaluate("document.querySelector('[data-testid=\"refresh-button\"]').click()");
  await delay(2000);
  await evaluate('window.scrollTo(0, 0)');
  await delay(500);
  await capture('desktop-refresh-failed');
  await setMockMode('?reset=1');

  console.log(JSON.stringify({ screenshots: results, consoleErrors: consoleErrors }, null, 2));
  if (consoleErrors.length > 0) process.exitCode = 1;
} catch (error) {
  console.error('[capture] 失败:', error && error.stack ? error.stack : error);
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
