import { startServer } from './server.mjs';
import { launchChrome } from './cdp.mjs';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const tyOf = (m) => {
  const r = /matrix\(1, 0, 0, 1, 0, (-?\d+(?:\.\d+)?)\)/.exec(m);
  return r ? parseFloat(r[1]) : null;
};

/**
 * 启动一次完整测试会话：本地静态服务 + 无头 Chrome CDP。
 * @param {number} [port] - 静态服务端口（Chrome 调试端口 +1）
 */
export async function launchSession(port = 9333) {
  const server = await startServer(port);
  const chrome = await launchChrome({ port: port + 1, url: `http://127.0.0.1:${port}/` });
  const { send } = chrome;
  await send('Page.enable');
  await send('Runtime.enable');

  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };

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
