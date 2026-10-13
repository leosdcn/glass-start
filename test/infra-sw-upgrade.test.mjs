import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer } from './server.mjs';
import { launchChrome } from './cdp.mjs';
import { getFreePort, waitFor } from './helpers.mjs';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
let version = 101, failApp = false, mismatch = false, offline = false;
const route = (kind) => (req, res) => {
  if (offline) { req.socket.destroy(); return; }
  const stamp = `app-core-v${version}`;
  let body;
  if (kind === 'worker') body = source.replace(/const CORE_CACHE = '[^']+';/, `const CORE_CACHE = '${stamp}';`)
    .replace(/const CORE_FAVICONS = \[[\s\S]*?\];/, "const CORE_FAVICONS = ['https://127.0.0.1:1/optional'];")
    + "\nself.addEventListener('message', e => e.waitUntil(clients.matchAll({type:'window'}).then(list => e.ports[0].postMessage(list.length))));";
  if (kind === 'html') body = `<!doctype html><html><head><script>window.__GLASS_BUILD_HTML__="${stamp}";</script><script src="./app.js" defer></script></head><body>version ${version}</body></html>`;
  if (kind === 'app') body = `window.__GLASS_BUILD_APP__="${mismatch ? 'app-core-v999' : stamp}";window.appVersion=${version};navigator.serviceWorker.register('./sw.js').then(reg=>window.reg=reg);`;
  if (kind === 'image') body = `image-${version}-${req.url}`;
  res.writeHead(kind === 'app' && failApp ? 503 : 200, {
    'Content-Type': kind === 'html' ? 'text/html' : kind === 'image' ? 'image/avif' : 'application/javascript',
    'Cache-Control': kind === 'image' ? 'public, max-age=31536000, immutable' : 'no-store'
  });
  res.end(body);
};
const server = await startServer(0, undefined, {
  '/app/': route('html'), '/app/index.html': route('html'), '/app/app.js': route('app'),
  '/app/sw.js': route('worker'), '/app/wallpapers/bg1.avif': route('image'),
  '/app/icons/test.png': route('image'),
  '/app/icons/offline.png': route('image'),
  '/status.html': '<!doctype html><html><head></head><body>uncontrolled status</body></html>'
});
const origin = `http://127.0.0.1:${server.port}`;
const chrome = await launchChrome({ port: await getFreePort(), url: origin + '/app/' });
const { send } = chrome;
const evalJS = async expression => {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
  return response.result?.value;
};
const update = async () => evalJS(`(async () => {
  await reg.update();
  const worker = reg.installing;
  if (worker && !['installed','redundant'].includes(worker.state)) await new Promise(resolve => {
    worker.addEventListener('statechange', () => { if (['installed','redundant'].includes(worker.state)) resolve(); });
  });
  return { waiting:!!reg.waiting, controlled:!!navigator.serviceWorker.controller,
    app:await (await fetch('./app.js')).text(), caches:await caches.keys() };
})()`);
try {
  await send('Page.enable');
  await waitFor(evalJS, 'window.reg && reg.active?.state === "activated"', 15000);
  await send('Page.reload');
  await waitFor(evalJS, '!!navigator.serviceWorker.controller && window.appVersion === 101 && !!window.reg');
  await evalJS("Promise.all([caches.open('app-images-v2'), caches.open('unrelated-cache')])");
  assert.match(await evalJS("fetch('./icons/test.png').then(r => r.text())"), /image-101/);
  await evalJS("fetch('./icons/offline.png').then(r => r.text())");
  version = 102; failApp = true;
  const failed = await update();
  assert.equal(failed.waiting, false);
  assert.match(failed.app, /appVersion=101/);
  assert.equal(failed.caches.includes('app-core-v102'), false);
  version = 103; failApp = false; mismatch = true;
  const mixed = await update();
  assert.equal(mixed.waiting, false);
  assert.match(mixed.app, /appVersion=101/);
  assert.equal(mixed.caches.includes('app-core-v103'), false);
  console.log('✅ 核心资源 503 或 HTML/JS 指纹不一致时拒绝安装，残缺池删除，旧版继续服务');

  version = 104; mismatch = false;
  const waiting = await update();
  assert.equal(waiting.waiting, true);
  assert.match(waiting.app, /appVersion=101/);
  const { targetId } = await send('Target.createTarget', { url: origin + '/app/' });
  await waitFor(evalJS, `(async () => {
    const count = await new Promise(resolve => {
      const channel = new MessageChannel(); channel.port1.onmessage = event => resolve(event.data);
      navigator.serviceWorker.controller.postMessage('clients', [channel.port2]);
    });
    return count >= 2 && !!reg.waiting;
  })()`);
  await send('Target.closeTarget', { targetId });
  assert.equal(await evalJS('!!reg.waiting'), true);
  console.log('✅ 完整新版保持 waiting；关闭其他标签时仍有旧页面，控制权保持旧版');

  await send('Page.navigate', { url: origin + '/status.html' });
  await waitFor(evalJS, `(async () => { const r = await navigator.serviceWorker.getRegistration('/app/'); return r?.active?.state === 'activated' && !r.waiting; })()`, 15000);
  const keys = await evalJS('caches.keys()');
  assert.equal(keys.includes('app-core-v104'), true);
  assert.equal(keys.includes('app-core-v101'), false);
  assert.equal(keys.includes('app-images-v2'), false);
  assert.equal(keys.includes('app-images-app-core-v101'), true);
  assert.equal(keys.includes('app-images-app-core-v104'), true);
  assert.equal(keys.includes('app-favicons-v1'), true);
  assert.equal(keys.includes('unrelated-cache'), true);
  await send('Page.navigate', { url: origin + '/app/' });
  await waitFor(evalJS, 'window.appVersion === 104 && !!navigator.serviceWorker.controller');
  assert.match(await evalJS("fetch('./icons/test.png').then(r => r.text())"), /image-104/);
  console.log('✅ 同 URL 图片跨版本获取新内容，旧 HTTP immutable 缓存不覆盖新版');
  await send('Network.enable');
  offline = true;
  await send('Network.emulateNetworkConditions', { offline:true, latency:0, downloadThroughput:0, uploadThroughput:0 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source:'window.__offlineUpgradeProbe = true;' });
  await send('Page.reload');
  await waitFor(evalJS, 'window.__offlineUpgradeProbe && window.appVersion === 104 && !!navigator.serviceWorker.controller');
  assert.match(await evalJS("fetch('./icons/offline.png').then(r => r.text())"), /image-101/);
  console.log('✅ 新版离线首次使用图片可回退上一版缓存');
  console.log('✅ 最后一个旧客户端退出后新版激活，旧核心池清理，新版断网重载可用');
} finally {
  await chrome.close();
  await server.close();
}
