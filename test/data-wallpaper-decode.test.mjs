import assert from 'node:assert/strict';
import { startServer } from './server.mjs';
import { launchChrome } from './cdp.mjs';
import { getFreePort, waitFor } from './helpers.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
const server = await startServer(0, undefined, { '/decode.png': (req, res) => {
  res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png);
} });
const chrome = await launchChrome({ port: await getFreePort(), url: `http://127.0.0.1:${server.port}/` });
const evalJS = async expression => {
  const response = await chrome.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
  return response.result?.value;
};
try {
  await waitFor(evalJS, 'typeof applyWallpaper === "function"');
  const result = await evalJS(`(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
    const pending = new Map();
    const wait = async predicate => {
      const deadline = Date.now() + 3000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error('Decode regression timed out');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const url = tag => location.origin + '/decode.png?' + tag;
    const showing = tag => dom.bgLayer.style.backgroundImage.includes('/decode.png?' + tag);
    try {
      Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable:true, value:function() {
        return new Promise((resolve, reject) => pending.set(this.src, {resolve, reject}));
      } });
      const before = dom.bgLayer.style.backgroundImage;
      applyWallpaper(url('old'), false);
      await wait(() => pending.has(url('old')));
      const waitsForDecode = dom.bgLayer.style.backgroundImage === before;
      applyWallpaper(url('new'), false);
      await wait(() => pending.has(url('new')));
      pending.get(url('new')).resolve();
      await wait(() => showing('new'));
      pending.get(url('old')).resolve();
      await frame();
      const staleIgnored = showing('new');
      applyWallpaper(url('broken'), false);
      await wait(() => pending.has(url('broken')));
      pending.get(url('broken')).reject(new DOMException('Decode failed', 'EncodingError'));
      await frame();
      const failedKeepsCurrent = showing('new');
      delete HTMLImageElement.prototype.decode;
      applyWallpaper(url('fallback'), false);
      await wait(() => showing('fallback'));
      return { waitsForDecode, staleIgnored, failedKeepsCurrent, unsupportedFallback:showing('fallback') };
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, 'decode', descriptor);
    }
  })()`);
  assert.equal(Object.values(result).every(Boolean), true, JSON.stringify(result));
  console.log('✅ 解码完成前保留旧壁纸、迟到解码隔离、失败保留当前图片、无 decode 时回退加载事件');
} finally { await chrome.close(); await server.close(); }
