import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function startServer(port, root = DEFAULT_ROOT, customRoutes = {}) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      try {
        let p = normalize(decodeURIComponent(req.url.split('?')[0]));
        if (customRoutes[p]) {
          const handler = customRoutes[p];
          if (typeof handler === 'string') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(handler);
            return;
          }
          return handler(req, res);
        }
        if (p === '/') p = '/index.html';
        const file = join(root, p);
        const data = readFileSync(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('404');
      }
    });
    server.listen(port, '127.0.0.1', () => resolve({
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}
