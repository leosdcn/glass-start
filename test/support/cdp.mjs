import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { rmSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';

function findChromeBin() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    'google-chrome',
    'google-chrome-stable',
    'chromium',
  ];
  for (const c of candidates) {
    if (c.startsWith('/')) {
      if (existsSync(c)) return c;
    } else {
      try {
        const check = spawnSync('which', [c], { stdio: 'ignore' });
        if (check.status === 0) return c;
      } catch {}
    }
  }
  return candidates[0];
}

const CHROME_BIN = findChromeBin();

const activeInstances = new Set();

function isRunning(proc) {
  return proc?.pid && proc.exitCode === null && proc.signalCode === null;
}

function cleanupInstance(instance) {
  if (!activeInstances.delete(instance)) return;
  try {
    if (instance.connection) instance.connection.close();
    else if (instance.ws && instance.ws.readyState === WebSocket.OPEN) {
      instance.ws.close();
    }
  } catch {}

  try {
    const proc = instance.proc;
    if (isRunning(proc)) proc.kill('SIGKILL');
  } catch {}

  try {
    if (instance.profileDir) {
      rmSync(instance.profileDir, { recursive: true, force: true, maxRetries: 3 });
    }
  } catch {}
}

async function closeInstance(instance) {
  if (!activeInstances.has(instance)) return;
  const { proc, connection } = instance;
  try {
    if (!isRunning(proc)) return;
    // 让已核对归属的 Chrome 先关闭子进程，再移除配置目录。
    const exited = once(proc, 'exit', { signal: AbortSignal.timeout(2000) }).catch(() => {});
    if (connection) {
      // 关闭本身也可能先断开 CDP，继续等待 Chrome 退出。
      await connection.send('Browser.close', {}, 1000).catch(() => {});
    } else {
      proc.kill();
    }
    await exited;
    if (isRunning(proc)) {
      const killed = once(proc, 'exit', { signal: AbortSignal.timeout(1000) }).catch(() => {});
      proc.kill('SIGKILL');
      await killed;
    }
  } finally {
    cleanupInstance(instance);
  }
}

// 注册退出钩子，清理本进程启动的 Chrome 及其临时目录。
function registerExitHooks() {
  if (globalThis.__CHROME_HOOKS_REGISTERED__) return;
  globalThis.__CHROME_HOOKS_REGISTERED__ = true;

  const cleanupAll = () => {
    for (const inst of [...activeInstances]) {
      cleanupInstance(inst);
    }
  };

  process.on('exit', cleanupAll);
  process.on('SIGINT', () => { cleanupAll(); process.exit(130); });
  process.on('SIGTERM', () => { cleanupAll(); process.exit(143); });
  process.on('uncaughtExceptionMonitor', () => {
    cleanupAll();
  });
}

registerExitHooks();

/** 断线、协议错误和主动关闭均立即结束待决请求并清理计时器。 */
export async function connectCDP(ws, { openTimeoutMs = 15000 } = {}) {
  let id = 0, failure = null;
  const pending = new Map(), listeners = new Map();
  let resolveOpen, rejectOpen;
  const opened = new Promise((resolve, reject) => { resolveOpen = resolve; rejectOpen = reject; });
  const openTimer = setTimeout(() => fail(new Error('CDP connection opening timed out')), openTimeoutMs);
  function fail(error) {
    if (failure) return;
    failure = error;
    clearTimeout(openTimer);
    rejectOpen(error);
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`CDP command ${entry.method} failed: ${error.message}`, { cause:error }));
    }
    pending.clear();
    listeners.clear();
    for (const [name, handler] of Object.entries(handlers)) ws.removeEventListener(name, handler);
    try { ws.close(); } catch {}
  }
  const handlers = {
    open() { clearTimeout(openTimer); resolveOpen(); },
    error() { fail(new Error('CDP connection error')); },
    close(event) { fail(new Error(`CDP connection closed (${event.code || 'unknown'}): ${event.reason || 'no reason'}`)); },
    message(event) {
      let message;
      try { message = JSON.parse(event.data); }
      catch (error) { fail(new Error('CDP received invalid JSON', { cause:error })); return; }
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(`CDP command ${entry.method} failed (${message.error.code}): ${message.error.message}`));
        else entry.resolve(message.result);
      } else {
        for (const listener of listeners.get(message.method) || []) {
          try { listener(message.params); } catch {}
        }
      }
    }
  };
  for (const [name, handler] of Object.entries(handlers)) ws.addEventListener(name, handler);
  if (ws.readyState === WebSocket.OPEN) handlers.open();
  else if (ws.readyState > WebSocket.OPEN) fail(new Error('CDP connection already closed'));
  await opened;
  return {
    send(method, params = {}, timeoutMs = 15000) {
      if (typeof params === 'function') {
        if (failure) throw failure;
        if (!listeners.has(method)) listeners.set(method, new Set());
        listeners.get(method).add(params);
        return () => listeners.get(method)?.delete(params);
      }
      if (!failure && ws.readyState !== WebSocket.OPEN) fail(new Error('CDP connection is not open'));
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const mid = ++id;
        const timer = setTimeout(() => {
          pending.delete(mid);
          reject(new Error(`CDP command ${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(mid, { resolve, reject, timer, method });
        try { ws.send(JSON.stringify({ id:mid, method, params })); }
        catch (error) { fail(new Error('CDP send failed', { cause:error })); }
      });
    },
    close() { fail(new Error('CDP connection closed by client')); }
  };
}

export async function launchChrome({ port, url, testMode = true, disableGPU = true, extraArgs = [] }) {
  const profileParent = process.env.CHROME_PROFILE_DIR || process.env.GLASS_TEST_TMPDIR || tmpdir();
  mkdirSync(profileParent, { recursive: true });
  const profileDir = mkdtempSync(resolve(profileParent, `glass-start-test-${port}-`));
  const profileArg = `--user-data-dir=${profileDir}`;
  const args = [
    '--headless=new',
    ...(disableGPU ? ['--disable-gpu'] : []),
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    // 让 Linux headless 与桌面浏览器一致地声明 hover/pointer 能力，避免倾斜测试被媒体查询提前关闭。
    '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-automation',
    '--window-size=1470,956',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    ...extraArgs,
    profileArg,
    'about:blank',
  ];
  const instance = { proc: null, ws: null, profileDir };
  activeInstances.add(instance);

  try {
    const proc = instance.proc = spawn(CHROME_BIN, args, { stdio: 'ignore' });
    let spawnError;
    proc.once('error', error => { spawnError = error; });
    const target = await (async function wait() {
      for (let i = 0; i < 200; i++) {
        if (spawnError) throw spawnError;
        if (proc.exitCode !== null || proc.signalCode !== null) {
          throw new Error(`Chrome exited before CDP was ready (${proc.signalCode ?? proc.exitCode})`);
        }
        try {
          const res = await fetch(`http://127.0.0.1:${port}/json`);
          const list = await res.json();
          const page = list.find(t => t.type === 'page' && /^https?:\/\//.test(t.url) && !t.url.includes('chrome://')) ||
                       list.find(t => t.type === 'page' && !t.url.includes('chrome://'));
          if (page) return page;
        } catch {}
        await new Promise(r => setTimeout(r, 50));
      }
      throw new Error('Chrome CDP page not found');
    })();
    instance.ws = new WebSocket(target.webSocketDebuggerUrl);
    const connection = await connectCDP(instance.ws);
    const { send } = connection;
    try {
      const { arguments: commandLine } = await send('Browser.getBrowserCommandLine');
      if (!commandLine?.includes(profileArg)) throw new Error('Chrome CDP belongs to another profile');
    } catch (error) {
      connection.close();
      throw error;
    }
    instance.connection = connection;

    await send('Page.enable');
    if (testMode) {
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__GLASS_TEST__ = true; Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['zh-CN'] });` });
    }
    await send('Page.navigate', { url });

    // 首次导航期间执行上下文会被建立；会话就绪后再交给测试。
    const deadline = Date.now() + 10000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const response = await send('Runtime.evaluate', {
          expression: `location.href === ${JSON.stringify(url)} && document.readyState === 'complete'${testMode ? ' && window.__GLASS_TEST__ === true' : ''}`,
          returnByValue: true
        });
        if (response.result?.value === true) { ready = true; break; }
      } catch (error) {
        if (!/Cannot find context|Execution context was destroyed|Inspected target navigated or closed/i.test(error.message)) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    if (!ready) throw new Error('Chrome page did not finish navigation within 10000ms');
    return { send, close: () => closeInstance(instance) };
  } catch (error) {
    await closeInstance(instance);
    throw error;
  }
}
