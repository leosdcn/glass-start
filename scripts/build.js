const { watchFiles } = require('./watch.cjs');
const { replaceOnce, injectDocumentShell } = require('./html-template.cjs');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * ==============================================================================
 * Glass Start — 生产环境构建打包脚本 (build.js)
 * ==============================================================================
 * 从源码编译样式和 ES 模块，生成带版本指纹的 HTML、Service Worker 与静态资源。
 * 应用、内联脚本和样式统一使用 esbuild；编译或压缩失败即终止构建。
 */

// 终端格式化排版与 ANSI 彩色工具
const { c, HR_DOUBLE, logSection, logItem, LINE_WIDTH } = require('./terminal.cjs');

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
    sw: path.join(ROOT_DIR, 'sw.js'),
    public: path.join(ROOT_DIR, 'public')
};

// 生产构建全链路统一版本戳（用于 Service Worker 缓存池与 HTML 外链脚本防穿透对齐）
let currentBuildVersion = 'app-core-v' + Date.now();

// 构建统一使用 esbuild；编译或压缩失败直接报告，不使用正则降级。
const esbuild = require('esbuild');

function minifyJsCode(jsCode) {
    return esbuild.transformSync(jsCode, {
        minify: true,
        target: 'es2020',
        legalComments: 'none'
    }).code;
}

function minifyCssCode(cssCode) {
    return esbuild.transformSync(cssCode, {
        loader: 'css',
        minify: true,
        legalComments: 'none'
    }).code;
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

    try {
        const cssStart = Date.now();
        const cssContent = execSync(`npx -y @tailwindcss/cli@4 -i "${PATHS.srcCss}" -m`, {
            stdio: 'pipe', encoding: 'utf-8'
        });
        if (!cssContent.trim()) throw new Error('Tailwind returned empty CSS');
        const cssDuration = Date.now() - cssStart;
        const cssKb = (Buffer.byteLength(cssContent, 'utf-8') / 1024).toFixed(2);
        logItem(`扫描 src/styles/main.css 与组件模板 完成，原子化 CSS 静态编译就绪 (${cssKb} KB, 耗时 ${cssDuration}ms)`);
        return cssContent;
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

// 两种构建共用编译选项；生产在编译时裁掉测试入口，测试脚本只由测试服务器持有。
function buildAppJavaScript({ testMode = false, version = currentBuildVersion, outfile } = {}) {
    return esbuild.buildSync({
        entryPoints: [PATHS.srcMainJs],
        bundle: true,
        format: 'iife',
        minify: true,
        target: ['es2022'],
        charset: 'utf8',
        define: testMode ? {} : { 'window.__GLASS_TEST__': 'false' },
        banner: { js: `window.__GLASS_BUILD_APP__="${version}";\n` },
        metafile: true,
        write: !!outfile,
        ...(outfile ? { outfile } : {})
    });
}

// 生成生产应用脚本。
function processProductionAppJs() {
    logSection('4/5', '⚡ 提取并压缩生产脚本 (dist/app.js)');

    if (!fs.existsSync(PATHS.srcMainJs)) {
        console.error(`❌ 未能在 ${PATHS.srcMainJs} 中找到主入口模块`);
        process.exit(1);
    }

    try {
        buildAppJavaScript({ outfile: path.join(PATHS.dist, 'app.js') });
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
    return replaceOnce(html, marker, code.replace(/<\/script/gi, '<\\/script'));
}

// 预渲染内联同一数值清洗模块，避免复制 weatherNum 规则。
function injectWeatherNum(html) {
    const marker = '/* INJECT_WEATHER_NUM */';
    const result = esbuild.buildSync({
        entryPoints: [path.join(PATHS.src, 'js', 'utils', 'weather-data.js')],
        bundle: true,
        write: false,
        format: 'iife',
        globalName: '__headWeather',
        target: 'es2020',
        minify: true,
        charset: 'utf8'
    });
    const code = result.outputFiles[0].text + '\nconst { weatherNum } = __headWeather;';
    return replaceOnce(html, marker, code.replace(/<\/script/gi, '<\\/script'));
}

// 5. 处理生产环境 index.html (替换内联 JS 为外链 dist/app.js，全量内嵌静态编译 Tailwind CSS 与 SVG 精灵)
function processProductionHtml(compiledCss) {
    logSection('5/5', '🔧 处理生产环境页面 (dist/index.html)');
    let prodHtmlContent = injectWeatherNum(injectThemeConfig(fs.readFileSync(PATHS.srcIndexHtml, 'utf-8')));

    prodHtmlContent = injectDocumentShell(prodHtmlContent, {
        css: compiledCss,
        svg: fs.readFileSync(PATHS.srcSvg, 'utf-8'),
        version: currentBuildVersion
    });

    // 从 package.json 注入页面品牌卡片版本号。
    try {
        const pkgData = JSON.parse(fs.readFileSync(PATHS.pkgJson, 'utf-8'));
        if (pkgData && pkgData.version) {
            prodHtmlContent = prodHtmlContent.replace(
                /(<span[^>]*class="[^"]*rounded-full[^"]*"[^>]*>)v?[0-9]+\.[0-9]+\.[0-9]+(<\/span>)/i,
                `$1v${pkgData.version}$2`
            );
        }
    } catch {}

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
            const minified = minifyJsCode(content);
            return `<script${attrs}>${minified}</script>`;
        });

        return html;
    }
    prodHtmlContent = minifyInlineStylesAndScripts(prodHtmlContent);

    // 压缩 HTML 注释与空白，保留 style / script 内容边界。
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
    const compiledCss = compileTailwindCss();
    buildServiceWorkerAndAssets();
    syncBookmarksData();
    processProductionAppJs();
    processProductionHtml(compiledCss);

    printDistSummary(startTime);
}

// 增量构建流程 (供 Watch Mode 与外部服务器调用)
function rebuild(changedFile = 'source') {
    const startTime = Date.now();
    currentBuildVersion = 'app-core-v' + startTime;
    const compiledCss = compileTailwindCss();
    buildServiceWorkerAndAssets();
    syncBookmarksData();
    processProductionAppJs();
    processProductionHtml(compiledCss);
    return {
        version: currentBuildVersion,
        duration: Date.now() - startTime
    };
}

// 独立监听模式
function startWatch(onRebuildSuccess, { label = 'Watch', delay = 80 } = {}) {
    if (label === 'Watch') {
        console.log(`\n${c.yellow}👀 开启文件修改自动构建监听模式 (Watch Mode)...${c.reset}`);
        console.log(`   ${c.dim}正在监听 src/, public/, bookmarks.json, package.json, sw.js ...${c.reset}\n`);
    }
    return watchFiles([
        { path: PATHS.src, name: 'src/' },
        { path: PATHS.public, name: 'public/' },
        { path: PATHS.bookmarksJson, name: 'bookmarks.json' },
        { path: PATHS.pkgJson, name: 'package.json' },
        { path: PATHS.sw, name: 'sw.js' }
    ], { rebuild, onSuccess: onRebuildSuccess, label, delay });
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
    injectWeatherNum,
    buildAppJavaScript,
    PATHS
};

