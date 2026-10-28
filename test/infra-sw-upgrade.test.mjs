import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { startServer } from './support/server.mjs';
import { launchChrome } from './support/cdp.mjs';
import { getFreePort, createEvaluator, waitFor } from './support/helpers.mjs';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
let version = 101, failApp = false, failWallpaper = false, mismatch = false, offline = false;
let wallpaperBodies = 0, wallpaperValidations = 0;
let secondVersion = 105;
const route = (kind) => (req, res) => {
  if (offline) { req.socket.destroy(); return; }
  const routeVersion = req.url.startsWith('/b/') ? secondVersion : version;
  const stamp = `app-core-v${routeVersion}`;
  let body;
  if (kind === 'worker') body = source.replace(/const CORE_CACHE = '[^']+';/, `const CORE_CACHE = '${stamp}';`)
    + "\nself.addEventListener('message', e => e.waitUntil(clients.matchAll({type:'window'}).then(list => e.ports[0].postMessage(list.length))));";
  if (kind === 'html') body = `<!doctype html><html><head><script>window.__GLASS_BUILD_HTML__="${stamp}";</script><script src="./app.js" defer></script></head><body>version ${routeVersion}</body></html>`;
  if (kind === 'app') body = `window.__GLASS_BUILD_APP__="${mismatch ? 'app-core-v999' : stamp}";window.appVersion=${routeVersion};fetch('./wallpapers/bg1.avif').then(r=>r.text()).then(()=>navigator.serviceWorker.register('./sw.js')).then(reg=>window.reg=reg);`;
  if (kind === 'image') body = `image-${routeVersion}-${req.url}`;
  const wallpaper = kind === 'image' && req.url === '/app/wallpapers/bg1.avif';
  const etag = `"wallpaper-${routeVersion}"`;
  if (wallpaper && failWallpaper) { res.writeHead(503); res.end('wallpaper unavailable'); return; }
  if (wallpaper && req.headers['if-none-match'] === etag) {
    wallpaperValidations++;
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.end(); return;
  }
  if (wallpaper) wallpaperBodies++;
  res.writeHead(kind === 'app' && failApp ? 503 : 200, {
    'Content-Type': kind === 'html' ? 'text/html' : kind === 'image' ? 'image/avif' : 'application/javascript',
    'Cache-Control': kind === 'image' ? 'public, max-age=31536000, immutable' : 'no-store',
    ...(wallpaper ? { ETag: etag } : {})
  });
  res.end(body);
};
const server = await startServer(0, undefined, {
  '/app/': route('html'), '/app/index.html': route('html'), '/app/app.js': route('app'),
  '/app/sw.js': route('worker'), '/app/wallpapers/bg1.avif': route('image'),
  '/b/': route('html'), '/b/index.html': route('html'), '/b/app.js': route('app'),
  '/b/sw.js': route('worker'), '/b/wallpapers/bg1.avif': route('image'),
  '/app/icons/test.png': route('image'),
  '/app/icons/offline.png': route('image'),
  '/status.html': '<!doctype html><html><head></head><body>uncontrolled status</body></html>'
});
const origin = `http://127.0.0.1:${server.port}`;
const chrome = await launchChrome({ port: await getFreePort(), url: origin + '/app/' });
const { send } = chrome;
const evalJS = createEvaluator(send);
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
  assert.equal(wallpaperBodies, 1);
  assert.ok(wallpaperValidations >= 1);
  console.log('✅ 已下载壁纸在 SW 首次安装时使用 ETag 条件验证，正文只传输一次');
  await send('Page.reload');
  await waitFor(evalJS, '!!navigator.serviceWorker.controller && window.appVersion === 101 && !!window.reg');
  assert.equal(await evalJS("caches.keys().then(keys => keys.includes('app-favicons-v1'))"), false);
  await evalJS("Promise.all([caches.open('app-images-v2'), caches.open('unrelated-cache'), caches.open('app-favicons-v1').then(cache => cache.put('https://a.favicon.im/custom.test', new Response('custom-icon')))])");
  assert.match(await evalJS("fetch('./icons/test.png').then(r => r.text())"), /image-101/);
  await evalJS("fetch('./icons/offline.png').then(r => r.text())");
  version = 102; failApp = true;
  const failed = await update();
  assert.equal(failed.waiting, false);
  assert.match(failed.app, /appVersion=101/);
  assert.equal(failed.caches.includes('glass-scope-%2Fapp%2F-app-core-v102'), false);
  version = 103; failApp = false; mismatch = true;
  const mixed = await update();
  assert.equal(mixed.waiting, false);
  assert.match(mixed.app, /appVersion=101/);
  assert.equal(mixed.caches.includes('glass-scope-%2Fapp%2F-app-core-v103'), false);
  console.log('✅ 核心资源 503 或 HTML/JS 指纹不一致时拒绝安装，残缺池删除，旧版继续服务');

  version = 1031; mismatch = false; failWallpaper = true;
  const missingWallpaper = await update();
  assert.equal(missingWallpaper.waiting, false);
  assert.equal(missingWallpaper.caches.includes('glass-scope-%2Fapp%2F-app-core-v1031'), false);
  assert.match(missingWallpaper.app, /appVersion=101/);
  failWallpaper = false;
  console.log('✅ 壁纸重验证失败拒绝新版安装，不使用旧 HTTP 图片冒充完整新版');

  version = 104; mismatch = false;
  const waiting = await update();
  assert.equal(waiting.waiting, true);
  assert.match(await evalJS("caches.open('glass-scope-%2Fapp%2F-app-core-v104').then(c=>c.match('./wallpapers/bg1.avif')).then(r=>r.text())"), /image-104/);
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

  await evalJS(`Promise.all([
    caches.open('app-core-v90').then(c=>c.put('/app/index.html',new Response('legacy A'))),
    caches.open('app-core-v91').then(c=>c.put('/b/index.html',new Response('legacy B'))),
    caches.open('app-core-v92').then(c=>Promise.all([c.put('/app/index.html',new Response('A')),c.put('/b/index.html',new Response('B'))])),
    caches.open('app-images-app-core-v90').then(c=>c.put('/app/icons/legacy.png',new Response('legacy image')))
  ])`);
  await send('Page.navigate', { url: origin + '/status.html' });
  await waitFor(evalJS, `(async () => { const r = await navigator.serviceWorker.getRegistration('/app/'); return r?.active?.state === 'activated' && !r.waiting; })()`, 15000);
  const keys = await evalJS('caches.keys()');
  assert.equal(keys.includes('glass-scope-%2Fapp%2F-app-core-v104'), true);
  assert.equal(keys.includes('glass-scope-%2Fapp%2F-app-core-v101'), false);
  assert.equal(keys.includes('app-images-v2'), true); // 空的旧池无法归属，保守保留
  assert.equal(keys.includes('glass-scope-%2Fapp%2F-app-images-app-core-v101'), true);
  assert.equal(keys.includes('glass-scope-%2Fapp%2F-app-images-app-core-v104'), true);
  assert.equal(keys.includes('app-favicons-v1'), true);
  assert.equal(await evalJS("caches.open('app-favicons-v1').then(cache => cache.match('https://a.favicon.im/custom.test')).then(response => response.text())"), 'custom-icon');
  assert.equal(keys.includes('unrelated-cache'), true);
  assert.equal(keys.includes('app-core-v90'),false);
  assert.equal(keys.includes('app-core-v91'),true);
  assert.equal(keys.includes('app-core-v92'),true);
  assert.equal(await evalJS(`caches.open('glass-scope-%2Fapp%2F-app-images-app-core-v101').then(c=>c.match('/app/icons/offline.png')).then(r=>!!r)`),true);
  console.log('✅ GS-07 旧池仅清理归属于本 scope 的资源，其他 scope 和混合池保留');
  await send('Page.navigate', { url: origin + '/app/' });
  await waitFor(evalJS, 'window.appVersion === 104 && !!navigator.serviceWorker.controller');
  assert.match(await evalJS("fetch('./icons/test.png').then(r => r.text())"), /image-104/);
  console.log('✅ 同 URL 图片跨版本获取新内容，旧 HTTP immutable 缓存不覆盖新版');
  // 同源第二实例安装与升级不能回收 A 的缓存。
  secondVersion = 105;
  await send('Page.navigate', {url:origin+'/b/'});
  await waitFor(evalJS, 'window.reg?.active?.state === "activated" && window.appVersion === 105');
  await send('Page.reload');
  await waitFor(evalJS, '!!navigator.serviceWorker.controller && !!window.reg');
  secondVersion = 106;
  await update();
  await waitFor(evalJS,'!!reg.waiting');
  await evalJS(`reg.waiting.postMessage({type:'ACTIVATE_UPDATE'})`);
  await waitFor(evalJS,'!reg.waiting && reg.active?.state === "activated"');
  assert.equal(await evalJS(`caches.keys().then(keys=>keys.includes('glass-scope-%2Fapp%2F-app-core-v104')&&keys.includes('glass-scope-%2Fb%2F-app-core-v106'))`),true);
  await send('Page.navigate',{url:origin+'/app/'});
  await waitFor(evalJS,'window.appVersion === 104 && !!navigator.serviceWorker.controller');
  console.log('✅ GS-07 两个 scope 不同版本安装和更新，各自保留核心缓存');
  await send('Network.enable');
  offline = true;
  await send('Network.emulateNetworkConditions', { offline:true, latency:0, downloadThroughput:0, uploadThroughput:0 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source:'window.__offlineUpgradeProbe = true;' });
  await send('Page.reload');
  await waitFor(evalJS, 'window.__offlineUpgradeProbe && window.appVersion === 104 && !!navigator.serviceWorker.controller');
  assert.match(await evalJS("fetch('./icons/offline.png').then(r => r.text())"), /image-101/);
  console.log('✅ 新版离线首次使用图片可回退上一版缓存');
  offline = false;
  await send('Network.emulateNetworkConditions', {offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  version = 107;
  await evalJS(`caches.open('glass-scope-%2Fapp%2F-app-core-v104').then(cache=>cache.delete('./app.js'))`);
  await send('Page.reload');
  await waitFor(evalJS, `document.querySelector('h1')?.textContent === '本地应用缓存不完整'`);
  assert.equal(await evalJS(`caches.open('glass-scope-%2Fapp%2F-app-core-v104').then(c=>c.match('./app.js')).then(r=>!!r)`), false);
  await evalJS(`document.querySelector('button').click()`);
  await waitFor(evalJS, 'window.appVersion === 107 && !!navigator.serviceWorker.controller',18000).catch(async error=>{console.log(await evalJS(`({text:document.body.textContent,app:window.appVersion,url:location.href})`));throw error});
  assert.equal(await evalJS(`window.__GLASS_BUILD_HTML__ === window.__GLASS_BUILD_APP__ && window.__GLASS_BUILD_APP__ === 'app-core-v107'`),true);
  offline=true;
  await send('Network.emulateNetworkConditions', {offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await send('Page.reload');
  await waitFor(evalJS,'window.appVersion === 107 && !!navigator.serviceWorker.controller');
  assert.equal(await evalJS(`window.__GLASS_BUILD_HTML__===window.__GLASS_BUILD_APP__`),true);
  await send('Page.navigate',{url:origin+'/b/'});
  await waitFor(evalJS,'window.appVersion === 106 && !!navigator.serviceWorker.controller');
  console.log('✅ GS-14 缺失旧脚本不污染旧池，恢复页升级完整新版，两个实例均可离线重载');
  console.log('✅ 最后一个旧客户端退出后新版激活，旧核心池清理，新版断网重载可用');
} finally {
  await chrome.close();
  await server.close();
}


// 重叠 scope 的历史缓存归属：根部署不能迁移或删除子部署的无前缀旧池。
for (const scopePath of ['/', '/app/']) {
  const scope = 'https://legacy.example.test' + scopePath;
  const owned = new URL('./index.html',scope).href;
  const child = new URL('./child/index.html',scope).href;
  const stores = new Map([
    ['app-core-v1',new Map([[owned,new Response('own')]])],
    ['app-core-v2',new Map([[child,new Response('child')]])],
    ['app-core-v3',new Map([[owned,new Response('own')],[child,new Response('child')]])],
    ['app-images-app-core-v1',new Map([[new URL('./icons/own.png',scope).href,new Response('own image')]])],
    ['app-images-app-core-v2',new Map([[new URL('./child/icons/child.png',scope).href,new Response('child image')]])]
  ]);
  const context = {URL, self:{registration:{scope},addEventListener(){}},caches:{
    keys:async()=>[...stores.keys()],delete:async key=>stores.delete(key),
    open:async key=>{
      if(!stores.has(key))stores.set(key,new Map());
      const entries=stores.get(key);
      return {keys:async()=>[...entries.keys()].map(url=>({url})),
        match:async request=>entries.get(request.url)?.clone(),put:async(request,response)=>entries.set(request.url,response)};
    }
  }};
  vm.runInNewContext(source+';globalThis.migrateLegacy=migrateLegacyImages',context);
  await context.migrateLegacy();
  assert.equal(stores.has('app-core-v1'),false);
  for(const key of ['app-core-v2','app-core-v3','app-images-app-core-v2'])assert.equal(stores.has(key),true);
  assert.equal(stores.has('app-images-app-core-v1'),false);
  assert.equal(stores.has('glass-scope-'+encodeURIComponent(scopePath)+'-app-images-app-core-v1'),true);
}
console.log('✅ 根与嵌套部署迁移历史缓存时，保留子部署及混合池');
