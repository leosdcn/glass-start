/** 实际 worker 处理并发图片请求时，未命中的同一资源只下载一次。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { startServer } from './support/server.mjs';
import { launchChrome } from './support/cdp.mjs';
import { getFreePort, createEvaluator, waitFor, navigateAndWait } from './support/helpers.mjs';

const worker = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
const stamp = worker.match(/app-core-v\d+/)[0];
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
const server = await startServer(0, undefined, {
    '/burst/':html, '/burst/index.html':html,
    '/burst/sw.js':(req,res)=>{res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});res.end(worker);},
    '/burst/app.js':(req,res)=>{res.writeHead(200,{'Content-Type':'application/javascript'});res.end(`window.__GLASS_BUILD_APP__="${stamp}";`);},
    '/burst/wallpapers/bg1.avif':(req,res)=>{res.writeHead(200);res.end('wallpaper');},
    '/burst/icons/concurrent.png':image, '/burst/icons/retry.png':image,
    '/burst/icons/variants.png':image, '/burst/icons/cancel.png':image
});
const url = `http://127.0.0.1:${server.port}/burst/`;
const chrome = await launchChrome({port:await getFreePort(),url});
const {send} = chrome;
const evalJS = createEvaluator(send);
const release = () => { for (const resolve of pending.splice(0)) resolve(); };
try {
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
    await chrome.close();
    await server.close();
}

// 执行完整 worker，并控制 CacheStorage 写入时机，覆盖真实浏览器难以稳定制造的写入窗口。
const handlers = new Map(), stores = new Map();
let downloads = 0, releaseCacheWrite, failExternal = false;
const cacheWriteGate = new Promise(resolve=>{releaseCacheWrite=resolve;});
vm.runInNewContext(worker, {
    self:{location:{origin:'https://example.test',href:'https://example.test/sw.js'},
        registration:{scope:'https://example.test/'},addEventListener:(name,fn)=>handlers.set(name,fn)},
    URL, Request, Response, AbortController, setTimeout, clearTimeout,
    fetch:async()=>{downloads++;if(failExternal)throw new Error('offline');return new Response('shared-body');},
    caches:{open:async name=>{
        if(!stores.has(name))stores.set(name,new Map());
        const entries=stores.get(name);
        return {
            match:async request=>entries.get(request.url)?.clone(),
            put:async(request,response)=>{await cacheWriteGate;entries.set(request.url,response);},
            keys:async()=>[...entries.keys()].map(url=>new Request(url))
        };
    }}
});
function dispatch(requestUrl) {
    let response;
    const lifetime=[];
    handlers.get('fetch')({request:new Request(requestUrl),respondWith:task=>{response=task;},waitUntil:task=>lifetime.push(task)});
    return {response,settled:()=>Promise.all(lifetime)};
}
const first = dispatch('https://example.test/icons/gap.png');
assert.equal(await (await first.response).text(),'shared-body');
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
failExternal=true;
for(let i=0;i<2;i++){
    const failed=dispatch('https://a.favicon.im/retry.test');
    assert.equal((await failed.response).status,404);
    await failed.settled();
}
assert.equal(downloads,4);
console.log('✅ 外部图标也共享下载，失败后清理未决任务并允许重试');
