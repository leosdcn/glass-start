import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

const CHROME_BIN = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const activeInstances = new Set();

function cleanupInstance(instance) {
  try {
    if (instance.ws && instance.ws.readyState === WebSocket.OPEN) {
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

export async function launchChrome({ port, url, testMode = true }) {
  const profileDir = process.env.CHROME_PROFILE_DIR || join(process.env.GLASS_TEST_TMPDIR || tmpdir(), `glass-start-test-${port}-${randomUUID()}`);
  const args = [
    '--headless=new',
    '--disable-gpu',
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
      for (let i = 0; i < 100; i++) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/json`);
          const list = await res.json();
          const page = list.find(t => t.type === 'page' && /^https?:\/\//.test(t.url) && !t.url.includes('chrome://'));
          if (page) return page;
        } catch {}
        await new Promise(r => setTimeout(r, 30));
      }
      throw new Error('Chrome CDP page not found');
    })();
  } catch (err) {
    cleanupInstance(instance);
    throw err;
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  instance.ws = ws;
  let id = 0;
  const pending = new Map();

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  const send = (method, params = {}, timeoutMs = 15000) => new Promise((res, rej) => {
    const mid = ++id;
    const timer = setTimeout(() => {
      if (pending.has(mid)) {
        pending.delete(mid);
        rej(new Error(`CDP command ${method} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    pending.set(mid, (result) => {
      clearTimeout(timer);
      res(result);
    });
    try {
      ws.send(JSON.stringify({ id: mid, method, params }));
    } catch (err) {
      clearTimeout(timer);
      pending.delete(mid);
      rej(err);
    }
  });

  if (testMode) {
    await send('Page.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__GLASS_TEST__ = true;' });
    await send('Page.reload');
  }

  return {
    send,
    close: async () => {
      cleanupInstance(instance);
    },
  };
}
