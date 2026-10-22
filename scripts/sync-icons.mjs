/**
 * ==============================================================================
 * Glass Start — Google S2 1:1 本地化同步引擎 (scripts/sync-icons.mjs)
 * ==============================================================================
 * 📌 设计规范与原则：
 * 默认复用可解码的本地正方形 PNG；--refresh 全量刷新本地图标。
 * 1. 统一接口：全量采用 Google S2 (sz=128) 高保真接口拉取，智能跟随重定向；
 * 2. 官方直链：针对 Google S2 索引为母公司通用标或暂无索引的站点，支持配置官方直链；
 * 3. 域名自愈：优先采用书签原始主机，遇到 404 自动追加/去除 www. 二次探测；
 * 4. 格式规范化：统一使用 macOS 原生 sips 转录为 128x128 1:1 PNG 存入 icons/{host}.png；
 * 5. 零外部依赖：纯原生 Node.js + 原生 sips，不引入任何 npm dependencies。
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const ICONS_DIR = join(ROOT_DIR, 'public', 'icons');
const BOOKMARKS_PATH = join(ROOT_DIR, 'bookmarks.json');
const HTTP_TIMEOUT_MS = 8000;
const refresh = process.argv.includes('--refresh');

// 针对 Google S2 索引为母公司通用标或暂无索引的站点，提供官方高清图标直链
const OFFICIAL_HOST_SOURCES = new Map([
    ['colab.research.google.com', 'https://ssl.gstatic.com/colaboratory-static/common/7e9bfd7c9345c7972401c42c04bf40a9/img/favicon.ico'],
    ['drive.google.com', 'https://www.gstatic.com/images/branding/productlogos/drive_2026/v2/web-64dp/logo_drive_2026_color_2x_web_64dp.png'],
    ['mail.google.com', 'https://www.gstatic.com/images/branding/productlogos/gmail_2026/v2/web-64dp/logo_gmail_2026_color_2x_web_64dp.png'],
    ['onedrive.live.com', 'https://res-1.cdn.office.net/files/fabric-cdn-prod_20230815.002/assets/brand-icons/product/png/onedrive_96x2.png'],
    ['qianwen.com', 'https://img.alicdn.com/imgextra/i4/O1CN01OXv3EM1FN8t9W4P79_!!6000000000474-2-tps-80-80.png']
]);

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

function getBareHostname(url) {
    try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`);
        return u.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return '';
    }
}

function getRawHostname(url) {
    try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`);
        return u.hostname.toLowerCase();
    } catch {
        return '';
    }
}

function fetchRedirectBuffer(url, timeoutMs = HTTP_TIMEOUT_MS, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) return reject(new Error('Too many redirects'));
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const nextUrl = new URL(res.headers.location, url).href;
                return resolve(fetchRedirectBuffer(nextUrl, timeoutMs, redirectCount + 1));
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

/** 校验本地 PNG 文件头与尺寸合规性 */
function isReusableIcon(path) {
    let workDir;
    try {
        const png = readFileSync(path);
        if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
            png.toString('ascii', 12, 16) !== 'IHDR') return false;
        const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
        if (!width || width !== height || width > 128) return false;
        workDir = mkdtempSync(join(tmpdir(), 'glass-icon-check-'));
        execFileSync('sips', ['-s', 'format', 'png', path, '--out', join(workDir, 'decoded.png')],
            { stdio: 'ignore', timeout: 5000 });
        return true;
    } catch {
        return false;
    } finally {
        if (workDir) rmSync(workDir, { recursive: true, force: true });
    }
}

/** 使用 macOS 原生 sips 转录规范化为 128x128 1:1 PNG */
function saveAsPng(inputBuffer, destPath) {
    const workDir = mkdtempSync(join(dirname(destPath), '.icon-sync-'));
    const inputPath = join(workDir, 'input.bin');
    const outputPath = join(workDir, 'output.png');
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const runSips = args => execFileSync('sips', args, { stdio: 'ignore', timeout: 5000 });
    const dimensions = () => {
        const png = readFileSync(outputPath);
        if (png.length < 24 || !png.subarray(0, 8).equals(pngHeader)
            || png.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Invalid PNG');
        const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
        if (!width || !height) throw new Error('Invalid PNG dimensions');
        return { width, height };
    };
    try {
        writeFileSync(inputPath, inputBuffer);
        runSips(['-s', 'format', 'png', inputPath, '--out', outputPath]);
        let { width, height } = dimensions();
        if (Math.max(width, height) > 128) {
            runSips(['-Z', '128', outputPath]);
            ({ width, height } = dimensions());
        }
        if (width !== height) {
            const side = String(Math.max(width, height));
            runSips(['--padToHeightWidth', side, side, outputPath]);
        }
        ({ width, height } = dimensions());
        if (width !== height || width > 128) throw new Error('Icon must be square');
        renameSync(outputPath, destPath);
        return true;
    } catch {
        return false;
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
}

async function runConcurrent(tasks, concurrency = 10, onProgress = null) {
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
    console.log(`${c.bold}${c.cyan}📦 Glass Start — Google S2 (sz=128) 本地图标纯净同步引擎${c.reset}`);
    console.log(`${c.cyan}${HR_DOUBLE}${c.reset}\n`);

    if (!existsSync(ICONS_DIR)) {
        mkdirSync(ICONS_DIR, { recursive: true });
        console.log(`  ${c.green}✔${c.reset} 创建本地图标目录: ${c.dim}public/icons/${c.reset}`);
    }

    if (!existsSync(BOOKMARKS_PATH)) {
        console.error(`  ${c.red}❌ 未找到 bookmarks.json 数据文件${c.reset}`);
        process.exit(1);
    }

    const rawData = readFileSync(BOOKMARKS_PATH, 'utf-8');
    const data = JSON.parse(rawData);

    // 收集唯一裸域名及其原始 URL 偏好
    const siteMap = new Map();
    function collectBookmark(bm) {
        if (!bm || !bm.url) return;
        const bareHost = getBareHostname(bm.url);
        const rawHost = getRawHostname(bm.url);
        if (bareHost && !siteMap.has(bareHost)) {
            siteMap.set(bareHost, {
                bareHost,
                preferredHost: rawHost || bareHost,
                destPath: join(ICONS_DIR, `${bareHost}.png`)
            });
        }
    }

    (data.bookmarks || []).forEach(collectBookmark);
    (data.categories || []).forEach(cat => {
        (cat.bookmarks || []).forEach(collectBookmark);
    });

    const totalHosts = siteMap.size;
    console.log(`  ${c.cyan}ℹ${c.reset} 扫描到 ${c.bold}${totalHosts}${c.reset} 个唯一站点域名，${refresh ? '全量刷新本地图标' : '复用有效本地图标，仅补齐缺失或损坏项'}...`);

    let completed = 0;
    const tasks = Array.from(siteMap.values()).map(site => async () => {
        const { bareHost, preferredHost, destPath } = site;

        // 默认复用已合规本地图标；--refresh 时全量重新拉取
        if (!refresh && isReusableIcon(destPath)) {
            return { host: bareHost, success: true, source: 'local' };
        }

        // 构建候选请求主机：优先使用原始书签中自带的 hostname，若失败自动反向尝试（裸域 ➔ www. 或 www. ➔ 裸域）
        const candidates = [preferredHost];
        if (preferredHost.startsWith('www.')) {
            candidates.push(preferredHost.replace(/^www\./, ''));
        } else if (!preferredHost.includes('.' + bareHost)) {
            candidates.push('www.' + bareHost);
        }

        let buf = null;
        let source = '';

        if (OFFICIAL_HOST_SOURCES.has(bareHost)) {
            try {
                const officialUrl = OFFICIAL_HOST_SOURCES.get(bareHost);
                const offBuf = await fetchRedirectBuffer(officialUrl, 7000);
                if (offBuf && offBuf.length > 0) {
                    buf = offBuf;
                    source = `Official Source (${bareHost})`;
                }
            } catch {}
        }

        if (!buf) {
            for (const candidate of candidates) {
                try {
                    const s2Url = `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent('https://' + candidate)}&size=128`;
                    const s2Buf = await fetchRedirectBuffer(s2Url, 7000);
                    if (s2Buf && s2Buf.length > 0) {
                        buf = s2Buf;
                        source = `Google S2 (${candidate})`;
                        break;
                    }
                } catch {}
            }
        }

        if (buf) {
            const ok = saveAsPng(buf, destPath);
            return { host: bareHost, success: ok, source };
        }

        return { host: bareHost, success: false, error: 'Google S2 404 / fetch error' };
    });

    const results = await runConcurrent(tasks, 12, (idx, total, res) => {
        completed++;
        const pct = Math.round((completed / total) * 100);
        const statusIcon = res.success ? `${c.green}✔${c.reset}` : `${c.red}❌${c.reset}`;
        process.stdout.write(`\r  [${completed}/${total}] ${pct}% ${statusIcon} ${res.host.padEnd(28)} ${c.dim}[${res.source || res.error}]${c.reset}        `);
    });

    console.log('\n');
    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
        console.log(`  ${c.yellow}⚠ 注意：有 ${failed.length} 个图标未能成功下载：${c.reset}`);
        failed.forEach(f => console.log(`    - ${f.host}: ${f.error || 'PNG normalization failed'}`));
        process.exitCode = 1;
    } else {
        console.log(`  ${c.green}✨ 全站 ${totalHosts} 个书签图标已就绪（复用 ${results.filter(r => r.source === 'local').length} 个，下载 ${results.filter(r => r.source !== 'local').length} 个）！${c.reset}`);
    }

    // 统一将 bookmarks.json 的 icon 规范为 ./icons/{host}.png
    let updatedIconCount = 0;
    function updateIconField(bm) {
        if (!bm || !bm.url) return;
        const host = getBareHostname(bm.url);
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

    console.log(`  ${c.green}✔${c.reset} bookmarks.json 单一真理源已生效，源码 src/js/config/constants.js 自动共享最新书签与图标`);
    console.log(`\n${c.cyan}${HR_DOUBLE}${c.reset}\n`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
