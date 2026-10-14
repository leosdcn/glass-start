import { createServer as createNetServer } from 'node:net';
import { startServer } from './server.mjs';
import { launchChrome } from './cdp.mjs';
import assert from 'node:assert/strict';

/** CDP 协议错误由 send 报告，页面求值异常统一在此抛出。 */
export const createEvaluator = send => async expression => {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
  return response.result?.value;
};

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const pressKey = (evalJS, key) => evalJS(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true, cancelable: true }))`);

export const tyOf = (m) => {
  const r = /matrix\(1, 0, 0, 1, 0, (-?\d+(?:\.\d+)?)\)/.exec(m);
  return r ? parseFloat(r[1]) : null;
};

/** 响应式状态轮询器：等待表达式求值为真即刻放行，彻底消除盲等 sleep */
export async function waitFor(evalJS, predicateJs, timeout = 3000, interval = 20) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await evalJS(predicateJs);
    if (res) return res;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`Timeout after ${timeout}ms waiting for: ${predicateJs}`);
}

/** 仅导航就绪等待允许上下文替换；其他协议错误和页面异常直接报告。 */
export async function navigateAndWait(send, evalJS, url, predicateJs = 'true', timeout = 10000) {
  const navigation = await send('Page.navigate', { url });
  if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
  let contextError;
  try {
    return await waitFor(async expression => {
      try { return await evalJS(expression); }
      catch (error) {
        if (!/CDP command Runtime.evaluate failed \(-32000\): (?:Cannot find context|Execution context was destroyed|Inspected target navigated or closed)/i.test(error.message)) throw error;
        contextError = error;
        return false;
      }
    }, `location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && (${predicateJs})`, timeout);
  } catch (error) {
    if (contextError && error.message.startsWith('Timeout')) throw new Error(error.message, { cause: contextError });
    throw error;
  }
}

/** 模拟输入框输入事件并触发 input/change 事件 */
export async function typeInput(evalJS, selector, value) {
  return evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, ${JSON.stringify(value)});
    } else {
      el.value = ${JSON.stringify(value)};
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

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
 * @param {number} [preferredPort=0] - 静态服务首选端口（默认 0 使用内核动态分配，杜绝 EADDRINUSE）
 */
export async function launchSession(preferredPort = 0, customRoutes = {}) {
  const server = await startServer(preferredPort, undefined, customRoutes);
  let chrome;
  try {
    const cdpPort = await getFreePort();
    chrome = await launchChrome({ port: cdpPort, url: `http://127.0.0.1:${server.port}/` });
    const { send } = chrome;
    await send('Page.enable');
    await send('Runtime.enable');
    const evalJS = createEvaluator(send);
    await waitFor(evalJS, 'typeof openEditModal === "function" && !!document.querySelector(".bookmark-item")');
    return { server, chrome, send, evalJS, port: server.port, cdpPort };
  } catch (error) {
    try { if (chrome) await chrome.close(); } finally { await server.close(); }
    throw error;
  }
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
