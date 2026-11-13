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
import { existsSync, mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync, renameSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { crc32, inflateSync } from 'node:zlib';
import { c, HR_DOUBLE } from './terminal.cjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const ICONS_DIR = join(ROOT_DIR, 'public', 'icons');
const BOOKMARKS_PATH = join(ROOT_DIR, 'bookmarks.json');
const refresh = process.argv.includes('--refresh');

/** @typedef {{ url: string, entry?: string, referer?: string, cropSize?: number }} IconSource */

// 为官网提供更合适图标的站点指定官方资源。
const OFFICIAL_HOST_SOURCES = new Map(/** @type {[string, string | IconSource][]} */ ([
    ['archive.org', 'https://archive.org/offshoot_assets/apple-touch-icon.png'],
    ['colab.research.google.com', 'https://www.gstatic.com/colaboratory-static/common/7e9bfd7c9345c7972401c42c04bf40a9/img/favicon.ico'],
    ['cook.yunyoujun.cn', 'https://cook.yunyoujun.cn/favicon.svg'],
    ['desmos.com', 'https://www.desmos.com/assets/img/apps/graphing/apple-touch-icon.png'],
    ['douban.com', {
        url: 'https://img3.doubanio.com/f/talion/7c6364aadf368dc0210173c940cfd0f64ceddc66/pics/icon/m_logo_200.png',
        referer: 'https://m.douban.com/'
    }],
    ['drive.google.com', 'https://www.gstatic.com/images/branding/productlogos/drive_2026/v2/web-64dp/logo_drive_2026_color_2x_web_64dp.png'],
    ['earth.google.com', 'https://www.gstatic.com/images/branding/product/2x/earth_64dp.png'],
    ['en.wikivoyage.org', 'https://upload.wikimedia.org/wikipedia/commons/8/8a/Wikivoyage-logo.svg'],
    ['github.com', 'https://github.githubassets.com/favicons/favicon-dark.svg'],
    ['linkedin.com', 'https://play-lh.googleusercontent.com/oij55bxj3e-4JrhGntpki0lnQyE8yQn8X5FPEzZ0t7cLppeiSINynEk7n9COoh7QSaCOZ_yiPO31NVaW4SDbWg=s512'],
    ['maps.google.com', 'https://www.gstatic.com/images/branding/productlogos/maps_2025/v1/web-64dp/logo_maps_2025_color_2x_web_64dp.png'],
    ['msdmanuals.com', 'https://edge.sitecorecloud.io/mmanual-ssq1ci05/media/manual/brand-logos/mm_logo.svg'],
    ['netflix.com', {
        url: 'https://assets.ctfassets.net/4cd45et68cgf/5vCbQ45TfVUvWgm8eiDOtn/ef1c2431dc81f79ae93fcce649ae796f/Netflix_Symbol.zip',
        entry: '02_Netflix_Symbol/01_Netflix_Symbol_RGB/Netflix_Symbol_RGB.png',
        cropSize: 904 // 红色 N 高约 900 px，居中裁去素材包原图的透明留白。
    }],
    ['onedrive.live.com', 'https://res-1.cdn.office.net/files/fabric-cdn-prod_20230815.002/assets/brand-icons/product/png/onedrive_96x2.png'],
    ['open.spotify.com', 'https://storage.googleapis.com/pr-newsroom-wp/1/2021/02/Spotify_Icon_RGB_Green.png'],
    ['pychess.org', 'https://cdn.jsdelivr.net/gh/pychess/pychess-variants@1.11.89/static/favicon/ms-icon-310x310.png'],
    ['qianwen.com', 'https://img.alicdn.com/imgextra/i3/O1CN01meficLFy3FK0UDAm_!!6000000006257-2-tps-240-240.png'],
    ['shogiwars.heroz.jp', 'https://play-lh.googleusercontent.com/MxcyRQDoC02-XccBkR8hKklHBerLULM1mifESyvIJX11rI8L8rwyfYfhrchFl1DEzNYWvSuRdTfH-JjQ30Z5=w512'],
    ['sspai.com', 'https://sspai.com/apple-touch-icon.png'],
    ['stellarium-web.org', 'https://stellarium.sfo2.cdn.digitaloceanspaces.com/stellarium-web/frontend-1.16.0/icon-180.png'],
    ['translate.google.com', 'https://www.gstatic.com/images/branding/product/2x/translate_64dp.png'],
    ['twitch.tv', {
        url: 'https://www.twitch.tv/p/press-center/assets/media/glitch.zip',
        entry: 'glitch/Purple/TwitchGlitchPurple.svg'
    }],
    ['web.localsend.org', 'https://web.localsend.org/logo-512.png'],
    ['weibo.com', 'https://h5.sinaimg.cn/upload/447/2017/10/12/code_logo.png']
]));

function getBareHostname(url) {
    return getRawHostname(url).replace(/^www\./, '');
}

function getRawHostname(url) {
    try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`);
        return u.hostname.toLowerCase();
    } catch {
        return '';
    }
}

function fetchRedirectBuffer(url, referer = '', timeoutMs = 7000, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) return reject(new Error('Too many redirects'));
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                ...(referer ? { Referer: referer } : {})
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                const nextUrl = new URL(res.headers.location, url);
                const nextReferer = nextUrl.origin === new URL(url).origin ? referer : '';
                return resolve(fetchRedirectBuffer(nextUrl.href, nextReferer, timeoutMs, redirectCount + 1));
            }
            if (res.statusCode !== 200) {
                res.resume();
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

const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const IEND_CHUNK = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

function pngDimensions(path, checkData = false) {
    const png = readFileSync(path);
    if (png.length < 57 || !png.subarray(0, 8).equals(PNG_HEADER)
        || png.toString('ascii', 12, 16) !== 'IHDR' || !png.subarray(-12).equals(IEND_CHUNK)) {
        throw new Error('Invalid PNG');
    }
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    if (!width || !height) throw new Error('Invalid PNG dimensions');
    if (checkData && width === height && width <= 128) {
        const data = [];
        for (let offset = 8; offset < png.length;) {
            if (offset + 12 > png.length) throw new Error('Truncated PNG chunk');
            const end = offset + 8 + png.readUInt32BE(offset);
            if (end + 4 > png.length || crc32(png.subarray(offset + 4, end)) !== png.readUInt32BE(end)) {
                throw new Error('Invalid PNG chunk');
            }
            if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') data.push(png.subarray(offset + 8, end));
            offset = end + 4;
        }
        // 128² RGBA 16-bit 加滤镜字节和隔行扫描开销仍小于 140 KiB。
        if (!data.length || !inflateSync(Buffer.concat(data), { maxOutputLength: 140 * 1024 }).length) {
            throw new Error('Invalid PNG image data');
        }
    }
    return { width, height };
}

/** 文件头、尺寸与尾标合规后实际解码，避免复用图像数据损坏的 PNG。 */
let _hasSips = undefined;
function hasSips() {
    if (_hasSips !== undefined) return _hasSips;
    try {
        execFileSync('sips', ['--version'], { stdio: 'ignore', timeout: 2000 });
        _hasSips = true;
    } catch {
        _hasSips = false;
    }
    return _hasSips;
}

function isReusableIcon(path) {
    let workDir;
    try {
        const { width, height } = pngDimensions(path, !hasSips());
        if (width !== height || width > 128) return false;
        if (hasSips()) {
            workDir = mkdtempSync(join(tmpdir(), 'glass-icon-check-'));
            execFileSync('sips', ['-s', 'format', 'png', path, '--out', join(workDir, 'decoded.png')],
                { stdio: 'ignore', timeout: 5000 });
        }
        return true;
    } catch {
        return false;
    } finally {
        if (workDir) rmSync(workDir, { recursive: true, force: true });
    }
}

/** 规范化为不超过 128×128 的正方形 PNG。官方素材包只读取指定条目。
 * @param {Buffer} inputBuffer
 * @param {string} destPath
 * @param {Pick<IconSource, 'entry' | 'cropSize'>} [options]
 */
function saveAsPng(inputBuffer, destPath, { entry, cropSize } = {}) {
    const workDir = mkdtempSync(join(dirname(destPath), '.icon-sync-'));
    const outputPath = join(workDir, 'output.png');
    try {
        if (entry) {
            const archive = join(workDir, 'official.zip');
            writeFileSync(archive, inputBuffer);
            inputBuffer = execFileSync('unzip', ['-p', archive, entry], { timeout: 5000 });
        }
        // XML 声明、导出注释和文档类型可能出现在 SVG 根元素前。
        const isSvg = inputBuffer.subarray(0, 512).toString('utf8').includes('<svg');
        const inputPath = join(workDir, isSvg ? 'input.svg' : 'input.bin');
        writeFileSync(inputPath, inputBuffer);
        if (!hasSips()) {
            if (isSvg || cropSize) return false;
            const { width, height } = pngDimensions(inputPath, true);
            if (width !== height || width > 128) return false;
            renameSync(inputPath, destPath);
            return true;
        }
        const runSips = args => execFileSync('sips', args, { stdio: 'ignore', timeout: 5000 });
        runSips(isSvg
            ? ['-s', 'format', 'png', '-Z', '128', inputPath, '--out', outputPath]
            : ['-s', 'format', 'png', inputPath, '--out', outputPath]);
        if (cropSize) {
            const side = String(cropSize);
            runSips(['--cropToHeightWidth', side, side, outputPath]);
        }
        let { width, height } = pngDimensions(outputPath);
        if (Math.max(width, height) > 128) {
            runSips(['-Z', '128', outputPath]);
            ({ width, height } = pngDimensions(outputPath));
        }
        if (width !== height) {
            const side = String(Math.max(width, height));
            runSips(['--padToHeightWidth', side, side, outputPath]);
        }
        ({ width, height } = pngDimensions(outputPath));
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

        /** @type {(IconSource & { source: string })[]} */
        const sources = candidates.map(candidate => ({
            url: `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent('https://' + candidate)}&size=128`,
            source: `Google S2 (${candidate})`
        }));
        const official = OFFICIAL_HOST_SOURCES.get(bareHost);
        if (official) sources.unshift({
            ...(typeof official === 'string' ? { url: official } : official),
            source: `Official Source (${bareHost})`
        });

        for (const { url, source, entry, referer, cropSize } of sources) {
            try {
                const buffer = await fetchRedirectBuffer(url, referer);
                if (saveAsPng(buffer, destPath, { entry, cropSize })) return { host: bareHost, success: true, source };
            } catch {}
        }

        return { host: bareHost, success: false, error: '所有来源均未生成可用 PNG' };
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
        console.log(`  ${c.yellow}⚠ 注意：有 ${failed.length} 个图标未能同步：${c.reset}`);
        failed.forEach(f => console.log(`    - ${f.host}: ${f.error}`));
        process.exitCode = 1;
    } else {
        console.log(`  ${c.green}✨ 全站 ${totalHosts} 个书签图标已就绪（复用 ${results.filter(r => r.source === 'local').length} 个，下载 ${results.filter(r => r.source !== 'local').length} 个）！${c.reset}`);
    }

    // 只更新已经有可用本地图标的引用。
    const readyHosts = new Set(results.filter(r => r.success).map(r => r.host));
    let updatedIconCount = 0;
    function updateIconField(bm) {
        if (!bm || !bm.url) return;
        const host = getBareHostname(bm.url);
        if (!readyHosts.has(host)) return;
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
        const stage = mkdtempSync(join(ROOT_DIR, '.icon-sync-'));
        try {
            const stagedBookmarks = join(stage, 'bookmarks.json');
            writeFileSync(stagedBookmarks, JSON.stringify(data, null, 4) + '\n',
                { encoding: 'utf-8', mode: statSync(BOOKMARKS_PATH).mode });
            if (readFileSync(BOOKMARKS_PATH, 'utf-8') !== rawData) {
                throw new Error('同步期间 bookmarks.json 已更新，请重新执行图标同步');
            }
            renameSync(stagedBookmarks, BOOKMARKS_PATH);
        } finally {
            rmSync(stage, { recursive: true, force: true });
        }
        console.log(`  ${c.green}✔${c.reset} 已规范 bookmarks.json 中 ${c.bold}${updatedIconCount}${c.reset} 处图标路径为 ./icons/{host}.png`);
    }

    console.log(`  ${c.green}✔${c.reset} bookmarks.json 单一真理源已生效，源码 src/js/config/constants.js 自动共享最新书签与图标`);
    console.log(`\n${c.cyan}${HR_DOUBLE}${c.reset}\n`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
