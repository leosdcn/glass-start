/**
 * ==============================================================================
 * Glass Start — a.favicon.im 1:1 本地化同步引擎 (scripts/sync-icons.mjs)
 * ==============================================================================
 * 📌 设计规范与原则：
 * 1. 纯净真理源：100% 严格对齐 https://a.favicon.im/{host}，不冒风险引入任何第三方/外部覆盖源；
 * 2. 格式规范化：由于 a.favicon.im 可能返回 SVG/ICO/PNG，统一使用 macOS 原生 sips 转录为
 *    合规的 PNG 格式存入 icons/{host}.png，保障浏览器与 Service Worker 本地零解析开销；
 * 3. 映射单一化：bookmarks.json 中所有书签统一指向相对路径 ./icons/{host}.png；
 * 4. 零外部依赖：纯原生 Node.js + 原生 sips，不引入任何 npm dependencies。
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import https from 'node:https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const ICONS_DIR = join(ROOT_DIR, 'icons');
const BOOKMARKS_PATH = join(ROOT_DIR, 'bookmarks.json');

// 终端排版色彩
const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
    reset: isTTY ? '\x1b[0m' : '',
    bold: isTTY ? '\x1b[1m' : '',
    dim: isTTY ? '\x1b[2m' : '',
    cyan: isTTY ? '\x1b[36m' : '',
    green: isTTY ? '\x1b[32m' : '',
    yellow: isTTY ? '\x1b[33m' : '',
    red: isTTY ? '\x1b[31m' : ''
};

const HR_DOUBLE = '═'.repeat(72);

function getHostname(url) {
    try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`);
        return u.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return '';
    }
}

function fetchBuffer(url, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(fetchBuffer(res.headers.location, timeoutMs));
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const chunks = [];
            res.on('data', d => chunks.push(d));
            res.on('end', () => {
                const b = Buffer.concat(chunks);
                if (b.length === 0) return reject(new Error('Empty buffer'));
                resolve(b);
            });
            res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout after ${timeoutMs}ms`)));
    });
}

function saveAsPng(inputBuffer, destPath) {
    const isSvg = inputBuffer.toString('utf-8', 0, Math.min(200, inputBuffer.length)).includes('<svg');
    const ext = isSvg ? '.svg' : '.bin';
    const tmpFile = join('/tmp', `favim_sync_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`);

    try {
        writeFileSync(tmpFile, inputBuffer);
        // 使用原生 sips 将 SVG/ICO/PNG 统一标准化转写为规范的 PNG 文件
        execSync(`sips -s format png "${tmpFile}" --out "${destPath}"`, {
            stdio: ['pipe', 'pipe', 'ignore'],
            timeout: 5000
        });
        // 若产物超过 128px，等比缩放到 128px 兼顾高清与极致体积
        try {
            const dimStr = execSync(`sips -g pixelWidth "${destPath}"`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
            const match = dimStr.match(/pixelWidth:\s*(\d+)/);
            if (match && parseInt(match[1], 10) > 128) {
                execSync(`sips -Z 128 "${destPath}"`, { stdio: ['ignore', 'ignore', 'ignore'] });
            }
        } catch {}
        try { unlinkSync(tmpFile); } catch {}
        return true;
    } catch {
        try { unlinkSync(tmpFile); } catch {}
        // 若 sips 处理异常，作为兜底直接写入二进制 Buffer
        try {
            writeFileSync(destPath, inputBuffer);
            return true;
        } catch {
            return false;
        }
    }
}

async function runConcurrent(tasks, concurrency = 8, onProgress = null) {
    let index = 0;
    const results = new Array(tasks.length);
    async function worker() {
        while (index < tasks.length) {
            const currentIdx = index++;
            results[currentIdx] = await tasks[currentIdx]();
            if (onProgress) onProgress(currentIdx, tasks.length, results[currentIdx]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
    return results;
}

async function main() {
    console.log(`\n${c.cyan}${HR_DOUBLE}${c.reset}`);
    console.log(`${c.bold}${c.cyan}📦 Glass Start — a.favicon.im 1:1 本地图标纯净抓取与同步${c.reset}`);
    console.log(`${c.cyan}${HR_DOUBLE}${c.reset}\n`);

    if (!existsSync(ICONS_DIR)) {
        mkdirSync(ICONS_DIR, { recursive: true });
        console.log(`  ${c.green}✔${c.reset} 创建本地图标目录: ${c.dim}icons/${c.reset}`);
    }

    if (!existsSync(BOOKMARKS_PATH)) {
        console.error(`  ${c.red}❌ 未找到 bookmarks.json 数据文件${c.reset}`);
        process.exit(1);
    }

    const rawData = readFileSync(BOOKMARKS_PATH, 'utf-8');
    const data = JSON.parse(rawData);

    const hostMap = new Map();
    function collectBookmark(bm) {
        if (!bm || !bm.url) return;
        const host = getHostname(bm.url);
        if (host && !hostMap.has(host)) {
            hostMap.set(host, join(ICONS_DIR, `${host}.png`));
        }
    }

    (data.bookmarks || []).forEach(collectBookmark);
    (data.categories || []).forEach(cat => {
        (cat.bookmarks || []).forEach(collectBookmark);
    });

    const totalHosts = hostMap.size;
    console.log(`  ${c.cyan}ℹ${c.reset} 扫描到 ${c.bold}${totalHosts}${c.reset} 个唯一站点域名，开始从 ${c.bold}https://a.favicon.im/{domain}${c.reset} 1:1 抓取...`);

function isPlaceholder(buf) {
    if (!buf || buf.length === 0) return true;
    const str = buf.toString('utf-8', 0, Math.min(300, buf.length));
    return str.includes('circle cx="50" cy="50" r="40" fill="#808080"') || str.includes('>f</text>');
}

    let completed = 0;
    const tasks = Array.from(hostMap.entries()).map(([host, destPath]) => async () => {
        let buf = null;
        let source = 'a.favicon.im';

        try {
            buf = await fetchBuffer(`https://a.favicon.im/${host}`, 8000);
            if (isPlaceholder(buf)) {
                // 若 bare domain 命中 favicon.im 的灰色 'f' 兜底标，尝试带 www. 请求
                try {
                    const wwwBuf = await fetchBuffer(`https://a.favicon.im/www.${host}`, 7000);
                    if (!isPlaceholder(wwwBuf)) {
                        buf = wwwBuf;
                        source = 'a.favicon.im (www)';
                    }
                } catch {}
            }
        } catch {}

        // 若 a.favicon.im 失败或仍为兜底占位标，平滑走 Google S2
        if (!buf || isPlaceholder(buf)) {
            try {
                const s2Url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
                const s2Buf = await fetchBuffer(s2Url, 7000);
                if (s2Buf && s2Buf.length > 0) {
                    buf = s2Buf;
                    source = 'Google S2 (fallback)';
                }
            } catch {}
        }

        if (buf && !isPlaceholder(buf)) {
            const ok = saveAsPng(buf, destPath);
            return { host, success: ok, source };
        }

        return { host, success: false, error: 'No valid icon found' };
    });

    const results = await runConcurrent(tasks, 8, (idx, total, res) => {
        completed++;
        const pct = Math.round((completed / total) * 100);
        const statusIcon = res.success ? `${c.green}✔${c.reset}` : `${c.red}❌${c.reset}`;
        process.stdout.write(`\r  [${completed}/${total}] ${pct}% ${statusIcon} ${res.host.padEnd(28)} ${c.dim}[${res.source || res.error}]${c.reset}        `);
    });

    console.log('\n');
    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
        console.log(`  ${c.yellow}⚠ 注意：有 ${failed.length} 个图标未能成功下载：${c.reset}`);
        failed.forEach(f => console.log(`    - ${f.host}: ${f.error}`));
    } else {
        console.log(`  ${c.green}✨ 全站 ${totalHosts} 个书签图标已 100% 成功从 a.favicon.im 抓取并存入本地 icons/ 目录！${c.reset}`);
    }

    // 统一将 bookmarks.json 的 icon 规范为 ./icons/{host}.png
    let updatedIconCount = 0;
    function updateIconField(bm) {
        if (!bm || !bm.url) return;
        const host = getHostname(bm.url);
        if (!host) return;
        const iconPath = `./icons/${host}.png`;
        if (bm.icon !== iconPath) {
            bm.icon = iconPath;
            updatedIconCount++;
        }
    }

    (data.bookmarks || []).forEach(updateIconField);
    (data.categories || []).forEach(cat => {
        (cat.bookmarks || []).forEach(updateIconField);
    });

    if (updatedIconCount > 0) {
        writeFileSync(BOOKMARKS_PATH, JSON.stringify(data, null, 4) + '\n', 'utf-8');
        console.log(`  ${c.green}✔${c.reset} 已规范 bookmarks.json 中 ${c.bold}${updatedIconCount}${c.reset} 处图标路径为 ./icons/{host}.png`);
    }

    // 自动双向同步源码配置 (bookmarks.json -> src/js/config/constants.js)
    const CONSTANTS_PATH = join(ROOT_DIR, 'src', 'js', 'config', 'constants.js');
    if (existsSync(CONSTANTS_PATH)) {
        try {
            let constantsContent = readFileSync(CONSTANTS_PATH, 'utf-8');
            let constantsUpdated = false;

            const safeReplaceJsVariable = (code, varName, replacementJs) => {
                const reg = new RegExp(`(export\\s+const\\s+${varName}\\s*=\\s*)\\[[\\s\\S]*?\\n\\s*\\];`, 'm');
                return code.replace(reg, `$1${replacementJs};`);
            };
            const formatJsObject = (obj, indent = 4) => {
                return JSON.stringify(obj, null, 4)
                    .split('\n')
                    .map((line, idx) => (idx === 0 ? line : ' '.repeat(indent) + line))
                    .join('\n');
            };

            if (data.bookmarks && Array.isArray(data.bookmarks)) {
                const next = safeReplaceJsVariable(constantsContent, 'DEFAULT_BOOKMARKS', formatJsObject(data.bookmarks, 4));
                if (next !== constantsContent) {
                    constantsContent = next;
                    constantsUpdated = true;
                }
            }
            if (data.categories && Array.isArray(data.categories)) {
                const next = safeReplaceJsVariable(constantsContent, 'DEFAULT_CATEGORIES', formatJsObject(data.categories, 4));
                if (next !== constantsContent) {
                    constantsContent = next;
                    constantsUpdated = true;
                }
            }

            if (constantsUpdated) {
                writeFileSync(CONSTANTS_PATH, constantsContent, 'utf-8');
                console.log(`  ${c.green}✔${c.reset} 已自动同步更新源码 src/js/config/constants.js 默认书签数据与本地图标路径`);
            }
        } catch (syncErr) {
            console.warn(`  ${c.yellow}⚠ 同步 constants.js 提示: ${syncErr.message}${c.reset}`);
        }
    }

    console.log(`\n${c.cyan}${HR_DOUBLE}${c.reset}\n`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
