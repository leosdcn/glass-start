import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { killChromeProcess, trackChromeProcess } from './chrome-processes.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { rmSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

const { BASE_CHROME_FLAGS } = createRequire(import.meta.url)('../../scripts/chrome-flags.cjs');

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
        const check = spawnSync('which', [c], { stdio: 'ignore', timeout: 2000, killSignal: 'SIGKILL' });
        if (check.status === 0) return c;
      } catch {}
    }
  }
  return candidates[0];
}

const CHROME_BIN = findChromeBin();

/** @typedef {{ send: import('./helpers.mjs').CDPSend, close: (reason?: unknown) => void }} CDPConnection */
/** @typedef {{ proc: import('node:child_process').ChildProcess | null, ws: WebSocket | null, profileDir: string, record?: string, onProcExit?: (code: number | null, signal: NodeJS.Signals | null) => void, connection?: CDPConnection }} ChromeInstance */

/** @type {Set<ChromeInstance>} */
const activeInstances = new Set();

/** @param {import('node:child_process').ChildProcess | null | undefined} proc */
function isRunning(proc) {
  return Boolean(proc?.pid && proc.exitCode === null && proc.signalCode === null);
}

/** @param {string} profileDir */
function findTaggedHelperPids(profileDir) {
  if (process.platform === 'win32') return [];
  let realProfileDir = profileDir;
  try { realProfileDir = realpathSync(profileDir); } catch {}
  /** @type {number[]} */
  const pids = [];
  try {
    const out = execFileSync('ps', ['-axo', 'pid=,stat=,command='], { encoding: 'utf8', timeout: 2000 });
    for (const line of out.split('\n')) {
      const match = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      if (!match) continue;
      const pid = Number(match[1]);
      const [, , stat, cmd] = match;
      if (pid === process.pid || stat.startsWith('Z')) continue;
      if (cmd.includes(profileDir) || (realProfileDir !== profileDir && cmd.includes(realProfileDir))) {
        pids.push(pid);
      }
    }
  } catch {}
  return pids;
}

/** @param {string} profileDir */
function killTaggedHelpers(profileDir) {
  for (const pid of findTaggedHelperPids(profileDir)) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
}

/** @param {ChromeInstance} instance */
function cleanupInstance(instance) {
  if (!activeInstances.delete(instance)) return;
  if (instance.onProcExit && instance.proc) {
    try { instance.proc.removeListener('exit', instance.onProcExit); } catch {}
  }
  try {
    if (instance.connection) instance.connection.close();
    else if (instance.ws && instance.ws.readyState === WebSocket.OPEN) {
      instance.ws.close();
    }
  } catch {}

  try {
    if (instance.proc?.pid && (process.platform !== 'win32' || isRunning(instance.proc))) killChromeProcess(instance.proc.pid);
    killTaggedHelpers(instance.profileDir);
    rmSync(instance.profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    if (instance.record) rmSync(instance.record, { force: true });
  } catch (error) {
    console.error(`无法清理 Chrome 测试会话：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** @param {ChromeInstance} instance */
async function closeInstance(instance) {
  if (!activeInstances.has(instance)) return;
  const { proc, connection, onProcExit } = instance;
  if (onProcExit && proc) {
    try { proc.removeListener('exit', onProcExit); } catch {}
  }
  try {
    if (!proc || !isRunning(proc)) return;
    // 让已核对归属的 Chrome 先关闭子进程，再移除配置目录。
    const exited = once(proc, 'exit', { signal: AbortSignal.timeout(2000) }).catch(() => {});
    if (connection) {
      // 关闭本身也可能先断开 CDP，继续等待 Chrome 退出。
      await connection.send('Browser.close', {}, 1000).catch(() => {});
    } else if (proc.pid) {
      killChromeProcess(proc.pid, 'SIGTERM');
    }
    await exited;
    if (isRunning(proc) && proc.pid) {
      const killed = once(proc, 'exit', { signal: AbortSignal.timeout(1000) }).catch(() => {});
      killChromeProcess(proc.pid);
      await killed;
    }
    if (proc.pid && process.platform !== 'win32') {
      killChromeProcess(proc.pid);
      killTaggedHelpers(instance.profileDir);
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline) {
        let alive = false;
        try { process.kill(-proc.pid, 0); alive = true; } catch {}
        if (!alive && !findTaggedHelperPids(instance.profileDir).length) break;
        await new Promise(r => setTimeout(r, 10));
      }
    }
  } finally {
    cleanupInstance(instance);
  }
}

// 注册退出钩子，清理本进程启动的 Chrome 及其临时目录。
function registerExitHooks() {
  const g = /** @type {{ __CHROME_HOOKS_REGISTERED__?: boolean }} */ (globalThis);
  if (g.__CHROME_HOOKS_REGISTERED__) return;
  g.__CHROME_HOOKS_REGISTERED__ = true;

  const cleanupAll = () => {
    for (const inst of [...activeInstances]) {
      cleanupInstance(inst);
    }
  };

  process.on('exit', cleanupAll);
  process.on('uncaughtExceptionMonitor', () => {
    cleanupAll();
  });
}

registerExitHooks();

/** 断线、协议错误和主动关闭均立即结束待决请求并清理计时器。
 * @param {WebSocket} ws
 * @returns {Promise<CDPConnection>}
 */
export async function connectCDP(ws, { openTimeoutMs = 15000 } = {}) {
  let id = 0;
  /** @type {Error | null} */
  let failure = null;
  /** @type {Map<number, { resolve: (value: any) => void, reject: (reason?: any) => void, timer: ReturnType<typeof setTimeout>, method: string }>} */
  const pending = new Map();
  /** @type {Map<string, Set<(params: any) => void>>} */
  const listeners = new Map();
  /** @type {() => void} */
  let resolveOpen = () => {};
  /** @type {(reason?: any) => void} */
  let rejectOpen = () => {};
  const opened = new Promise((resolve, reject) => { resolveOpen = () => resolve(undefined); rejectOpen = reject; });
  const openTimer = setTimeout(() => fail(new Error('CDP connection opening timed out')), openTimeoutMs);
  /** @param {Error} error */
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
    for (const [name, handler] of Object.entries(handlers)) ws.removeEventListener(name, /** @type {EventListener} */ (handler));
    try { ws.close(); } catch {}
  }
  /** @type {{ open: () => void, error: () => void, close: (event: CloseEvent) => void, message: (event: MessageEvent) => void }} */
  const handlers = {
    open() { clearTimeout(openTimer); resolveOpen(); },
    error() { fail(new Error('CDP connection error')); },
    close(event) { fail(new Error(`CDP connection closed (${event.code || 'unknown'}): ${event.reason || 'no reason'}`)); },
    message(event) {
      let message;
      try { message = JSON.parse(String(event.data)); }
      catch (error) { fail(new Error('CDP received invalid JSON', { cause:error })); return; }
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(`CDP command ${entry.method} failed (${message.error.code}): ${message.error.message}`));
        else entry.resolve(message.result);
      } else {
        for (const listener of listeners.get(message.method) || []) {
          try { listener(message.params); } catch (err) { fail(err instanceof Error ? err : new Error(String(err))); }
        }
      }
    }
  };
  for (const [name, handler] of Object.entries(handlers)) ws.addEventListener(name, /** @type {EventListener} */ (handler));
  if (ws.readyState === WebSocket.OPEN) handlers.open();
  else if (ws.readyState > WebSocket.OPEN) fail(new Error('CDP connection already closed'));
  await opened;
  return {
    send: /** @type {import('./helpers.mjs').CDPSend} */ ((/** @type {string} */ method, /** @type {Record<string, any> | ((params: any) => void)} */ params = {}, /** @type {number} */ timeoutMs = 15000) => {
      if (typeof params === 'function') {
        if (failure) throw failure;
        const listener = /** @type {(params: any) => void} */ (params);
        if (!listeners.has(method)) listeners.set(method, new Set());
        listeners.get(method)?.add(listener);
        return () => { listeners.get(method)?.delete(listener); };
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
    }),
    close(reason) {
      fail(reason instanceof Error ? reason : new Error(String(reason || 'CDP connection closed by client')));
    }
  };
}

/** @param {{ port?: number, url: string, testMode?: boolean, disableGPU?: boolean, extraArgs?: string[] }} options */
export async function launchChrome(options) {
  try {
    return await launchChromeOnce(options);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'CHROME_CDP_STARTUP_TIMEOUT') throw error;
    console.warn((error instanceof Error ? error.message : String(error)) + '\nRetrying Chrome startup with a fresh profile.');
    return launchChromeOnce(options);
  }
}

/** @param {{ port?: number, url: string, testMode?: boolean, disableGPU?: boolean, extraArgs?: string[] }} options */
async function launchChromeOnce({ port = 0, url, testMode = true, disableGPU = true, extraArgs = [] }) {
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
    ...BASE_CHROME_FLAGS,
    '--disable-domain-reliability',
    '--disable-features=Translate,OptimizationHints,MediaRouter',
    '--metrics-recording-only',
    // 让 Linux headless 与桌面浏览器一致地声明 hover/pointer 能力，避免倾斜测试被媒体查询提前关闭。
    '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',
    '--enable-automation',
    '--window-size=1470,956',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    ...extraArgs,
    profileArg,
    'about:blank',
  ];
  /** @type {ChromeInstance} */
  const instance = { proc: null, ws: null, profileDir };
  activeInstances.add(instance);

  try {
    const proc = instance.proc = spawn(CHROME_BIN, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: process.platform !== 'win32',
      env: { ...process.env, BREAKPAD_DUMP_LOCATION: profileDir }
    });
    instance.record = proc.pid ? trackChromeProcess(proc.pid, profileDir) : undefined;
    let stderr = '';
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    /** @type {Error | undefined} */
    let spawnError;
    proc.once('error', error => { spawnError = error; });
    let cdpPort = port;
    const target = await (async function wait() {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (proc.exitCode !== null || proc.signalCode !== null) {
          throw new Error(`Chrome exited before CDP was ready (${proc.signalCode ?? proc.exitCode})`);
        }
        try {
          // 由 Chrome 绑定临时端口，再从当前配置目录发现端口。
          if (!cdpPort) cdpPort = Number.parseInt(readFileSync(join(profileDir, 'DevToolsActivePort'), 'utf8'), 10);
          if (cdpPort) {
            const res = await fetch(`http://127.0.0.1:${cdpPort}/json`, { signal: AbortSignal.timeout(1000) });
            /** @type {Array<{ type: string, url: string, webSocketDebuggerUrl: string }>} */
            const list = await res.json();
            const page = list.find(t => t.type === 'page' && /^https?:\/\//.test(t.url) && !t.url.includes('chrome://')) ||
                         list.find(t => t.type === 'page' && !t.url.includes('chrome://'));
            if (page) return page;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 50));
      }
      const endpoint = cdpPort ? `port ${cdpPort}` : 'no DevToolsActivePort';
      const details = stderr.trim();
      throw Object.assign(new Error(`Chrome CDP page not found within 10000ms (${endpoint})${details ? '\n' + details : ''}`), {
        code: 'CHROME_CDP_STARTUP_TIMEOUT'
      });
    })();
    instance.ws = new WebSocket(target.webSocketDebuggerUrl);
    const connection = await connectCDP(instance.ws);
    /** @param {number | null} code @param {NodeJS.Signals | null} signal */
    const onProcExit = (code, signal) => {
      connection.close(new Error(`Chrome process exited unexpectedly (${signal ?? code ?? 'unknown'})`));
    };
    proc.once('exit', onProcExit);
    instance.onProcExit = onProcExit;
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
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__GLASS_TEST__ = true;
Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['zh-CN'] });
const _origFetch = window.fetch;
window.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('open-meteo.com') || u.includes('ipwho.is') || u.includes('myip.ipip.net')) {
    return new Response(JSON.stringify({ status: 'fail', ret: 'err' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return _origFetch(url, opts);
};`
      });
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
        if (!/Cannot find context|Execution context was destroyed|Inspected target navigated or closed/i.test(error instanceof Error ? error.message : String(error))) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    if (!ready) throw new Error('Chrome page did not finish navigation within 10000ms');
    return { send, cdpPort, pid: instance.proc?.pid, proc: instance.proc, profileDir: instance.profileDir, close: () => closeInstance(instance) };
  } catch (error) {
    await closeInstance(instance);
    throw error;
  }
}
