const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');
const zlib = require('zlib');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { main: runFullBuild, startWatch } = require('./build.cjs');

// 终端格式化排版与 ANSI 彩色工具
const { c, LINE_WIDTH, HR_DOUBLE } = require('./terminal.cjs');

let targetPort = parseInt(process.env.PORT || '3000', 10);
const testSnapshotDir = process.env.GLASS_TEST_TMPDIR;
const DIST_DIR = testSnapshotDir ? path.join(testSnapshotDir, 'dist') : path.join(__dirname, '..', 'dist');
const enableWatch = !testSnapshotDir && !process.argv.includes('--no-watch') && process.env.NO_WATCH !== '1';
const isolatedPreview = process.argv.includes('--isolated');

// 若 dist 产物不存在，自动执行首次全量构建
if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    if (testSnapshotDir) throw new Error(`测试构建产物不存在: ${DIST_DIR}`);
    console.log(`\n${c.cyan}📦 未检测到 dist/ 生产产物，正在自动执行首次全量编译...${c.reset}`);
    runFullBuild();
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8'
};

async function openStaticFile(filePath) {
    const file = await fs.promises.open(filePath, 'r').catch(error => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
        throw error;
    });
    if (!file) return null;
    try {
        const stats = await file.stat();
        if (stats.isFile()) return { file, stats };
    } catch (error) {
        await file.close();
        throw error;
    }
    await file.close();
    return null;
}

function resolveSslConfig() {
    const useHttps = process.argv.includes('--https') || process.env.HTTPS === '1';
    if (!useHttps) return null;

    const root = path.join(__dirname, '..');
    const customCert = process.env.SSL_CERT;
    const customKey = process.env.SSL_KEY;

    if (customCert && customKey) {
        const certPath = path.isAbsolute(customCert) ? customCert : path.join(root, customCert);
        const keyPath = path.isAbsolute(customKey) ? customKey : path.join(root, customKey);
        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
            return {
                key: fs.readFileSync(keyPath),
                cert: fs.readFileSync(certPath),
                certPath,
                keyPath
            };
        }
        throw new Error(`指定的 SSL 证书或私钥不存在: cert=${certPath}, key=${keyPath}`);
    }

    const certCandidates = [
        { cert: 'localhost.pem', key: 'localhost-key.pem' },
        { cert: 'localhost+2.pem', key: 'localhost+2-key.pem' },
        { cert: 'cert.pem', key: 'key.pem' },
        { cert: '.cert/localhost.pem', key: '.cert/localhost-key.pem' },
        { cert: '.cert/cert.pem', key: '.cert/key.pem' }
    ];

    for (const pair of certCandidates) {
        const certPath = path.join(root, pair.cert);
        const keyPath = path.join(root, pair.key);
        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
            return {
                key: fs.readFileSync(keyPath),
                cert: fs.readFileSync(certPath),
                certPath,
                keyPath
            };
        }
    }

    console.error(`\n${c.red}${c.bold}❌ 未检测到本地 SSL 证书文件！${c.reset}`);
    console.error(`  使用 HTTPS 启动需先生成本地受信任证书。推荐使用 mkcert：`);
    console.error(`    1. 安装 mkcert:     ${c.cyan}brew install mkcert${c.reset} (macOS) 或 ${c.cyan}choco install mkcert${c.reset} (Windows)`);
    console.error(`    2. 安装本地根 CA:   ${c.cyan}mkcert -install${c.reset}`);
    console.error(`    3. 签发本地证书:     ${c.cyan}mkcert localhost 127.0.0.1 ::1${c.reset}`);
    console.error(`  生成 localhost.pem 和 localhost-key.pem 后再次运行即可。\n`);
    process.exit(1);
}

const sslConfig = resolveSslConfig();
const isHttps = Boolean(sslConfig);
const protocol = isHttps ? 'https' : 'http';

async function handleStaticRequest(req, res) {
        let asset = null;
        let streamPiped = false;
        try {
            const urlRaw = req.url || '/';
            const pathname = urlRaw.split('?')[0];
            let reqPath = decodeURIComponent(pathname);
            if (reqPath === '/' || reqPath === '') {
                reqPath = '/index.html';
            }
            
            const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
            const filePath = path.join(DIST_DIR, safePath);

            // 防止目录遍历安全漏洞
            const rel = path.relative(DIST_DIR, filePath);
            if (rel.startsWith('..') || path.isAbsolute(rel)) {
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('403 Forbidden');
                return;
            }

            // 先打开文件再读取元数据，发布切换后仍可从同一描述符完成当前响应。
            asset = await openStaticFile(filePath);
            const isFallback = !asset;
            const targetPath = isFallback ? path.join(DIST_DIR, 'index.html') : filePath;
            if (isFallback) {
                const reqExt = path.extname(reqPath).toLowerCase();
                if (reqExt && reqExt !== '.html') {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('404 Not Found');
                    return;
                }
                asset = await openStaticFile(targetPath);
                if (!asset) {
                    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('404 Not Found');
                    return;
                }
            }
            const { file, stats } = asset;

            const isWallpaper = rel.startsWith('wallpapers' + path.sep) || rel.startsWith('wallpapers/');
            const isIcon = rel.startsWith('icons' + path.sep) || rel.startsWith('icons/')
                || rel === 'apple-touch-icon.png' || rel === 'favicon.ico';
            const isBuildScript = rel.startsWith('app-builds' + path.sep) && path.extname(rel) === '.js';
            const isRevalidatedAsset = !isFallback && (isWallpaper || isIcon);

            const ext = path.extname(targetPath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            const isCompressible = /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg\+xml)/.test(contentType);

            res.setHeader('Content-Type', contentType);
            if (isCompressible) res.setHeader('Vary', 'Accept-Encoding');
            if (!isFallback && !isRevalidatedAsset) {
                res.setHeader('Last-Modified', stats.mtime.toUTCString());
            }

            // 🛡️ 本地开发服务防滞后与 Service Worker 强管辖响应头
            res.setHeader('Service-Worker-Allowed', '/');

            if (isBuildScript) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            } else if (isRevalidatedAsset) {
                res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
            } else {
                // 禁用代码与文档 HTTP 缓存；已受 Service Worker 控制的页面仍可能命中其缓存。
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }

            // 仅对非文档类静态资产开放跨域读取；HTML 文档不设置 CORS
            if (!contentType.startsWith('text/html')) {
                res.setHeader('Access-Control-Allow-Origin', '*');
            }

            let body;
            if (isRevalidatedAsset) {
                // 校验的是同一文件描述符读取的字节，时间戳精度和重新复制不会改变判断。
                body = await file.readFile().finally(() => file.close());
                const tag = '"' + createHash('sha256').update(body).digest('base64url') + '"';
                res.setHeader('ETag', 'W/' + tag);
                const tags = req.headers['if-none-match']?.split(',') ?? [];
                if (tags.some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === tag)) {
                    res.writeHead(304);
                    res.end();
                    return;
                }
            }

            // 文本类静态资源可按协商压缩。
            const acceptEncoding = req.headers['accept-encoding'] || '';

            const rawStream = body ? Readable.from([body]) : file.createReadStream();
            res.on('close', () => rawStream.destroy());
            rawStream.on('error', () => {
                if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('404 Not Found');
            });

            streamPiped = true;
            if (isCompressible && acceptEncoding.includes('gzip')) {
                res.setHeader('Content-Encoding', 'gzip');
                rawStream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
            } else if (isCompressible && acceptEncoding.includes('deflate')) {
                res.setHeader('Content-Encoding', 'deflate');
                rawStream.pipe(zlib.createDeflate({ level: 6 })).pipe(res);
            } else {
                rawStream.pipe(res);
            }
        } catch {
            if (asset?.file && !streamPiped) {
                try { await asset.file.close(); } catch {}
            }
            if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('500 Internal Server Error');
        }
    }

function createStaticServer() {
    if (isHttps) {
        return https.createServer({ key: sslConfig.key, cert: sslConfig.cert }, handleStaticRequest);
    }
    return http.createServer(handleStaticRequest);
}


let watchCleanup = null;
let previewBrowser = null;

function openIsolatedPreview(url) {
    const chrome = process.env.CHROME_PATH || (process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
    let profile;
    function removeProfile() {
        if (!profile) return;
        try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); }
        catch (error) { console.error(`无法清理临时 Chrome 配置目录 ${profile}：${error.message}`); }
    }
    try {
        profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-start-preview-'));
        previewBrowser = spawn(chrome, [
            `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', url
        ], { stdio: 'ignore' });
        previewBrowser.once('error', error => console.error(`无法打开独立 Chrome 预览：${error.message}`));
        previewBrowser.once('close', () => {
            previewBrowser = null;
            removeProfile();
        });
    } catch (error) {
        removeProfile();
        console.error(`无法打开独立 Chrome 预览：${error.message}`);
    }
}

function cleanupAndExit() {
    if (watchCleanup) {
        watchCleanup();
        watchCleanup = null;
    }
    const browser = previewBrowser;
    if (!browser) process.exit(0);
    browser.once('close', () => process.exit(0));
    browser.kill();
    setTimeout(() => browser.kill('SIGKILL'), 1500).unref();
}
process.on('SIGINT', cleanupAndExit);
process.on('SIGTERM', cleanupAndExit);

function getLanIps() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('127.')) {
                ips.push(iface.address);
            }
        }
    }
    return ips;
}

function startListening(port) {
    const server = createStaticServer();

    server.listen(port, '0.0.0.0', () => {
        if (enableWatch && !watchCleanup) {
            watchCleanup = startWatch({ label: 'Dev Server', delay: 50 });
        }

        const lanIps = getLanIps();
        console.log(`\n${c.cyan}${HR_DOUBLE}${c.reset}`);
        console.log(`${c.bold}${c.cyan}🚀 Glass Start — 本地开发与局域网预览服务 (${protocol.toUpperCase()})${c.reset}`);
        console.log(`${c.cyan}${HR_DOUBLE}${c.reset}\n`);

        console.log(`  💻 ${c.bold}本机访问:${c.reset}    ${c.cyan}${protocol}://localhost:${port}/${c.reset}`);
        console.log(`  🔗 ${c.bold}本地回环:${c.reset}    ${c.cyan}${protocol}://127.0.0.1:${port}/${c.reset}`);
        if (lanIps.length > 0) {
            console.log(`  📱 ${c.bold}局域网访问:${c.reset}  ${c.cyan}${protocol}://${lanIps[0]}:${port}/${c.reset}`);
            if (lanIps.length > 1) {
                console.log(`  🌐 ${c.bold}其它网卡:${c.reset}    ${lanIps.slice(1).map(ip => `${c.cyan}${protocol}://${ip}:${port}/${c.reset}`).join(', ')}`);
            }
        }
        if (enableWatch) {
            console.log(`  👀 ${c.bold}文件监听:${c.reset}    ${c.green}已开启 (改动后重新构建)${c.reset}`);
        } else {
            console.log(`  👀 ${c.bold}文件监听:${c.reset}    ${c.yellow}已关闭${c.reset}`);
        }
        console.log(`\n${c.gray}─── 💡 快速提示 ${'─'.repeat(LINE_WIDTH - 16)}${c.reset}`);
        if (enableWatch) console.log(`  • 源码修改后自动重新构建 dist/，刷新浏览器即可预览`);
        console.log(`  • 局域网设备 (手机 / 平板) 连接同一 Wi-Fi 后即可直接访问上述局域网地址`);
        console.log(`  • 停止本地服务请按: ${c.yellow}Ctrl + C${c.reset}`);
        console.log(`${c.gray}${HR_DOUBLE}${c.reset}\n`);

        // 仅在服务确已 listen 成功并能接收请求时，才自动唤起浏览器
        if (process.env.AUTO_OPEN !== '0') {
            const url = `${protocol}://localhost:${port}/`;
            if (isolatedPreview) {
                openIsolatedPreview(url);
            } else if (process.platform === 'darwin') {
                exec(`open "${url}"`);
            } else if (process.platform === 'win32') {
                exec(`start "" "${url}"`);
            } else {
                exec(`xdg-open "${url}"`);
            }
        }
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`  ${c.yellow}⚠️ 端口 ${port} 已被占用，正在尝试端口 ${port + 1}...${c.reset}`);
            startListening(port + 1);
        } else {
            console.error(`\n${c.red}${c.bold}❌ 服务器启动出错:${c.reset}`, err);
            process.exit(1);
        }
    });
}

startListening(targetPort);

