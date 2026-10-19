import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';

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

function cleanupInstance(instance) {
  try {
    if (instance.connection) instance.connection.close();
    else if (instance.ws && instance.ws.readyState === WebSocket.OPEN) {
      instance.ws.close();
    }
  } catch {}

  try {
    if (instance.proc && !instance.proc.killed) {
      try {
        process.kill(instance.proc.pid, 'SIGKILL');
      } catch {}
    }
  } catch {}

  try {
    if (instance.profileDir) {
      rmSync(instance.profileDir, { recursive: true, force: true });
    }
  } catch {}

  activeInstances.delete(instance);
}

// 注册全局生命周期钩子，确保任意异常退出、Ctrl+C 或完成时 100% 自动销毁无头 Chrome 实例与临时目录
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
  process.on('uncaughtException', (err) => {
    console.error('Unhandled Exception in test:', err);
    cleanupAll();
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection in test:', reason);
    cleanupAll();
    process.exit(1);
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

export async function launchChrome({ port, url, testMode = true }) {
  const profileDir = process.env.CHROME_PROFILE_DIR || join(process.env.GLASS_TEST_TMPDIR || tmpdir(), `glass-start-test-${port}-${randomUUID()}`);
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1470,956',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    url,
  ];
  const proc = spawn(CHROME_BIN, args, { stdio: 'ignore' });

  const instance = { proc, ws: null, profileDir };
  activeInstances.add(instance);

  let target;
  try {
    target = await (async function wait() {
      for (let i = 0; i < 200; i++) {
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
  } catch (err) {
    cleanupInstance(instance);
    throw err;
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  instance.ws = ws;
  let connection;
  try { connection = await connectCDP(ws); }
  catch (error) { cleanupInstance(instance); throw error; }
  instance.connection = connection;
  const { send } = connection;

  try {
    if (testMode) {
      await send('Page.enable');
      await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__GLASS_TEST__ = true;' });
      await send('Page.reload');
    }

    // 首次导航和测试模式重载期间执行上下文会被替换；会话就绪后再交给测试。
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
        if (!/Cannot find context|Execution context was destroyed/i.test(error.message)) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    if (!ready) throw new Error('Chrome page did not finish navigation within 10000ms');
  } catch (error) {
    cleanupInstance(instance);
    throw error;
  }

  return {
    send,
    close: async () => {
      cleanupInstance(instance);
    },
  };
}
