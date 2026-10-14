import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { buildAppJavaScript } = createRequire(import.meta.url)('../scripts/build.js');

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_ROOT = join(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function startServer(port = 0, root = DEFAULT_ROOT, customRoutes = {}, { testMode = true } = {}) {
  let testApp;
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        let p = normalize(decodeURIComponent(req.url.split('?')[0]));
        if (customRoutes[p]) {
          const handler = customRoutes[p];
          if (typeof handler === 'string') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(handler);
            return;
          }
          return handler(req, res);
        }
        if (p === '/') p = '/index.html';
        const file = join(root, p);
        // 🛡️ 防目录遍历：禁止越过 root 服务任意本地文件（与 scripts/server.js 同等守卫）
        const rel = relative(root, file);
        if (rel.startsWith('..') || isAbsolute(rel)) {
          res.writeHead(403);
          res.end('403');
          return;
        }
        let data = readFileSync(file);
        if (testMode && root === DEFAULT_ROOT && p === '/app.js') {
          if (!testApp) {
            const version = data.toString().match(/window\.__GLASS_BUILD_APP__="([^"]+)";/)?.[1];
            if (!version) throw new Error('Production build fingerprint missing');
            testApp = buildAppJavaScript({ testMode: true, version }).outputFiles[0].contents;
          }
          data = testApp;
        }
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('404');
      }
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      resolve({
        port: actualPort,
        server,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
