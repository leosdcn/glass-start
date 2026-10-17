import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startServer } from './server.mjs';
import { launchChrome, connectCDP } from './cdp.mjs';
import { getFreePort, createEvaluator, waitFor, navigateAndWait } from './helpers.mjs';

const { buildAppJavaScript } = createRequire(import.meta.url)('../scripts/build.js');
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
let version = 201, failApp = false;
const apps = new Map();
const route = kind => (req, res) => {
  const stamp = `app-core-v${version}`;
  let body;
  if (kind === 'html') body = html.replace(/app-core-v\d+/g, stamp);
  if (kind === 'worker') body = worker.replace(/const CORE_CACHE = '[^']+';/, `const CORE_CACHE = '${stamp}';`);
  if (kind === 'app') {
    if (!apps.has(version)) apps.set(version, buildAppJavaScript({ testMode: true, version: stamp }).outputFiles[0].contents);
    body = apps.get(version);
  }
  res.writeHead(kind === 'app' && failApp ? 503 : 200, {
    'Content-Type': kind === 'html' ? 'text/html; charset=utf-8' : 'application/javascript',
    'Cache-Control': 'no-store'
  });
  res.end(body);
};
const server = await startServer(0, undefined, {
  '/': route('html'), '/index.html': route('html'), '/app.js': route('app'), '/sw.js': route('worker')
});
const origin = `http://127.0.0.1:${server.port}`;
const port = await getFreePort();
const chrome = await launchChrome({ port, url: origin + '/' });
const { send } = chrome;
const evalJS = createEvaluator(send);
let other;
const installed = `(async () => { const reg = await navigator.serviceWorker.getRegistration(); return !!reg?.waiting; })()`;
const notice = `!document.getElementById('updateNotice').classList.contains('hidden')`;
const update = async () => {
  await evalJS(`(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg.update();
    const worker = reg.installing;
    if (worker && !['installed', 'redundant'].includes(worker.state)) await new Promise(resolve => {
      worker.addEventListener('statechange', () => { if (['installed', 'redundant'].includes(worker.state)) resolve(); });
    });
  })()`);
};
try {
  await send('Page.enable');
  await waitFor(evalJS, `(async () => { const r = await navigator.serviceWorker.getRegistration(); return r?.active?.state === 'activated'; })()`, 15000);
  assert.equal(await evalJS(notice), false);
  await navigateAndWait(send, evalJS, origin + '/', `!!navigator.serviceWorker.controller && typeof openEditModal === 'function'`);
  assert.equal(await evalJS(notice), false);
  assert.equal(await evalJS(`navigator.serviceWorker.getRegistration().then(r => r.updateViaCache)`), 'none');
  console.log('✅ 首次安装不误报更新；注册绕过 worker HTTP 缓存');

  version = 202; failApp = true;
  await update();
  assert.equal(await evalJS(notice), false);
  assert.equal(await evalJS(installed), false);
  failApp = false;
  console.log('✅ 下载失败不提示新版本、不切换或清除旧缓存');

  version = 201;
  const { targetId } = await send('Target.createTarget', { url: origin + '/' });
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find(t => t.id === targetId);
  other = await connectCDP(new WebSocket(target.webSocketDebuggerUrl));
  await other.send('Page.enable');
  await other.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__GLASS_TEST__ = true;' });
  const otherEval = createEvaluator(other.send);
  // 两个标签都保持旧版本；新版本的完整下载由用户的联网事件触发。
  version = 201;
  await navigateAndWait(other.send, otherEval, origin + '/', `typeof openEditModal === 'function' && !!navigator.serviceWorker.controller`);
  await otherEval(`(async () => { await openEditModal(); document.querySelector('.edit-name').value = '另一标签草稿'; document.querySelector('.edit-name').dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await evalJS(`(async () => { await openEditModal(); document.querySelector('.edit-name').value = '当前草稿'; document.querySelector('.edit-name').dispatchEvent(new Event('input', {bubbles:true})); })()`);
  version = 203;
  await evalJS(`window.dispatchEvent(new Event('online'))`);
  await waitFor(evalJS, `${installed}`, 15000);
  await waitFor(evalJS, notice);
  await waitFor(otherEval, notice);
  assert.equal(await evalJS(`document.getElementById('updateNotice').closest('[inert]') !== null`), true);
  await evalJS(`document.getElementById('updateReloadBtn').click()`);
  assert.equal(await evalJS(`OverlayStack.top().id`), 'editModal');
  assert.equal(await evalJS(`document.querySelector('.edit-name').value`), '当前草稿');
  console.log('✅ 新版就绪仅提示；弹窗焦点隔离保护未保存草稿，后台不刷新');

  await evalJS(`closeEditModal()`);
  await waitFor(evalJS, `document.getElementById('editModal').hidden`);
  mkdirSync(new URL('./artifacts/', import.meta.url), { recursive:true });
  const noticeScreenshot = await send('Page.captureScreenshot', { format:'png' });
  writeFileSync(new URL('./artifacts/sw-update-notice.png', import.meta.url), Buffer.from(noticeScreenshot.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width:320, height:640, deviceScaleFactor:1, mobile:true });
  assert.equal(await evalJS(`(() => { const r = document.getElementById('updateNotice').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`), true);
  await send('Emulation.clearDeviceMetricsOverride');
  await evalJS(`document.getElementById('updateReloadBtn').click()`);
  await waitFor(evalJS, `document.getElementById('confirmTitle').textContent === '新版本已就绪' && OverlayStack.top()?.id === 'confirmModal'`);
  await evalJS(`document.getElementById('confirmCancelBtn').click()`);
  assert.equal(await evalJS(installed), true);
  assert.equal(await evalJS(`window.__GLASS_BUILD_APP__`), 'app-core-v201');
  await evalJS(`document.getElementById('updateReloadBtn').click()`);
  const { data } = await send('Page.captureScreenshot', { format:'png' });
  mkdirSync(new URL('./artifacts/', import.meta.url), { recursive:true });
  writeFileSync(new URL('./artifacts/sw-update-confirm.png', import.meta.url), Buffer.from(data, 'base64'));
  await evalJS(`setTimeout(() => document.getElementById('confirmOkBtn').click(), 50); true`);
  await waitFor(async expression => {
    try { return await evalJS(expression); }
    catch (error) {
      if (!/Cannot find context|Execution context was destroyed|Inspected target navigated or closed/i.test(error.message)) throw error;
      return false;
    }
  }, `window.__GLASS_BUILD_APP__ === 'app-core-v203' && document.readyState === 'complete' && !!document.querySelector('.bookmark-item')`, 15000);
  assert.equal(await evalJS(notice), false);
  assert.equal(await evalJS(`window.__GLASS_BUILD_HTML__ === window.__GLASS_BUILD_APP__`), true);
  assert.equal(await otherEval(`window.__GLASS_BUILD_APP__`), 'app-core-v201');
  assert.equal(await otherEval(`document.querySelector('.edit-name').value`), '另一标签草稿');
  assert.equal(await otherEval(`OverlayStack.top()?.id`), 'editModal');
  console.log('✅ 取消保留旧版；确认后无需关标签或清缓存即升级，HTML/JS 同版；其他标签草稿不被刷新');

  await otherEval(`closeEditModal(); document.getElementById('updateReloadBtn').click(); setTimeout(() => document.getElementById('confirmOkBtn').click(), 50); true`);
  await waitFor(async expression => {
    try { return await otherEval(expression); }
    catch (error) {
      if (!/Cannot find context|Execution context was destroyed|Inspected target navigated or closed/i.test(error.message)) throw error;
      return false;
    }
  }, `window.__GLASS_BUILD_APP__ === 'app-core-v203' && document.readyState === 'complete'`, 15000);
  console.log('✅ 其他标签在新版已经激活后，可各自确认刷新');

  // 等待中的资源被驱逐时，不允许切换到残缺版本；超时后保留旧版并恢复按钮。
  version = 204;
  await update();
  await waitFor(evalJS, installed);
  await evalJS(`caches.open('app-core-v204').then(c => c.delete('./app.js'))`);
  await evalJS(`document.getElementById('updateReloadBtn').click(); document.getElementById('confirmOkBtn').click()`);
  await waitFor(evalJS, `document.getElementById('updateNoticeText').textContent === '更新暂未完成，请重试'`, 18000);
  assert.equal(await evalJS(`document.getElementById('updateReloadBtn').disabled`), false);
  assert.equal(await evalJS(`window.__GLASS_BUILD_APP__`), 'app-core-v203');
  assert.equal(await evalJS(installed), true);
  console.log('✅ 残缺的等待版本拒绝接管；超时恢复重试按钮，当前页面和缓存保持可用');
} finally {
  other?.close();
  await chrome.close();
  await server.close();
}
