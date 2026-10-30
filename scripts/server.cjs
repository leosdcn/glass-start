const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const zlib = require('zlib');
const { main: runFullBuild, startWatch } = require('./build.cjs');

// 终端格式化排版与 ANSI 彩色工具
const { c, LINE_WIDTH, HR_DOUBLE } = require('./terminal.cjs');

let targetPort = parseInt(process.env.PORT || '3000', 10);
const DIST_DIR = path.join(__dirname, '..', 'dist');
const enableWatch = !process.argv.includes('--no-watch') && process.env.NO_WATCH !== '1';

// 若 dist 产物不存在，自动执行首次全量构建
if (!fs.existsSync(DIST_DIR) || !fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
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

function createStaticServer() {
    return http.createServer((req, res) => {
        try {
            const urlRaw = req.url || '/';
            // 🛡️ 本地开发环境旧缓存与状态污染一键清除通道 (Clear-Site-Data & Active Client-Side Purge)
            if (urlRaw.startsWith('/_clear_cache') || urlRaw.includes('clear-cache=1')) {
                res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Clear-Site-Data': '"cache", "storage"',
                    'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
                });
                res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>本地缓存深度重置</title></head><body style="font-family:system-ui;background:#0b0f19;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;max-width:420px;padding:24px;"><h2 style="margin-bottom:8px;font-size:18px;">🧹 正在深度净化 Safari 本地缓存...</h2><p id="msg" style="opacity:0.7;font-size:13px;line-height:1.6;">正在注销 Service Worker 并清空 CacheStorage / Storage...</p></div><script>(async function(){try{if('serviceWorker' in navigator){const regs=await navigator.serviceWorker.getRegistrations();for(const r of regs)await r.unregister();}if('caches' in window){const keys=await caches.keys();for(const k of keys)await caches.delete(k);}try{localStorage.clear();}catch(e){}try{sessionStorage.clear();}catch(e){}if('indexedDB' in window){try{indexedDB.deleteDatabase('GlassStartDB');}catch(e){}}document.getElementById('msg').textContent='✨ 清理完成！正在重新加载纯净起始页...';}catch(err){console.error('Purge error:',err);}finally{setTimeout(()=>{location.replace('/');},100);}})();</script></body></html>`);
                return;
            }

            let reqPath = decodeURIComponent(urlRaw.split('?')[0]);
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
                    // 🛡️ SPA 回退仅服务无扩展路由与 HTML 文档；缺失的静态资源必须如实 404，
                    // 严禁以 200 返回 index.html（否则浏览器会把 HTML 当 JS/CSS 解析报错，
                    // 且 Service Worker 可能以请求 URL 为键缓存错误实体）。
                    const reqExt = path.extname(reqPath).toLowerCase();
                    if (reqExt && reqExt !== '.html') {
                        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                        res.end('404 Not Found');
                        return;
                    }
                    targetPath = path.join(DIST_DIR, 'index.html');
                    isFallback = true;
                }

                const isWallpaper = rel.startsWith('wallpapers' + path.sep) || rel.startsWith('wallpapers/');
                const isIcon = rel.startsWith('icons' + path.sep) || rel.startsWith('icons/')
                    || rel === 'apple-touch-icon.png' || rel === 'favicon.ico';
                const isImmutableAsset = isWallpaper || isIcon;

                // 对壁纸与图标处理 If-Modified-Since，命中时返回 304。
                const ifModifiedSince = req.headers['if-modified-since'];
                if (!isFallback && stats && ifModifiedSince && isImmutableAsset) {
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

                // 🛡️ 本地开发服务防滞后与 Service Worker 强管辖响应头
                res.setHeader('Service-Worker-Allowed', '/');

                if (isImmutableAsset) {
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


let watchCleanup = null;
function cleanupAndExit() {
    if (watchCleanup) {
        watchCleanup();
        watchCleanup = null;
    }
    process.exit(0);
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
            watchCleanup = startWatch(undefined, { label: 'Dev Server', delay: 50 });
        }

        const lanIps = getLanIps();
        console.log(`\n${c.cyan}${HR_DOUBLE}${c.reset}`);
        console.log(`${c.bold}${c.cyan}🚀 Glass Start — 本地开发与局域网预览服务${c.reset}`);
        console.log(`${c.cyan}${HR_DOUBLE}${c.reset}\n`);

        console.log(`  💻 ${c.bold}本机访问:${c.reset}    ${c.cyan}http://localhost:${port}/${c.reset}`);
        console.log(`  🔗 ${c.bold}本地回环:${c.reset}    ${c.cyan}http://127.0.0.1:${port}/${c.reset}`);
        if (lanIps.length > 0) {
            console.log(`  📱 ${c.bold}局域网访问:${c.reset}  ${c.cyan}http://${lanIps[0]}:${port}/${c.reset}`);
            if (lanIps.length > 1) {
                console.log(`  🌐 ${c.bold}其它网卡:${c.reset}    ${lanIps.slice(1).map(ip => `${c.cyan}http://${ip}:${port}/${c.reset}`).join(', ')}`);
            }
        }
        if (enableWatch) {
            console.log(`  👀 ${c.bold}增量监听:${c.reset}    ${c.green}已开启 (改动即时编译)${c.reset}`);
        } else {
            console.log(`  👀 ${c.bold}增量监听:${c.reset}    ${c.yellow}已关闭 (参数包含 --no-watch)${c.reset}`);
        }
        const isCleanMode = process.env.CLEAR_CACHE === '1' || process.argv.includes('--clear-cache');
        if (isCleanMode) {
            console.log(`  🧹 ${c.bold}缓存净化:${c.reset}    ${c.yellow}已启用 (自动唤起 /_clear_cache 深度重置)${c.reset}`);
        }

        console.log(`\n${c.gray}─── 💡 快速提示 ${'─'.repeat(LINE_WIDTH - 16)}${c.reset}`);
        console.log(`  • 源码修改时服务将自动增量编译至 dist/ 并滚动版本指纹，直接刷新浏览器即可预览`);
        if (!isCleanMode) {
            console.log(`  • 如遇本地缓存污染或状态异常，直接访问: ${c.yellow}http://localhost:${port}/_clear_cache${c.reset} 即可一键抹除重置`);
        }
        console.log(`  • 局域网设备 (手机 / 平板) 连接同一 Wi-Fi 后即可直接访问上述局域网地址`);
        console.log(`  • 停止本地服务请按: ${c.yellow}Ctrl + C${c.reset}`);
        console.log(`${c.gray}${HR_DOUBLE}${c.reset}\n`);

        // 仅在服务确已 listen 成功并能接收请求时，才自动唤起浏览器
        if (process.env.AUTO_OPEN !== '0') {
            const isCleanMode = process.env.CLEAR_CACHE === '1' || process.argv.includes('--clear-cache');
            const openPath = isCleanMode ? '/_clear_cache' : '/';
            const url = `http://localhost:${port}${openPath}`;
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

