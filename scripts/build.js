const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * ==============================================================================
 * Glass Start — 生产环境构建打包脚本 (build.js)
 * ==============================================================================
 * 从源码编译样式和 ES 模块，生成带版本指纹的 HTML、Service Worker 与静态资源。
 * 应用打包需要 esbuild；内联脚本和样式压缩失败时会记录警告并使用基础压缩。
 */

// 终端格式化排版与 ANSI 彩色工具
const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
    reset: isTTY ? '\x1b[0m' : '',
    bold: isTTY ? '\x1b[1m' : '',
    dim: isTTY ? '\x1b[2m' : '',
    cyan: isTTY ? '\x1b[36m' : '',
    green: isTTY ? '\x1b[32m' : '',
    yellow: isTTY ? '\x1b[33m' : '',
    blue: isTTY ? '\x1b[34m' : '',
    magenta: isTTY ? '\x1b[35m' : '',
    gray: isTTY ? '\x1b[90m' : '',
};

const LINE_WIDTH = 72;
const HR_DOUBLE = '═'.repeat(LINE_WIDTH);
const HR_SINGLE = '─'.repeat(LINE_WIDTH);

/**
 * 计算终端文本实际视觉展示宽度（兼容中文字符与 Emoji 占位）
 */
function getVisualWidth(str) {
    const clean = str.replace(/\x1b\[[0-9;]*m/g, '');
    let width = 0;
    for (const ch of clean) {
        const code = ch.codePointAt(0);
        if (code >= 0xFE00 && code <= 0xFE0F) continue; // Variation Selectors
        if (code === 0x200D) continue; // Zero-width Joiner
        if (code > 0x7f) {
            width += 2;
        } else {
            width += 1;
        }
    }
    return width;
}

/**
 * 打印带横行分隔符的构建阶段标题
 */
function logSection(step, title) {
    const prefix = `─── [${step}] ${title} `;
    const visualLen = getVisualWidth(prefix);
    const fillLen = Math.max(4, LINE_WIDTH - visualLen);
    const trailingLine = '─'.repeat(fillLen);
    console.log(`\n${c.cyan}─── [${step}] ${title} ${c.gray}${trailingLine}${c.reset}`);
}

/**
 * 打印阶段子步骤项
 */
function logItem(msg, status = 'ok') {
    const icon = status === 'ok' ? `${c.green}✔${c.reset}`
               : status === 'warn' ? `${c.yellow}⚠${c.reset}`
               : status === 'info' ? `${c.cyan}ℹ${c.reset}`
               : `${c.green}✅${c.reset}`;
    console.log(`  ${icon} ${msg}`);
}

// 路径常量定义
const ROOT_DIR = path.resolve(__dirname, '..');
const PATHS = {
    root: ROOT_DIR,
    src: path.join(ROOT_DIR, 'src'),
    srcIndexHtml: path.join(ROOT_DIR, 'src', 'index.html'),
    srcCss: path.join(ROOT_DIR, 'src', 'styles', 'main.css'),
    srcSvg: path.join(ROOT_DIR, 'src', 'svg', 'sprite.svg'),
    srcMainJs: path.join(ROOT_DIR, 'src', 'js', 'main.js'),
    srcConstants: path.join(ROOT_DIR, 'src', 'js', 'config', 'constants.js'),
    dist: path.join(ROOT_DIR, 'dist'),
    bookmarksJson: path.join(ROOT_DIR, 'bookmarks.json'),
    pkgJson: path.join(ROOT_DIR, 'package.json'),
    readme: path.join(ROOT_DIR, 'README.md'),
    sw: path.join(ROOT_DIR, 'sw.js'),
    public: path.join(ROOT_DIR, 'public')
};

// 生产构建全链路统一版本戳（用于 Service Worker 缓存池与 HTML 外链脚本防穿透对齐）
let currentBuildVersion = 'app-core-v' + Date.now();

// 引入 esbuild 编译器（具备优雅降级能力）
let esbuild;
try {
    esbuild = require('esbuild');
} catch {
    esbuild = null;
}

// 生产环境 JS 标准安全压缩（优先使用 esbuild AST 编译，未安装时自动回退至零依赖正则压缩）
function minifyJsCode(jsCode, filename = 'script.js') {
    if (esbuild && typeof esbuild.transformSync === 'function') {
        try {
            const result = esbuild.transformSync(jsCode, {
                minify: true,
                target: 'es2020',
                legalComments: 'none'
            });
            return result.code;
        } catch (e) {
            logItem(`esbuild 压缩 ${filename} 时出现警告，自动回退到基础正则压缩: ${e.message}`, 'warn');
        }
    }
    return jsCode
        .replace(/^\s*\/\/[^\n]*/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .join('\n');
}

// 生产环境 CSS 极致安全压缩（优先使用 esbuild CSS 编译器，未安装时自动回退至高精度正则压缩）
function minifyCssCode(cssCode) {
    if (esbuild && typeof esbuild.transformSync === 'function') {
        try {
            const result = esbuild.transformSync(cssCode, {
                loader: 'css',
                minify: true,
                legalComments: 'none'
            });
            return result.code;
        } catch (e) {
            logItem(`esbuild 压缩 CSS 时出现警告，自动回退到基础正则压缩: ${e.message}`, 'warn');
        }
    }
    return cssCode
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([\{\}\:\;\,\>\+\~])\s*/g, '$1')
        .replace(/;}/g, '}')
        .trim();
}

// 1.1 构建前依赖自检
function checkTailwindInstalled() {
    const pkgJsonPath = path.join(PATHS.root, 'node_modules', 'tailwindcss', 'package.json');
    try {
        return !!(require(pkgJsonPath).version);
    } catch {
        return false;
    }
}

// 1.2 准备 dist 目录
function initDistDir() {
    if (fs.existsSync(PATHS.dist)) {
        fs.rmSync(PATHS.dist, { recursive: true, force: true });
    }
    fs.mkdirSync(PATHS.dist, { recursive: true });
}

// 2. 编译 Tailwind CSS (v4 CLI)
function compileTailwindCss() {
    logSection('1/5', '📦 编译 Tailwind CSS 样式表 (v4 CLI)');
    const distStyleCss = path.join(PATHS.dist, 'style.css');

    try {
        const cssStart = Date.now();
        execSync(`npx -y @tailwindcss/cli@4 -i "${PATHS.srcCss}" -o "${distStyleCss}" -m`, {
            stdio: 'pipe'
        });
        const cssDuration = Date.now() - cssStart;
        const cssKb = (fs.statSync(distStyleCss).size / 1024).toFixed(2);
        logItem(`扫描 src/styles/main.css 与组件模板 完成，原子化 CSS 静态编译就绪 (${cssKb} KB, 耗时 ${cssDuration}ms)`);
    } catch (err) {
        console.error(`\n  ${c.yellow}❌ Tailwind CSS 编译失败:${c.reset}`, err.message || err);
        if (/can't resolve 'tailwindcss'|cannot find module 'tailwindcss'|module not found/i.test(String(err.message || ''))) {
            console.error('');
            console.error('   💡 提示：未能从项目目录解析到 tailwindcss 依赖包。');
            console.error('      请先在项目根目录执行 `npm install`，或删除 node_modules 后重新安装再试。');
        }
        process.exit(1);
    }
}

// 3. 处理并复制 Service Worker 底座脚本与静态资产
function buildServiceWorkerAndAssets() {
    logSection('2/5', '📑 构建 Service Worker 与静态资产 (sw.js & assets)');
    
    // 3.1 Service Worker
    if (fs.existsSync(PATHS.sw)) {
        let swContent = fs.readFileSync(PATHS.sw, 'utf-8');
        swContent = swContent.replace(/const\s+(CORE_CACHE|CACHE)\s*=\s*['"][^'"]+['"];/, `const CORE_CACHE = '${currentBuildVersion}';`);
        fs.writeFileSync(path.join(PATHS.dist, 'sw.js'), swContent, 'utf-8');
        logItem(`Service Worker 缓存版本已更新: ${c.cyan}${currentBuildVersion}${c.reset}`);
    }

    // 3.2 纯静态资产镜像同步 (public/ -> dist/)
    if (fs.existsSync(PATHS.public)) {
        fs.cpSync(PATHS.public, PATHS.dist, { recursive: true });
        const iconCount = fs.existsSync(path.join(PATHS.public, 'icons')) ? fs.readdirSync(path.join(PATHS.public, 'icons')).filter(f => f.endsWith('.png')).length : 0;
        const wpCount = fs.existsSync(path.join(PATHS.public, 'wallpapers')) ? fs.readdirSync(path.join(PATHS.public, 'wallpapers')).length : 0;
        logItem(`纯静态资源目录 public/ 已全量镜像同步至 dist/ (包含 ${iconCount} 个本地图标, ${wpCount} 个壁纸与 PWA/安全元数据)`);
    }
}

// 4. 自动数据校验机制 (bookmarks.json 作为单一真理源直接被 constants.js 导入)
function syncBookmarksData() {
    logSection('3/5', '🔄 校验书签默认数据 (bookmarks.json 单一真理源)');

    if (fs.existsSync(PATHS.bookmarksJson) && fs.existsSync(PATHS.srcConstants)) {
        try {
            const bookmarksData = JSON.parse(fs.readFileSync(PATHS.bookmarksJson, 'utf-8'));
            const bmCount = Array.isArray(bookmarksData.bookmarks) ? bookmarksData.bookmarks.length : 0;
            const catCount = Array.isArray(bookmarksData.categories) ? bookmarksData.categories.length : 0;
            logItem(`根目录 bookmarks.json 格式合法 (${bmCount} 个常用书签, ${catCount} 个导航分类)`);
            logItem(`源码 src/js/config/constants.js 已原生引入 bookmarks.json，单一真理源自动生效`);
        } catch (e) {
            logItem(`校验默认书签时出现警告: ${e.message}`, 'warn');
        }
    }
}

// 4.9 处理生成生产环境 dist/app.js (ESM 打包与 AST 压缩)
function processProductionAppJs() {
    logSection('4/5', '⚡ 提取并压缩生产脚本 (dist/app.js)');

    if (!fs.existsSync(PATHS.srcMainJs)) {
        console.error(`❌ 未能在 ${PATHS.srcMainJs} 中找到主入口模块`);
        process.exit(1);
    }

    try {
        esbuild.buildSync({
            entryPoints: [PATHS.srcMainJs],
            bundle: true,
            format: 'iife',
            minify: true,
            target: ['es2022'],
            charset: 'utf8',
            banner: {
                js: `window.__GLASS_BUILD_APP__="${currentBuildVersion}";\n`
            },
            outfile: path.join(PATHS.dist, 'app.js')
        });
        const appJsContent = fs.readFileSync(path.join(PATHS.dist, 'app.js'), 'utf-8');
        const appJsKb = (Buffer.byteLength(appJsContent, 'utf-8') / 1024).toFixed(2);
        logItem(`生产环境 dist/app.js ESM 模块依赖 AST 编译完成 (${appJsKb} KB)`);
    } catch (e) {
        console.error(`❌ esbuild 打包 src/js/main.js 失败: ${e.message}`);
        process.exit(1);
    }
}

// 同步首屏与运行时共用 themes.js；每次构建重新读取，避免 Watch 模式缓存旧配置。
function injectThemeConfig(html, themePath = path.join(PATHS.src, 'js', 'config', 'themes.js')) {
    const marker = '/* INJECT_THEME_CONFIG */';
    if (html.split(marker).length !== 2) {
        throw new Error('首屏主题配置注入标记必须出现一次');
    }
    const result = esbuild.buildSync({
        entryPoints: [themePath],
        bundle: true,
        write: false,
        format: 'iife',
        globalName: '__headThemes',
        target: 'es2020',
        minify: true,
        charset: 'utf8'
    });
    const code = result.outputFiles[0].text + `
        const { APP_THEME_DARK: THEME_DARK, APP_THEME_LIGHT: THEME_LIGHT,
            PRESET_THEMES, PRESET_TINTS } = __headThemes;
    `;
    // 保护 HTML script 边界，同时保留字符串运行时值。
    return html.replace(marker, () => code.replace(/<\/script/gi, '<\\/script'));
}

// 5. 处理生产环境 index.html (替换内联 JS 为外链 dist/app.js，全量内嵌静态编译 Tailwind CSS 与 SVG 精灵)
function processProductionHtml() {
    logSection('5/5', '🔧 处理生产环境页面 (dist/index.html)');
    let prodHtmlContent = injectThemeConfig(fs.readFileSync(PATHS.srcIndexHtml, 'utf-8'));

    // 5.0 彻底移除开发模式下的原生 ESM 模块入口
    prodHtmlContent = prodHtmlContent.replace(
        /<!--\s*引入原生 ES Module 主应用入口\s*-->\s*<script\s+type="module"\s+src="[^"]*"><\/script>/i,
        ''
    );
    prodHtmlContent = prodHtmlContent.replace(
        /<script\s+type="module"\s+src="[^"]*"><\/script>/i,
        ''
    );

    // 5.0.1 在 <meta charset="UTF-8"> 之后按标准原生声明双端构建指纹与核心脚本 (<script defer>)：
    prodHtmlContent = prodHtmlContent.replace(
        /(<meta\s+charset=["']?utf-8["']?[^>]*>)/i,
        `$1<script>window.__GLASS_BUILD_HTML__="${currentBuildVersion}"</script><script src="./app.js?v=${currentBuildVersion}" defer></script>`
    );

    // 5.0.2 单一真理源：自动将 package.json 中的版本号注入到 index.html 品牌卡片徽章与 README.md 版本徽章中
    try {
        const pkgData = JSON.parse(fs.readFileSync(PATHS.pkgJson, 'utf-8'));
        if (pkgData && pkgData.version) {
            prodHtmlContent = prodHtmlContent.replace(
                /(<span[^>]*class="[^"]*rounded-full[^"]*"[^>]*>)v?[0-9]+\.[0-9]+\.[0-9]+(<\/span>)/i,
                `$1v${pkgData.version}$2`
            );

            // 同步对齐 README.md 顶部版本号徽章 (Shields.io 徽章单一真理源自动同步)
            if (fs.existsSync(PATHS.readme)) {
                let readmeContent = fs.readFileSync(PATHS.readme, 'utf-8');
                const nextReadme = readmeContent.replace(
                    /(badge\/version-v)[0-9]+\.[0-9]+\.[0-9]+(-blue\.svg)/i,
                    `$1${pkgData.version}$2`
                );
                if (nextReadme !== readmeContent) {
                    fs.writeFileSync(PATHS.readme, nextReadme, 'utf-8');
                    logItem(`README.md 版本号徽章已自动同步对齐: ${c.cyan}v${pkgData.version}${c.reset}`);
                }
            }
        }
    } catch {}

    // 5.0.3 注入全局 SVG 精灵池 (若存在 src/svg/sprite.svg)
    if (fs.existsSync(PATHS.srcSvg)) {
        const svgSprite = fs.readFileSync(PATHS.srcSvg, 'utf-8');
        if (prodHtmlContent.includes('<!-- INJECT_SVG_SPRITE -->')) {
            prodHtmlContent = prodHtmlContent.replace('<!-- INJECT_SVG_SPRITE -->', svgSprite);
        } else if (!prodHtmlContent.includes('id="svg-sprite"')) {
            prodHtmlContent = prodHtmlContent.replace(/<body\b[^>]*>/i, (m) => `${m}\n    ${svgSprite}`);
        }
    }

    const distCssPath = path.join(PATHS.dist, 'style.css');
    let cssContent = '';
    if (fs.existsSync(distCssPath)) {
        cssContent = fs.readFileSync(distCssPath, 'utf-8');
        // 🛡️ 安全防御：避免 CSS 内容（如 content: "</style>"）意外转义提前闭合 HTML <style> 标签引发 XSS/页面崩溃
        cssContent = cssContent.replace(/<\/style>/gi, '\\3c/style>');
        const cssKb = (fs.statSync(distCssPath).size / 1024).toFixed(2);
        logItem(`全量内嵌静态 Tailwind CSS (${cssKb} KB，已完成防注入安全转义)`);
        fs.unlinkSync(distCssPath);
    }

    const linkStylePattern = /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["'][^"']*styles\/main\.css["'][^>]*>/i;
    const replaceTarget = `<!-- 内嵌静态编译 Tailwind CSS 样式表 (零网络 RTT 请求，消除渲染阻塞，极速秒开 & 100% 离线支持) -->\n    <style>${cssContent}</style>`;
    prodHtmlContent = prodHtmlContent.replace(linkStylePattern, () => replaceTarget);

    // 5.1 对 HTML 中所有的 <style> 和 <script> 标签内容进行全面压缩
    function minifyInlineStylesAndScripts(html) {
        // 压缩所有 <style> 块
        html = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, content) => {
            const minified = minifyCssCode(content);
            return `<style${attrs}>${minified}</style>`;
        });

        // 压缩所有 <script> 块
        html = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, content) => {
            if (/type=["']application\/ld\+json["']/i.test(attrs)) {
                try {
                    return `<script${attrs}>${JSON.stringify(JSON.parse(content))}</script>`;
                } catch {
                    return match;
                }
            }
            const minified = minifyJsCode(content, 'inline.js');
            return `<script${attrs}>${minified}</script>`;
        });

        return html;
    }
    prodHtmlContent = minifyInlineStylesAndScripts(prodHtmlContent);

    // 5.2 生产环境 CSP 优化：确保剔除任何冗余 CDN 域名
    prodHtmlContent = prodHtmlContent.replace(
        /script-src\s+([^;]+);/i,
        (match, domains) => {
            const cleanDomains = domains
                .split(/\s+/)
                .filter(d => d && !d.includes('cdn.tailwindcss.com') && !d.includes('cdn.jsdelivr.net'))
                .join(' ');
            return `script-src ${cleanDomains};`;
        }
    );
    logItem('已完成生产环境 CSP 策略优化 (剔除冗余 CDN 域名)');

    // 5.3 自动转译应用图标（现代浏览器使用原生 🪐 SVG Data URI，Safari/iOS 使用标准 180x180 PNG）
    const iconDataUrl = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Ctext%20y='.9em'%20font-size='90'%3E🪐%3C/text%3E%3C/svg%3E";
    prodHtmlContent = prodHtmlContent.replace(/<link\s+[^>]*rel=["']icon["'][^>]*>/i, () => `<link rel="icon" type="image/svg+xml" href="${iconDataUrl}">`);
    prodHtmlContent = prodHtmlContent.replace(/<link\s+[^>]*rel=["']apple-touch-icon["'][^>]*>/i, () => `<link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png">`);

    // 5.4 生产环境 HTML 零依赖极致压缩（全量清除 HTML 注释与多余空白缩进，保护 <style> 与 <script> 块）
    function minifyHtml(htmlStr) {
        htmlStr = htmlStr.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
        const parts = htmlStr.split(/(<(?:style|script)[\s\S]*?<\/(?:style|script)>)/i);
        const minified = parts.map(part => {
            if (/^<(?:style|script)/i.test(part)) return part;
            return part.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
        }).join('');
        return minified.trim();
    }
    prodHtmlContent = minifyHtml(prodHtmlContent);
    const htmlKb = (Buffer.byteLength(prodHtmlContent, 'utf-8') / 1024).toFixed(2);
    logItem(`生产环境 dist/index.html 零依赖压缩完成 (${htmlKb} KB)`);

    // 🛡️ 构建断言（最终产物写盘前）：严禁残留任何 jsdelivr CDN 引用 ——
    // 生产 CSP 已剔除该域名，脚本或 CSP 白名单任一残留都会导致线上样式全挂且难以察觉，必须 fail build 阻断部署
    if (/jsdelivr/i.test(prodHtmlContent)) {
        console.error('❌ 构建断言失败: dist/index.html 最终产物中仍残留 jsdelivr CDN 引用，请检查 Tailwind CDN 替换（5.0）与 CSP 清理（5.2）逻辑');
        process.exit(1);
    }

    // 🛡️ 构建断言（最终产物写盘前）：HTML 侧构建指纹必须存在且与 app.js 侧同源同版
    if (!prodHtmlContent.includes('__GLASS_BUILD_HTML__') || !prodHtmlContent.includes(`"${currentBuildVersion}"`)) {
        console.error('❌ 构建断言失败: dist/index.html 未注入构建指纹 (__GLASS_BUILD_HTML__)，运行时版本契约将失效');
        process.exit(1);
    }

    fs.writeFileSync(path.join(PATHS.dist, 'index.html'), prodHtmlContent, 'utf-8');
}

// 6. 打印构建成功产物清单与耗时汇总
function printDistSummary(startTime) {
    const elapsed = Date.now() - startTime;
    console.log(`\n${c.gray}${HR_DOUBLE}${c.reset}`);
    console.log(`${c.green}${c.bold}✨ 生产打包成功！${c.reset}${c.dim} (总耗时: ${elapsed}ms)${c.reset}\n`);
    console.log(`${c.cyan}📁 dist/ 构建产物清单:${c.reset}`);

    const files = fs.readdirSync(PATHS.dist).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    let totalBytes = 0;
    const items = files.map(file => {
        const fullPath = path.join(PATHS.dist, file);
        const stat = fs.statSync(fullPath);
        const isDir = stat.isDirectory();
        let size = stat.size;
        if (isDir) {
            try {
                const subFiles = fs.readdirSync(fullPath);
                size = subFiles.reduce((acc, sub) => acc + fs.statSync(path.join(fullPath, sub)).size, 0);
            } catch {}
        }
        totalBytes += size;
        const kbStr = (size / 1024).toFixed(2) + ' KB';
        const displayName = isDir ? `${file}/ (目录)` : file;
        return { displayName, kbStr };
    });

    const maxNameLen = Math.max(...items.map(it => it.displayName.length), 20);

    items.forEach((item, index) => {
        const isLast = index === items.length - 1;
        const branch = isLast ? '└──' : '├──';
        const paddedName = item.displayName.padEnd(maxNameLen + 2, ' ');
        const paddedSize = item.kbStr.padStart(10, ' ');
        console.log(`  ${c.gray}${branch}${c.reset} ${c.bold}${paddedName}${c.reset}${c.cyan}${paddedSize}${c.reset}`);
    });

    const totalKbStr = (totalBytes / 1024).toFixed(2) + ' KB';
    console.log(`\n  ${c.dim}总大小: ${totalKbStr} | 产物目录: dist/${c.reset}`);
    console.log(`\n${c.yellow}💡 部署提示:${c.reset} 部署时只需将 ${c.bold}dist/${c.reset} 文件夹下的内容上传至 GitHub Pages / Cloudflare Pages 即可！`);
    console.log(`${c.gray}${HR_DOUBLE}${c.reset}\n`);
}

// 主构建入口流程
function main() {
    const startTime = Date.now();
    currentBuildVersion = 'app-core-v' + startTime;

    console.log(`\n${c.cyan}${HR_DOUBLE}${c.reset}`);
    console.log(`${c.bold}${c.cyan}🚀 Glass Start — 生产环境构建打包 (Production Build)${c.reset}`);
    console.log(`${c.cyan}${HR_DOUBLE}${c.reset}`);

    if (!checkTailwindInstalled()) {
        console.error(`\n${c.yellow}❌ 未检测到 Tailwind CSS 依赖 (node_modules/tailwindcss)。${c.reset}`);
        console.error('');
        console.error('   请在项目根目录先安装依赖（包含 devDependencies 中的 tailwindcss）：');
        console.error('');
        console.error(`       ${c.bold}npm install${c.reset}`);
        console.error('');
        console.error('   若已安装过仍报此错，可尝试删除 node_modules 后重新安装：');
        console.error('');
        console.error(`       ${c.bold}rm -rf node_modules && npm install${c.reset}`);
        console.error('');
        console.error('   💡 提示：从 GitHub 下载的 ZIP 或新克隆的仓库不包含 node_modules，需先执行上述安装步骤。');
        process.exit(1);
    }

    initDistDir();
    compileTailwindCss();
    buildServiceWorkerAndAssets();
    syncBookmarksData();
    processProductionAppJs();
    processProductionHtml();

    printDistSummary(startTime);
}

// 增量构建流程 (供 Watch Mode 与外部服务器调用)
function rebuild(changedFile = 'source') {
    const startTime = Date.now();
    currentBuildVersion = 'app-core-v' + startTime;
    compileTailwindCss();
    buildServiceWorkerAndAssets();
    syncBookmarksData();
    processProductionAppJs();
    processProductionHtml();
    return {
        version: currentBuildVersion,
        duration: Date.now() - startTime
    };
}

// 独立监听模式
function startWatch(onRebuildSuccess) {
    console.log(`\n${c.yellow}👀 开启文件修改自动构建监听模式 (Watch Mode)...${c.reset}`);
    console.log(`   ${c.dim}正在监听 index.html, bookmarks.json, sw.js, manifest.json 等修改...${c.reset}\n`);
    let watchTimer = null;
    const triggerRebuild = (filename) => {
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
            console.log(`\n${c.magenta}📝 [Watch] 检测到文件修改: ${filename}，正在重新增量编译 dist/ ...${c.reset}`);
            try {
                const result = rebuild(filename);
                console.log(`  ${c.green}✔ [Watch] 增量编译完成！版本: ${c.cyan}${result.version}${c.reset}${c.green} (耗时: ${result.duration}ms)${c.reset}\n`);
                if (typeof onRebuildSuccess === 'function') {
                    onRebuildSuccess(result);
                }
            } catch (err) {
                console.error(`  ${c.yellow}❌ [Watch] 增量编译失败:${c.reset}`, err.message || err);
            }
        }, 80);
    };

    const watchers = [];
    const files = [
        { path: PATHS.srcIndexHtml, name: 'index.html' },
        { path: PATHS.bookmarksJson, name: 'bookmarks.json' },
        { path: PATHS.sw, name: 'sw.js' }
    ];

    files.forEach(({ path: filePath, name }) => {
        if (fs.existsSync(filePath)) {
            try {
                const w = fs.watch(filePath, () => triggerRebuild(name));
                watchers.push(w);
            } catch (e) {
                console.warn(`  ${c.yellow}⚠ 无法监听文件 ${name}: ${e.message}${c.reset}`);
            }
        }
    });

    if (fs.existsSync(PATHS.public)) {
        try {
            const w = fs.watch(PATHS.public, { recursive: true }, (eventType, filename) => triggerRebuild(`public/${filename}`));
            watchers.push(w);
        } catch (e) {
            console.warn(`  ${c.yellow}⚠ 无法监听 public 目录: ${e.message}${c.reset}`);
        }
    }

    if (fs.existsSync(PATHS.src)) {
        try {
            const w = fs.watch(PATHS.src, { recursive: true }, (eventType, filename) => triggerRebuild(`src/${filename}`));
            watchers.push(w);
        } catch (e) {
            console.warn(`  ${c.yellow}⚠ 无法监听 src 目录: ${e.message}${c.reset}`);
        }
    }

    return () => {
        watchers.forEach(w => {
            try { w.close(); } catch {}
        });
    };
}

if (require.main === module) {
    main();

    // 监听模式 (--watch)
    if (process.argv.includes('--watch')) {
        startWatch();
    }
}

module.exports = {
    main,
    rebuild,
    startWatch,
    checkTailwindInstalled,
    injectThemeConfig,
    PATHS
};

