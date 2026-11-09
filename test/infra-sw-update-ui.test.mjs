import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { DIST_DIR, startServer } from './support/server.mjs';
import { launchChrome, connectCDP } from './support/cdp.mjs';
import { getFreePort, createEvaluator, waitFor, navigateAndWait } from './support/helpers.mjs';

const { buildAppJavaScript } = createRequire(import.meta.url)('../scripts/build.cjs');
const html = readFileSync(join(DIST_DIR, 'index.html'), 'utf8');
const worker = readFileSync(join(DIST_DIR, 'sw.js'), 'utf8');
const builtVersion = html.match(/__GLASS_BUILD_HTML__="([^"]+)"/)[1];
let version = 201, failApp = false;
let holdApp = false, releaseApp;
const apps = new Map();
const route = kind => (req, res) => {
  const stamp = `app-core-v${version}`;
  let body;
  if (kind === 'html') body = html.replaceAll(builtVersion, stamp);
  if (kind === 'worker') body = worker.replaceAll(builtVersion, stamp);
  if (kind === 'app') {
    if (req.url.split('?')[0] !== '/app-builds/' + stamp + '.js') {
      res.writeHead(404); res.end(); return;
    }
    if (!apps.has(version)) apps.set(version, buildAppJavaScript({ testMode: true, version: stamp }).outputFiles[0].contents);
    body = apps.get(version);
  }
  res.writeHead(kind === 'app' && failApp ? 503 : 200, {
    'Content-Type': kind === 'html' ? 'text/html; charset=utf-8' : 'application/javascript',
    'Cache-Control': 'no-store'
  });
  if (kind === 'app' && holdApp) {
    releaseApp = () => res.end(body);
  } else {
    res.end(body);
  }
};
const siblingResources = {
  '/other/index.html': '<title>Other application</title>',
  '/other/app.js': 'window.otherApplication = true;',
  '/other/manifest.json': '{"name":"Other"}',
  '/other/site.css': 'body { color: green }',
  '/other/icons/logo.png': 'sibling image'
};
const server = await startServer(0, undefined, {
  '/': route('html'), '/index.html': route('html'), '/sw.js': route('worker'),
  ...Object.fromEntries([201, 202, 203, 204, 205, 206, 207, 208].map(id => ['/app-builds/app-core-v' + id + '.js', route('app')])),
  '/manual.html': '<title>Shared origin manual</title>',
  ...siblingResources
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
  for (const [path, body] of Object.entries(siblingResources)) {
    assert.equal(await evalJS(`fetch(${JSON.stringify(path)}).then(r => r.text())`), body);
  }
  assert.equal(await evalJS(`fetch('/index.html?source=probe').then(r => r.text()).then(html => html.includes('app-core-v201'))`), true);
  assert.equal(await evalJS(`fetch('/app-builds/app-core-v201.js').then(r => r.text()).then(js => js.startsWith('window.__GLASS_BUILD_APP__="app-core-v201"'))`), true);
  assert.equal(await evalJS(`caches.open('glass-scope-%2F-app-core-v201').then(c => c.keys()).then(keys => keys.some(r => new URL(r.url).pathname.startsWith('/other/')))`), false);
  console.log('✅ 首次安装不误报更新；注册绕过 worker HTTP 缓存');

  version = 202; failApp = true;
  await update();
  assert.equal(await evalJS(notice), false);
  assert.equal(await evalJS(installed), false);
  failApp = false;
  console.log('✅ 下载失败不提示新版本、不切换或清除旧缓存');

  version = 201;
  const { targetId } = await send('Target.createTarget', { url: origin + '/manual.html' });
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find(t => t.id === targetId);
  other = await connectCDP(new WebSocket(target.webSocketDebuggerUrl));
  await other.send('Page.enable');
  await other.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__GLASS_TEST__ = true;' });
  const otherEval = createEvaluator(other.send);
  await waitFor(otherEval, `document.title === 'Shared origin manual' && !!navigator.serviceWorker.controller`);
  console.log('✅ 根 scope 可控制同源页面，手册导航及兄弟应用资源仍走各自的路由');
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
  assert.equal(await evalJS(`(dom.updateReloadBtn.focus(), dom.editModal.contains(document.activeElement))`), true);
  await evalJS(`document.getElementById('updateReloadBtn').click()`);
  assert.equal(await evalJS(`OverlayStack.top().id`), 'editModal');
  assert.equal(await evalJS(`document.querySelector('.edit-name').value`), '当前草稿');
  console.log('✅ 新版就绪仅提示；弹窗焦点隔离保护未保存草稿，后台不刷新');

  await evalJS(`closeEditModal()`);
  await waitFor(evalJS, `!document.getElementById('editModal').open`);
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

  // 补下载暂时失败时保留旧版；恢复服务后同一个 waiting worker 可重试。
  version = 204;
  await update();
  await waitFor(evalJS, installed);
  await evalJS(`caches.open('glass-scope-%2F-app-core-v204').then(c => c.delete('./app-builds/app-core-v204.js'))`);
  failApp = true;
  await evalJS(`document.getElementById('updateReloadBtn').click(); document.getElementById('confirmOkBtn').click()`);
  await waitFor(evalJS, `document.getElementById('updateNoticeText').textContent === '更新暂未完成，请重试'`,18000);
  assert.equal(await evalJS(`window.__GLASS_BUILD_APP__`),'app-core-v203');
  assert.equal(await evalJS(`document.getElementById('updateReloadBtn').disabled`),false);
  failApp = false;
  await evalJS(`document.getElementById('updateReloadBtn').click(); document.getElementById('confirmOkBtn').click()`);
  await waitFor(evalJS, `window.__GLASS_BUILD_APP__ === 'app-core-v204' && document.readyState === 'complete'`, 18000);
  assert.equal(await evalJS(`caches.open('glass-scope-%2F-app-core-v204').then(c=>c.match('./app-builds/app-core-v204.js')).then(r=>!!r)`), true);
  console.log('✅ 损坏的等待版本补下载、重新校验后完成升级');

  for (const [next, protectedWork] of [[205, 'draft'], [206, 'search']]) {
    const previous = version;
    version = next;
    await update();
    await waitFor(evalJS, installed);
    await evalJS(`caches.open('glass-scope-%2F-app-core-v${next}').then(c => c.delete('./app-builds/app-core-v${next}.js'))`);
    holdApp = true;
    await evalJS(`navigator.serviceWorker.addEventListener('controllerchange', () => { window.testControllerChanged = true; }, { once:true });
      window.testControllerChanged = false; dom.updateReloadBtn.click(); dom.confirmOkBtn.click()`);
    // 暂停补下载，确保用户操作落在确认与接管之间。
    await waitFor(() => Boolean(releaseApp), 'activation repair held');
    if (protectedWork === 'draft') {
      await evalJS(`(async () => {
        await openEditModal();
        const name = dom.editList.querySelector('.edit-name');
        name.value = '接管前新草稿'; name.dispatchEvent(new Event('input', { bubbles:true }));
      })()`);
    } else {
      await evalJS(`dom.searchInput.value = '接管前新搜索'; dom.searchInput.dispatchEvent(new Event('input', { bubbles:true }))`);
    }
    holdApp = false;
    releaseApp();
    releaseApp = null;
    await waitFor(evalJS, `window.testControllerChanged && !dom.updateReloadBtn.disabled`);
    assert.equal(await evalJS('window.__GLASS_BUILD_APP__'), `app-core-v${previous}`);
    assert.equal(await evalJS(notice), true);
    if (protectedWork === 'draft') {
      assert.equal(await evalJS(`state.editOpen && modalState.draftBookmarks[0].name`), '接管前新草稿');
      await evalJS('cancelEditModal()');
    } else {
      assert.equal(await evalJS('dom.searchInput.value'), '接管前新搜索');
      await evalJS('hideSuggestions()');
    }
    await evalJS(`dom.updateReloadBtn.click(); setTimeout(() => dom.confirmOkBtn.click(), 50); true`);
    await waitFor(evalJS, `window.__GLASS_BUILD_APP__ === 'app-core-v${next}' && document.readyState === 'complete'`, 15000);
  }
  console.log('✅ Worker 接管前新增的草稿和搜索输入保留，再次确认后刷新');

  version = 207;
  await update();
  await waitFor(evalJS, installed);
  await evalJS(`(async () => {
    window.firstTarget = (await navigator.serviceWorker.getRegistration()).waiting;
    dom.updateReloadBtn.click();
  })()`);
  version = 208;
  await update();
  await waitFor(evalJS, `navigator.serviceWorker.getRegistration().then(reg => !!reg.waiting && reg.waiting !== window.firstTarget)`);
  await evalJS('dom.confirmOkBtn.click()');
  assert.equal(await evalJS('dom.updateReloadBtn.disabled'), false);
  assert.equal(await evalJS('window.__GLASS_BUILD_APP__'), 'app-core-v206');
  assert.equal(await evalJS(installed), true);
  await evalJS(`dom.updateReloadBtn.click(); setTimeout(() => dom.confirmOkBtn.click(), 50); true`);
  await waitFor(evalJS, `window.__GLASS_BUILD_APP__ === 'app-core-v208' && document.readyState === 'complete'`, 15000);
  assert.match(await evalJS(`fetch('/app-builds/app-core-v206.js').then(r => r.text())`), /__GLASS_BUILD_APP__="app-core-v206"/);
  assert.equal(await evalJS(`caches.has('glass-scope-%2F-app-core-v207')`), false);
  assert.equal(await evalJS(`fetch('/app-builds/app-core-v207.js').then(r => r.status)`), 503);
  console.log('✅ 确认期间替换了 waiting Worker 时，新目标需单独确认');
} finally {
  releaseApp?.();
  other?.close();
  await chrome.close();
  await server.close();
}
