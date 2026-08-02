import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const CHROME_BIN = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launchChrome({ port, url }) {
  const profileDir = process.env.CHROME_PROFILE_DIR || join(tmpdir(), `glass-start-test-${port}-${randomUUID()}`);
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    url,
  ];
  const proc = spawn(CHROME_BIN, args, { stdio: 'ignore' });

  const target = await (async function wait() {
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json`);
        const list = await res.json();
        const page = list.find(t => t.type === 'page' && /^https?:\/\//.test(t.url) && !t.url.includes('chrome://'));
        if (page) return page;
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('Chrome CDP page not found');
  })();

  const ws = new WebSocket(target.webSocketDebuggerUrl);
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

  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  return {
    send,
    close: async () => { ws.close(); proc.kill('SIGTERM'); },
  };
}
