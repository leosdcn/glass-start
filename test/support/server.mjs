import { createServer } from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { buildAppJavaScript } = createRequire(import.meta.url)('../../scripts/build.cjs');

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const previewServerPath = fileURLToPath(new URL('../../scripts/server.cjs', import.meta.url));
const runTempDir = process.env.GLASS_TEST_TMPDIR;
export const DIST_DIR = runTempDir ? join(runTempDir, 'dist') : join(__dirname, '..', '..', 'dist');
/** @type {{ app: Buffer, version?: string } | undefined} */
let testSnapshot;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function startServer(port = 0, root = DIST_DIR, customRoutes = {}, { testMode = true } = {}) {
  const useTestApp = testMode && root === DIST_DIR;
  if (useTestApp && runTempDir && !testSnapshot) {
    // 运行器为整个测试进程提供同一份不可变快照。
    const app = readFileSync(join(runTempDir, 'app.test.js'));
    testSnapshot = { app, version: app.toString().match(/window\.__GLASS_BUILD_APP__="([^"]+)";/)?.[1] };
  }
  let testApp = useTestApp ? testSnapshot?.app : undefined;
  let testVersion = useTestApp ? testSnapshot?.version : undefined;
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
        // 🛡️ 防目录遍历：禁止越过 root 服务任意本地文件（与 scripts/server.cjs 同等守卫）
        const rel = relative(root, file);
        if (rel.startsWith('..') || isAbsolute(rel)) {
          res.writeHead(403);
          res.end('403');
          return;
        }
        let data;
        const requestedVersion = /^\/app-builds\/([^/]+)\.js$/.exec(p)?.[1];
        if (useTestApp && requestedVersion) {
          if (!runTempDir) {
            const version = readFileSync(join(root, 'index.html'), 'utf-8')
              .match(/window\.__GLASS_BUILD_HTML__="([^"]+)"/)?.[1];
            if (version === requestedVersion && version !== testVersion) {
              testApp = buildAppJavaScript({ testMode: true, version }).outputFiles[0].contents;
              testVersion = version;
            }
          }
          if (requestedVersion === testVersion) data = testApp;
        }
        data ??= readFileSync(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('404');
      }
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        port: actualPort,
        server,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/** 启动真实预览服务，用 IPC 读取实际监听端口。 */
export async function startPreviewServer({ args = [], env = {} } = {}) {
  const child = fork(previewServerPath, ['--no-watch', ...args], {
    env: { ...process.env, AUTO_OPEN: '0', ...env, PORT: '0' },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const closed = once(child, 'close');
  const close = async () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill();
    return closed;
  };
  try {
    const [port] = await Promise.race([
      once(child, 'message', { signal: AbortSignal.timeout(10000) }),
      closed.then(([code, signal]) => { throw new Error(`预览服务在监听前退出 (${code ?? signal})`); }),
    ]);
    if (!Number.isInteger(port) || port <= 0) throw new Error(`无效的预览服务端口: ${port}`);
    return { port, close };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
