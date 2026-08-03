import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from './cdp.mjs';
import { makeTester, sleep } from './helpers.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = 9444;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// 启动特制测试服务器：提供包含 <iframe> 嵌套起始页的 embed.html
const server = await new Promise((resolve) => {
  const s = createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    if (urlPath === '/embed.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Outer Site</title></head>
        <body>
          <h1>外部恶意/嵌套站点网页</h1>
          <iframe id="targetFrame" src="/index.html" style="width:800px;height:600px;"></iframe>
        </body>
        </html>
      `);
      return;
    }

    const filePath = join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'text/plain', 'Cache-Control': 'no-store' });
      res.end(readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end('404');
    }
  });
  s.listen(PORT, '127.0.0.1', () => resolve(s));
});

const { pass, finish } = makeTester();
console.log('🚀 正在启动无头 Chrome 自动化验证防嵌套（Frame-Busting）脚本...');

const chrome = await launchChrome({ port: PORT + 1, url: `http://127.0.0.1:${PORT}/embed.html` });
const { send } = chrome;
await send('Page.enable');
await send('Runtime.enable');

await sleep(1500);

const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};

const topUrl = await evalJS('window.top.location.href');
pass('外部网页使用 <iframe> 试图嵌套起始页', true, `初始受诱骗 URL=http://127.0.0.1:${PORT}/embed.html`);
pass('防嵌套 JS 触发并成功破局跳出 <iframe>', topUrl && topUrl.includes('/index.html'), `最终顶层窗口 URL=${topUrl}`);

await chrome.close();
await new Promise(r => server.close(r));

process.exit(finish());
