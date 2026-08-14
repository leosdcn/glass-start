const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

let targetPort = parseInt(process.env.PORT || '3000', 10);
const DIST_DIR = path.join(__dirname, 'dist');

if (!fs.existsSync(DIST_DIR)) {
    console.error('❌ dist 目录不存在，请先运行 npm run build 构建。');
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
            if (!filePath.startsWith(DIST_DIR)) {
                res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('403 Forbidden');
                return;
            }

            fs.stat(filePath, (err, stats) => {
                if (err || !stats.isFile()) {
                    const fallback = path.join(DIST_DIR, 'index.html');
                    fs.readFile(fallback, (fErr, data) => {
                        if (fErr) {
                            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                            res.end('404 Not Found');
                        } else {
                            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                            res.end(data);
                        }
                    });
                    return;
                }

                const ext = path.extname(filePath).toLowerCase();
                const contentType = MIME_TYPES[ext] || 'application/octet-stream';
                
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Type', contentType);

                const stream = fs.createReadStream(filePath);
                stream.pipe(res);
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
        console.log('\n✨ Glass Start 本地局域网服务器已就绪！\n');
        console.log('-------------------------------------------------------');
        console.log(`  💻 本机访问:    http://localhost:${port}`);
        console.log(`  🔗 本地备用:    http://127.0.0.1:${port}`);
        if (lanIps.length > 0) {
            console.log(`  📱 局域网访问:  http://${lanIps[0]}:${port}`);
            if (lanIps.length > 1) {
                console.log(`  🌐 其他网卡:    ${lanIps.slice(1).map(ip => `http://${ip}:${port}`).join(', ')}`);
            }
        }
        console.log('-------------------------------------------------------');
        console.log('  💡 同一 Wi-Fi / 局域网下的手机、平板或其他设备可直接访问上述局域网地址。');
        console.log('  🛑 停止服务请按: Ctrl + C\n');

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
            console.warn(`⚠️ 端口 ${port} 已被占用，正在尝试端口 ${port + 1}...`);
            startListening(port + 1);
        } else {
            console.error('❌ 服务器启动出错:', err);
            process.exit(1);
        }
    });
}

startListening(targetPort);
