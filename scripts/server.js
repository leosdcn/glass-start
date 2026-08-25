const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const zlib = require('zlib');

// 终端格式化排版与 ANSI 彩色工具
const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
    reset: isTTY ? '\x1b[0m' : '',
    bold: isTTY ? '\x1b[1m' : '',
    dim: isTTY ? '\x1b[2m' : '',
    cyan: isTTY ? '\x1b[36m' : '',
    green: isTTY ? '\x1b[32m' : '',
    yellow: isTTY ? '\x1b[33m' : '',
    red: isTTY ? '\x1b[31m' : '',
    gray: isTTY ? '\x1b[90m' : '',
    magenta: isTTY ? '\x1b[35m' : '',
};

const LINE_WIDTH = 72;
const HR_DOUBLE = '═'.repeat(LINE_WIDTH);
const HR_SINGLE = '─'.repeat(LINE_WIDTH);

let targetPort = parseInt(process.env.PORT || '3000', 10);
const DIST_DIR = path.join(__dirname, '..', 'dist');

if (!fs.existsSync(DIST_DIR)) {
    console.error(`\n${c.red}${c.bold}❌ 错误: dist 目录不存在${c.reset}`);
    console.error(`   请先在项目根目录运行 ${c.cyan}npm run build${c.reset} 完成生产编译。\n`);
    process.exit(1);
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

function createStaticServer() {
    return http.createServer((req, res) => {
        try {
            let reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
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

            fs.stat(filePath, (err, stats) => {
                let targetPath = filePath;
                let isFallback = false;
                if (err || !stats.isFile()) {
                    targetPath = path.join(DIST_DIR, 'index.html');
                    isFallback = true;
                }

                // 304 协商缓存 (基于 mtime)
                const ifModifiedSince = req.headers['if-modified-since'];
                if (!isFallback && stats && ifModifiedSince) {
                    const reqMtime = new Date(ifModifiedSince).getTime();
                    if (Math.floor(stats.mtimeMs / 1000) <= Math.floor(reqMtime / 1000)) {
                        res.writeHead(304, 'Not Modified');
                        res.end();
                        return;
                    }
                }

                const ext = path.extname(targetPath).toLowerCase();
                const contentType = MIME_TYPES[ext] || 'application/octet-stream';

                res.setHeader('Content-Type', contentType);
                if (stats && !isFallback) {
                    res.setHeader('Last-Modified', stats.mtime.toUTCString());
                }

                const isWallpaper = rel.startsWith('wallpapers' + path.sep) || rel.startsWith('wallpapers/');
                if (isWallpaper) {
                    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                } else {
                    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
                }

                // 仅对非文档类静态资产开放跨域读取；HTML 文档不设置 CORS
                if (!contentType.startsWith('text/html')) {
                    res.setHeader('Access-Control-Allow-Origin', '*');
                }

                // 针对文本类静态资产（HTML, JS, CSS, JSON, SVG）支持原生 Gzip / Deflate 流式压缩
                const isCompressible = /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg\+xml)/.test(contentType);
                const acceptEncoding = req.headers['accept-encoding'] || '';

                const rawStream = fs.createReadStream(targetPath);
                rawStream.on('error', () => {
                    if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('404 Not Found');
                });

                if (isCompressible && acceptEncoding.includes('gzip')) {
                    res.setHeader('Content-Encoding', 'gzip');
                    res.setHeader('Vary', 'Accept-Encoding');
                    rawStream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
                } else if (isCompressible && acceptEncoding.includes('deflate')) {
                    res.setHeader('Content-Encoding', 'deflate');
                    res.setHeader('Vary', 'Accept-Encoding');
                    rawStream.pipe(zlib.createDeflate({ level: 6 })).pipe(res);
                } else {
                    rawStream.pipe(res);
                }
            });
        } catch {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('500 Internal Server Error');
        }
    });
}

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
        const lanIps = getLanIps();
        console.log(`\n${c.cyan}${HR_DOUBLE}${c.reset}`);
        console.log(`${c.bold}${c.cyan}🚀 Glass Start — 本地开发与局域网预览服务${c.reset}`);
        console.log(`${c.cyan}${HR_DOUBLE}${c.reset}\n`);

        console.log(`  💻 ${c.bold}本机访问:${c.reset}    ${c.cyan}http://localhost:${port}/${c.reset}`);
        console.log(`  🔗 ${c.bold}本地回环:${c.reset}    ${c.cyan}http://127.0.0.1:${port}/${c.reset}`);
        if (lanIps.length > 0) {
            console.log(`  📱 ${c.bold}局域网访问:${c.reset}  ${c.green}${c.bold}http://${lanIps[0]}:${port}/${c.reset}`);
            if (lanIps.length > 1) {
                console.log(`  🌐 ${c.bold}其它网卡:${c.reset}    ${lanIps.slice(1).map(ip => `${c.cyan}http://${ip}:${port}/${c.reset}`).join(', ')}`);
            }
        }

        console.log(`\n${c.gray}─── 💡 快速提示 ${'─'.repeat(LINE_WIDTH - 16)}${c.reset}`);
        console.log(`  • 局域网设备 (手机 / 平板) 连接同一 Wi-Fi 后即可直接访问上述局域网地址`);
        console.log(`  • 停止本地服务请按: ${c.yellow}Ctrl + C${c.reset}`);
        console.log(`${c.gray}${HR_DOUBLE}${c.reset}\n`);

        // 仅在服务确已 listen 成功并能接收请求时，才自动唤起浏览器
        if (process.env.AUTO_OPEN !== '0') {
            const url = `http://localhost:${port}`;
            if (process.platform === 'darwin') {
                exec(`open "${url}"`);
            } else if (process.platform === 'win32') {
                exec(`start "${url}"`);
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
