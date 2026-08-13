import { createServer as createNetServer } from 'node:net';
import { startServer } from './server.mjs';
import { launchChrome } from './cdp.mjs';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const pressKey = (evalJS, key) => evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true, cancelable: true }))`);

export const tyOf = (m) => {
  const r = /matrix\(1, 0, 0, 1, 0, (-?\d+(?:\.\d+)?)\)/.exec(m);
  return r ? parseFloat(r[1]) : null;
};

/** 获取系统当前随机可用空闲端口 */
export function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * 启动一次完整测试会话：本地静态服务 + 无头 Chrome CDP。
 * @param {number} [preferredPort] - 静态服务首选端口（若未指定或占用则自动获取空闲端口）
 */
export async function launchSession(preferredPort) {
  let port = preferredPort;
  if (!port) {
    port = await getFreePort();
  }
  let cdpPort;
  try {
    cdpPort = await getFreePort();
  } catch {
    cdpPort = port + 1;
  }

  let server;
  try {
    server = await startServer(port);
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      port = await getFreePort();
      cdpPort = await getFreePort();
      server = await startServer(port);
    } else {
      throw err;
    }
  }

  const chrome = await launchChrome({ port: cdpPort, url: `http://127.0.0.1:${port}/` });
  const { send } = chrome;
  await send('Page.enable');
  await send('Runtime.enable');

  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };

  // 清空环境（防止跨文件单元测试遗留数据干扰）
  await evalJS('try { localStorage.clear(); sessionStorage.clear(); location.reload(); } catch(e){}');
  await sleep(1200);

  return { server, chrome, send, evalJS };
}

/** 创建一个收集断言结果的测试器，finish() 返回进程退出码 */
export function makeTester() {
  const results = [];
  const pass = (name, cond, detail = '') => {
    results.push({ name, ok: !!cond, detail });
    console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const finish = () => {
    const failed = results.filter(r => !r.ok);
    console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
    if (failed.length) {
      console.log('=== 失败项 ===');
      for (const f of failed) console.log(`  ❌ ${f.name} ${f.detail}`);
    }
    return failed.length ? 1 : 0;
  };
  return { results, pass, finish };
}
