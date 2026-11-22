/** 实际 worker 处理并发图片请求时，未命中的同一资源只下载一次。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { DIST_DIR, startServer } from './support/server.mjs';
import { launchChrome } from './support/cdp.mjs';
import { createEvaluator, waitFor, navigateAndWait } from './support/helpers.mjs';

const worker = readFileSync(join(DIST_DIR, 'sw.js'), 'utf8');
const stamp = readFileSync(join(DIST_DIR, 'index.html'), 'utf8').match(/__GLASS_BUILD_HTML__="([^"]+)"/)[1];
const counts = new Map();
const pending = [];
let status = 200;
const html = `<!doctype html><html><head><script>window.__GLASS_BUILD_HTML__="${stamp}";</script></head><body><script>navigator.serviceWorker.register('./sw.js').then(reg=>window.reg=reg)</script></body></html>`;
const image = (req, res) => {
    counts.set(req.url, (counts.get(req.url) || 0) + 1);
    pending.push(() => {
        res.writeHead(status, { 'Content-Type':'image/png', 'Cache-Control':'no-store' });
        res.end('image-body:' + (req.headers['x-variant'] || 'default'));
    });
};
let server, chrome;
const release = () => { for (const resolve of pending.splice(0)) resolve(); };
try {
    server = await startServer(0, undefined, {
        '/burst/':html, '/burst/index.html':html,
        '/burst/sw.js':(req,res)=>{res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});res.end(worker);},
        ['/burst/app-builds/' + stamp + '.js']:(req,res)=>{res.writeHead(200,{'Content-Type':'application/javascript'});res.end(`window.__GLASS_BUILD_APP__="${stamp}";`);},
        '/burst/wallpapers/bg1.avif':(req,res)=>{res.writeHead(200,{'Content-Type':'image/avif'});res.end('wallpaper');},
        '/burst/icons/concurrent.png':image, '/burst/icons/retry.png':image,
        '/burst/icons/variants.png':image, '/burst/icons/cancel.png':image
    });
    const url = `http://127.0.0.1:${server.port}/burst/`;
    chrome = await launchChrome({url});
    const {send} = chrome;
    const evalJS = createEvaluator(send);
    await waitFor(evalJS, 'window.reg?.active?.state === "activated"', 15000);
    await navigateAndWait(send, evalJS, url, '!!navigator.serviceWorker.controller');
    // 让服务端响应保持未完成，保证所有客户端请求在同一冷缓存窗口内到达。
    await evalJS(`void (window.burst = Promise.all(Array.from({length:4},()=>fetch('./icons/concurrent.png').then(r=>r.text()))))`);
    await waitFor(async()=>counts.get('/burst/icons/concurrent.png') > 0, 'true');
    await new Promise(resolve=>setTimeout(resolve,150));
    console.log('冷缓存并发 4 次请求，实际下载次数:', counts.get('/burst/icons/concurrent.png'));
    release();
    assert.deepEqual(await evalJS('burst'), Array(4).fill('image-body:default'));
    assert.equal(counts.get('/burst/icons/concurrent.png'),1);
    assert.equal(await evalJS("fetch('./icons/concurrent.png').then(r=>r.text())"), 'image-body:default');
    assert.equal(counts.get('/burst/icons/concurrent.png'),1);
    console.log('✅ 并发请求共享下载，各响应正文可独立消费，后续请求命中缓存');

    status = 503;
    await evalJS(`void (window.retryBurst=Promise.all(Array.from({length:4},()=>fetch('./icons/retry.png').then(r=>r.status))))`);
    await waitFor(async()=>counts.get('/burst/icons/retry.png') > 0, 'true');
    await new Promise(resolve=>setTimeout(resolve,100));
    release();
    assert.deepEqual(await evalJS('retryBurst'),[503,503,503,503]);
    assert.equal(counts.get('/burst/icons/retry.png'),1);
    status = 200;
    await evalJS(`void (window.retryResult=fetch('./icons/retry.png').then(r=>r.text()))`);
    await waitFor(async()=>counts.get('/burst/icons/retry.png') === 2, 'true');
    release();
    assert.equal(await evalJS('retryResult'),'image-body:default');
    console.log('✅ 失败响应不进入持久缓存，下一次请求可以重新下载');

    await evalJS(`void (window.variants=Promise.all(['a','b'].map(value=>fetch('./icons/variants.png',{headers:{'X-Variant':value}}).then(r=>r.text()))))`);
    await waitFor(async()=>counts.get('/burst/icons/variants.png') === 2, 'true');
    release();
    assert.deepEqual(await evalJS('variants'),['image-body:a','image-body:b']);
    console.log('✅ 请求头不同的资源不合并，保留各自响应语义');

    await evalJS(`void (window.cancelResults=(() => {
        window.consumerController=new AbortController();
        const first=fetch('./icons/cancel.png',{signal:consumerController.signal}).then(r=>r.text()).catch(error=>error.name);
        const second=fetch('./icons/cancel.png').then(r=>r.text());
        return Promise.all([first,second]);
    })())`);
    await waitFor(async()=>counts.get('/burst/icons/cancel.png') > 0,'true');
    await evalJS('consumerController.abort()');
    release();
    assert.deepEqual(await evalJS('cancelResults'),['AbortError','image-body:default']);
    assert.equal(counts.get('/burst/icons/cancel.png'),1);
    console.log('✅ 单个消费者取消不影响其他消费者共用的下载');
} finally {
    release();
    if (chrome) await chrome.close().catch(() => {});
    if (server) await server.close().catch(() => {});
}

// 执行完整 worker，并控制 CacheStorage 写入时机，覆盖真实浏览器难以稳定制造的写入窗口。
const handlers = new Map(), stores = new Map();
let downloads = 0, releaseCacheWrite, failExternal = false;
const cacheWriteGate = new Promise(resolve=>{releaseCacheWrite=resolve;});
let holdPrune, rejectFaviconWrite;
const coreDownloads = new Map();
let failCoreRepair = false;
const decodedPrefixBytes = [];
const coreScript = `/app-builds/${stamp}.js`;
const cacheUrl = request => new URL(request.url ?? request, 'https://example.test/').href;
vm.runInNewContext(worker, {
    self:{location:{origin:'https://example.test',href:'https://example.test/sw.js'},
        registration:{scope:'https://example.test/'},addEventListener:(name,fn)=>handlers.set(name,fn),
        clients:{get:async id=>({url:new URL(id,'https://example.test/').href})}},
    URL, Request, Response, AbortController, DOMException, setTimeout, clearTimeout,
    TextDecoder: class extends TextDecoder {
        decode(value, options) {
            decodedPrefixBytes.push(value.byteLength);
            return super.decode(value, options);
        }
    },
    fetch:async request=>{
        const path = new URL(request.url).pathname;
        if (path === '/' || path === coreScript) {
            coreDownloads.set(path, (coreDownloads.get(path) ?? 0) + 1);
            if (failCoreRepair) return new Response(null, {status:503});
            return new Response(path === '/' ? html : `window.__GLASS_BUILD_APP__="${stamp}";`);
        }
        downloads++;
        if(failExternal)throw new Error('offline');
        return new Response('shared-body',{headers:{'Content-Type':'image/png'}});
    },
    caches:{ keys:async()=>[...stores.keys()], match:async (request,{cacheName})=>stores.get(cacheName)?.get(cacheUrl(request))?.clone(),open:async name=>{
        if(!stores.has(name))stores.set(name,new Map());
        const entries=stores.get(name);
        return {
            match:async request=>entries.get(cacheUrl(request))?.clone(),
            put:async(request,response)=>{
                await cacheWriteGate;
                if (cacheUrl(request) === rejectFaviconWrite) {
                    rejectFaviconWrite = undefined;
                    throw new DOMException('full', 'QuotaExceededError');
                }
                entries.set(cacheUrl(request),response);
            },
            delete:async request=>entries.delete(cacheUrl(request)),
            keys:async()=>{
                const keys=[...entries.keys()].map(url=>new Request(url));
                if (holdPrune) await holdPrune(keys);
                return keys;
            }
        };
    }}
});
function dispatch(requestUrl, clientId = '/') {
    let response;
    const lifetime=[];
    handlers.get('fetch')({clientId,request:new Request(requestUrl),respondWith:task=>{response=task;},waitUntil:task=>lifetime.push(task)});
    return {response,lifetime,settled:()=>Promise.all(lifetime)};
}
const first = dispatch('https://example.test/icons/gap.png');
assert.equal(await (await first.response).text(),'shared-body');
assert.equal(first.lifetime.length, 1, '同一共享请求只注册一个覆盖缓存写入的生命周期任务');
const duringWrite = dispatch('https://example.test/icons/gap.png');
assert.equal(await (await duringWrite.response).text(),'shared-body');
assert.equal(downloads,1);
releaseCacheWrite();
await Promise.all([first.settled(),duringWrite.settled()]);
console.log('✅ 响应返回后、缓存写入提交前的新请求仍共享原下载');

const externalFirst=dispatch('https://a.favicon.im/shared.test');
const externalSecond=dispatch('https://a.favicon.im/shared.test');
assert.deepEqual(await Promise.all([externalFirst,externalSecond].map(async task=>(await task.response).text())),['shared-body','shared-body']);
assert.equal(downloads,2);
await Promise.all([externalFirst.settled(),externalSecond.settled()]);
assert.equal(await (await dispatch('https://a.favicon.im/shared.test', '/manual.html').response).text(),'shared-body');
assert.equal(downloads,3,'同源手册页面走网络，不读应用的外部图标缓存');
failExternal=true;
for(let i=0;i<2;i++){
    const failed=dispatch('https://a.favicon.im/retry.test');
    assert.equal((await failed.response).status,404);
    await failed.settled();
}
assert.equal(downloads,5);
console.log('✅ 外部图标也共享下载，失败后清理未决任务并允许重试');

failExternal = false;
const images = [...stores.values()].find(cache => cache.has('https://example.test/icons/gap.png'));
for (let i = images.size; i < 200; i++) images.set('https://example.test/icons/seed-' + i + '.png', new Response());
const snapshot = Promise.withResolvers(), resumePrune = Promise.withResolvers();
holdPrune = keys => {
    holdPrune = null;
    snapshot.resolve(keys.length);
    return resumePrune.promise;
};
const firstWrite = dispatch('https://example.test/icons/new-1.png');
assert.equal(await snapshot.promise, 201);
const more = [2, 3, 4].map(i => dispatch('https://example.test/icons/new-' + i + '.png'));
await Promise.all(more.map(task => task.response));
await waitFor(() => images.size === 204, 'all new responses stored');
resumePrune.resolve();
await Promise.all([firstWrite, ...more].map(task => task.settled()));
assert.equal(images.size, 200, '淘汰扫描期间的写入必须触发再次扫描');

const requestCore = () => Promise.all(['/', '/index.html'].map(path => dispatch('https://example.test' + path).response));
failCoreRepair = true;
assert.deepEqual((await requestCore()).map(response => response.status), [503, 503]);
assert.equal(coreDownloads.get('/'), 1, '并发导航共用一次失败的修复');
failCoreRepair = false;
const repaired = await requestCore();
assert.deepEqual(await Promise.all(repaired.map(response => response.text())), [html, html]);
assert.equal(coreDownloads.get('/'), 2, '允许重试且同次修复只下载一份文档');
assert.equal(coreDownloads.get(coreScript), 1, '并发修复只下载一份匹配版本的脚本');
assert.ok(decodedPrefixBytes.length > 0 && decodedPrefixBytes.every(count => count <= 256),
    '修复下载的文档和脚本只校验版本前缀');

const faviconEntries = [...stores.values()].find(cache => cache.has('https://a.favicon.im/shared.test'));
const seedFavicons = () => {
    for (let i = 0; i < 800; i++) faviconEntries.set('https://a.favicon.im/seed-' + i, new Response());
};
seedFavicons();
let activation;
handlers.get('activate')({waitUntil: task => { activation = task; }});
await activation;
assert.equal(faviconEntries.size, 120, '新 Worker 激活时裁剪旧图标池，命中旧缓存也能释放配额');
assert.ok(faviconEntries.has('https://a.favicon.im/seed-799'));

seedFavicons();
const quotaUrl = 'https://a.favicon.im/quota-retry.test';
rejectFaviconWrite = quotaUrl;
const quota = dispatch(quotaUrl);
assert.equal(await (await quota.response).text(), 'shared-body');
await quota.settled();
assert.equal(faviconEntries.size, 120, '配额重试后保留条目上限');
assert.ok(faviconEntries.has(quotaUrl));
assert.equal(faviconEntries.has('https://a.favicon.im/seed-0'), false);

const scriptUrl = 'https://example.test' + coreScript;
const coreCache = [...stores.values()].find(cache => cache.has(scriptUrl));
const prefix = 'window.__GLASS_BUILD_APP__="';
const suffix = stamp + '";';
const tail = '\n//' + 'x'.repeat(150 * 1024);
const encoder = new TextEncoder();
const streamed = chunks => new Response(new ReadableStream({
    start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
    }
}));
coreCache.set(scriptUrl, streamed([prefix, suffix, tail]));
const htmlPrefix = '<!doctype html><head><script>window.__GLASS_BUILD_HTML__="';
const htmlTail = '</script></head><body>' + 'x'.repeat(210 * 1024) + '</body>';
coreCache.set('https://example.test/', streamed([htmlPrefix, suffix, htmlTail]));
decodedPrefixBytes.length = 0;
const documentResponse = await dispatch('https://example.test/').response;
assert.equal(await documentResponse.text(), htmlPrefix + suffix + htmlTail);
const scriptResponse = await dispatch(scriptUrl).response;
assert.equal(scriptResponse.status, 200);
assert.ok(await scriptResponse.text() === prefix + suffix + tail, '返回完整脚本正文');
assert.deepEqual(decodedPrefixBytes, [htmlPrefix.length, suffix.length, prefix.length, suffix.length, prefix.length, suffix.length],
    '文档和脚本均校验跨分块的版本标记，正文保持可流式读取');
assert.equal(coreDownloads.get(coreScript), 1, '正常启动走原缓存');
