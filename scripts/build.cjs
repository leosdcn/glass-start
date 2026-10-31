const { watchFiles } = require('./watch.cjs');
const { replaceOnce, injectDocumentShell } = require('./html-template.cjs');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * ==============================================================================
 * Glass Start — 生产环境构建打包脚本 (build.cjs)
 * ==============================================================================
 * 从源码编译样式和 ES 模块，生成带版本指纹的 HTML、Service Worker 与静态资源。
 * 应用、内联脚本和样式统一使用 esbuild；编译或压缩失败即终止构建。
 */

// 终端格式化排版与 ANSI 彩色工具
const { c, HR_DOUBLE, logSection, logItem } = require('./terminal.cjs');

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
    staging: path.join(ROOT_DIR, '.dist_staging'),
    backup: path.join(ROOT_DIR, '.dist_backup'),
    bookmarksJson: path.join(ROOT_DIR, 'bookmarks.json'),
    pkgJson: path.join(ROOT_DIR, 'package.json'),
    license: path.join(ROOT_DIR, 'LICENSE'),
    sw: path.join(ROOT_DIR, 'sw.js'),
    public: path.join(ROOT_DIR, 'public')
};

// 生产构建全链路统一版本戳（用于 Service Worker 缓存池与 HTML 外链脚本防穿透对齐）
let currentBuildVersion = 'app-core-v' + Date.now();

// 构建性能与产物体积基线观测指标
let buildMetrics = {
    stages: { css: 0, assets: 0, js: 0, html: 0 },
    sizes: { cssKb: '0', jsKb: '0', htmlKb: '0', modules: 0 }
};

function resetBuildMetrics() {
    buildMetrics = {
        stages: { css: 0, assets: 0, js: 0, html: 0 },
        sizes: { cssKb: '0', jsKb: '0', htmlKb: '0', modules: 0 }
    };
}

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

// 1.2 目录与原子发布管理
function cleanDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function publishStagingToDist(stagingDir) {
    cleanDir(PATHS.backup);
    let distRenamed = false;
    let rollbackFailed = false;
    try {
        if (fs.existsSync(PATHS.dist)) {
            fs.renameSync(PATHS.dist, PATHS.backup);
            distRenamed = true;
        }
        fs.renameSync(stagingDir, PATHS.dist);
    } catch (err) {
        if (distRenamed && fs.existsSync(PATHS.backup) && !fs.existsSync(PATHS.dist)) {
            try {
                fs.renameSync(PATHS.backup, PATHS.dist);
            } catch (rollbackErr) {
                rollbackFailed = true;
                console.error(`\n  ${c.yellow}⚠️ 恢复上一版本产物失败，备份保留在: ${PATHS.backup}${c.reset}`, rollbackErr.message || rollbackErr);
            }
        }
        throw err;
    } finally {
        cleanDir(stagingDir);
        if (!rollbackFailed) {
            cleanDir(PATHS.backup);
        }
    }
}

// Tailwind 扫描 HTML、JS 及导入的样式；Watch 事件可能合并，不能只凭最后一个路径跳过编译。
function compileTailwindCss() {
    logSection('1/5', '📦 编译 Tailwind CSS 样式表 (v4 CLI)');

    const cssStart = Date.now();
    let cliBin;
    try {
        const cliPkg = require.resolve('@tailwindcss/cli/package.json', { paths: [ROOT_DIR] });
        cliBin = path.resolve(path.dirname(cliPkg), 'dist', 'index.mjs');
    } catch (e) {
        throw new Error(`未能找到本地 @tailwindcss/cli 依赖包，请先执行 npm install。\n(${e.message})`);
    }

    try {
        const cssContent = execFileSync(process.execPath, [cliBin, '-i', PATHS.srcCss, '-m'], {
            cwd: ROOT_DIR,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        if (!cssContent || !cssContent.trim()) throw new Error('Tailwind 编译输出为空样式');
        const cssDuration = Date.now() - cssStart;
        const cssKb = (Buffer.byteLength(cssContent, 'utf-8') / 1024).toFixed(2);
        buildMetrics.stages.css = cssDuration;
        buildMetrics.sizes.cssKb = cssKb;
        logItem(`扫描 src/styles/main.css 与组件模板 完成，原子化 CSS 静态编译就绪 (${cssKb} KB, 耗时 ${cssDuration}ms)`);
        return cssContent;
    } catch (err) {
        const errMsg = err.stderr ? String(err.stderr).trim() : (err.message || String(err));
        throw new Error(`Tailwind CSS 编译失败: ${errMsg}`);
    }
}

// 3. 处理并复制 Service Worker 底座脚本与静态资产
function buildServiceWorkerAndAssets(targetDir = PATHS.dist) {
    logSection('2/5', '📑 构建 Service Worker 与静态资产 (sw.js & assets)');
    const assetsStart = Date.now();
    
    // 3.1 Service Worker
    if (fs.existsSync(PATHS.sw)) {
        let swContent = fs.readFileSync(PATHS.sw, 'utf-8');
        swContent = swContent.replace(/const\s+(CORE_CACHE|CACHE)\s*=\s*['"][^'"]+['"];/, `const CORE_CACHE = '${currentBuildVersion}';`);
        fs.writeFileSync(path.join(targetDir, 'sw.js'), minifyJsCode(swContent), 'utf-8');
        logItem(`Service Worker 缓存版本已更新并压缩: ${c.cyan}${currentBuildVersion}${c.reset}`);
    }

    // 3.2 纯静态资产镜像同步 (public/ -> dist/，过滤系统与临时文件，采用 Copy-on-Write 克隆加速)
    if (fs.existsSync(PATHS.public)) {
        fs.cpSync(PATHS.public, targetDir, {
            recursive: true,
            mode: fs.constants.COPYFILE_FICLONE,
            filter: src => !src.endsWith('.DS_Store') && !src.endsWith('Thumbs.db')
        });
        const iconCount = fs.existsSync(path.join(PATHS.public, 'icons')) ? fs.readdirSync(path.join(PATHS.public, 'icons')).filter(f => f.endsWith('.png')).length : 0;
        const wpCount = fs.existsSync(path.join(PATHS.public, 'wallpapers')) ? fs.readdirSync(path.join(PATHS.public, 'wallpapers')).length : 0;
        logItem(`纯静态资源目录 public/ 已全量镜像同步至 dist/ (包含 ${iconCount} 个本地图标, ${wpCount} 个壁纸与 PWA/安全元数据)`);
    }

    fs.copyFileSync(PATHS.license, path.join(targetDir, 'LICENSE.txt'));

    buildMetrics.stages.assets = Date.now() - assetsStart;
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
function buildAppJavaScript({ testMode = false, extension = false, version = currentBuildVersion, outfile } = {}) {
    return esbuild.buildSync({
        entryPoints: [PATHS.srcMainJs],
        bundle: true,
        format: 'iife',
        minify: true,
        target: ['es2022'],
        charset: 'utf8',
        define: {
            'window.__GLASS_EXTENSION__': String(extension),
            ...(testMode ? {} : { 'window.__GLASS_TEST__': 'false' })
        },
        banner: { js: `window.__GLASS_BUILD_APP__="${version}";\n` },
        metafile: true,
        write: !!outfile,
        ...(outfile ? { outfile } : {})
    });
}

// 生成生产应用脚本。
function processProductionAppJs(targetDir = PATHS.dist, { extension = false } = {}) {
    logSection('4/5', '⚡ 提取并压缩生产脚本 (dist/app.js)');

    if (!fs.existsSync(PATHS.srcMainJs)) {
        throw new Error(`未能在 ${PATHS.srcMainJs} 中找到主入口模块`);
    }

    const jsStart = Date.now();
    try {
        const appJsFile = path.join(targetDir, 'app.js');
        const result = buildAppJavaScript({ outfile: appJsFile, extension });
        const appJsContent = fs.readFileSync(appJsFile, 'utf-8');
        const jsDuration = Date.now() - jsStart;
        const appJsBytes = Buffer.byteLength(appJsContent, 'utf-8');
        const appJsKb = (appJsBytes / 1024).toFixed(2);
        const moduleCount = result.metafile ? Object.keys(result.metafile.inputs).length : 0;
        buildMetrics.stages.js = jsDuration;
        buildMetrics.sizes.jsKb = appJsKb;
        buildMetrics.sizes.modules = moduleCount;
        logItem(`生产环境 dist/app.js ESM 模块依赖 AST 编译完成 (${appJsKb} KB, ${moduleCount} 个模块, 耗时 ${jsDuration}ms)`);
    } catch (e) {
        throw new Error(`esbuild 打包 src/js/main.js 失败: ${e.message}`);
    }
}

// 每轮解析配置及其间接依赖，保持首屏注入与运行时配置一致。
function injectThemeConfig(html, themePath = path.join(PATHS.src, 'js', 'config', 'themes.js')) {
    return injectHeadConfig(html, {
        marker: '/* INJECT_THEME_CONFIG */',
        entryPath: themePath,
        globalName: '__headThemes',
        binding: `const { APP_THEME_DARK: THEME_DARK, APP_THEME_LIGHT: THEME_LIGHT,
            PRESET_THEMES, PRESET_TINTS, PRESET_THEME_COLORS } = __headThemes;`
    });
}

// 首屏共享配置（壁纸、引擎、天气图标）从单一模块注入，避免内联副本与运行时漂移。
function injectHeadConfig(html, { marker, entryPath, globalName, binding }) {
    const result = esbuild.buildSync({
        entryPoints: [entryPath],
        bundle: true,
        write: false,
        format: 'iife',
        globalName,
        target: 'es2020',
        minify: true,
        charset: 'utf8'
    });
    const code = result.outputFiles[0].text + '\n' + binding;
    // 保护 HTML script 边界，同时保留字符串运行时值。
    return replaceOnce(html, marker, code.replace(/<\/script/gi, '<\\/script'));
}

// 5. 处理生产环境 index.html (替换内联 JS 为外链 dist/app.js，全量内嵌静态编译 Tailwind CSS 与 SVG 精灵)
function processProductionHtml(compiledCss, targetDir = PATHS.dist) {
    logSection('5/5', '🔧 处理生产环境页面 (dist/index.html)');
    const htmlStart = Date.now();
    let prodHtmlContent = fs.readFileSync(PATHS.srcIndexHtml, 'utf-8');
    const i18nBootstrap = esbuild.buildSync({
        stdin: { contents: `import { messages } from './src/js/config/locales/index.js'; import enCatalog from './src/js/config/locales/catalog-en.json'; import zhCatalog from './src/js/config/locales/catalog-zh-CN.json'; import { initializeI18n } from './src/js/core/i18n.js'; initializeI18n(messages); window.__GLASS_I18N__.catalogs = { en: enCatalog, 'zh-CN': zhCatalog };`, resolveDir: ROOT_DIR },
        bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, charset: 'utf8'
    }).outputFiles[0].text;
    prodHtmlContent = replaceOnce(prodHtmlContent, '<!-- INJECT_I18N_HEAD -->', `<script>${i18nBootstrap.replace(/<\/script/gi, '<\\/script')}</script>`);
    prodHtmlContent = injectHeadConfig(prodHtmlContent, {
        marker: '/* INJECT_BACKGROUNDS */',
        entryPath: path.join(PATHS.src, 'js', 'config', 'backgrounds.js'),
        globalName: '__headBackgrounds',
        binding: 'const { PRESET_BACKGROUNDS: backgrounds } = __headBackgrounds;'
    });
    prodHtmlContent = injectHeadConfig(prodHtmlContent, {
        marker: '/* INJECT_ENGINE_ICONS */',
        entryPath: path.join(PATHS.src, 'js', 'config', 'engine-head.js'),
        globalName: '__headEngines',
        binding: 'const { ENGINE_SVGS, ENGINE_META, DEFAULT_ENGINE } = __headEngines;'
    });
    prodHtmlContent = injectHeadConfig(prodHtmlContent, {
        marker: '/* INJECT_WEATHER_ICONS */',
        entryPath: path.join(PATHS.src, 'js', 'config', 'weather-icons.js'),
        globalName: '__headWeatherIcons',
        binding: 'const { WEATHER_EMOJI_MAP: m } = __headWeatherIcons;'
    });
    // 预渲染与运行时共用数值清洗模块。
    prodHtmlContent = injectHeadConfig(injectThemeConfig(prodHtmlContent), {
        marker: '/* INJECT_WEATHER_NUM */',
        entryPath: path.join(PATHS.src, 'js', 'utils', 'weather-data.js'),
        globalName: '__headWeather',
        binding: 'const { weatherNum } = __headWeather;'
    });

    prodHtmlContent = injectDocumentShell(prodHtmlContent, {
        css: compiledCss,
        svg: fs.readFileSync(PATHS.srcSvg, 'utf-8'),
        version: currentBuildVersion
    });

    // 品牌卡片版本号只由 package.json 提供。
    const { version } = JSON.parse(fs.readFileSync(PATHS.pkgJson, 'utf-8'));
    prodHtmlContent = replaceOnce(prodHtmlContent, '<!-- INJECT_APP_VERSION -->', `v${version}`);

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
    const htmlDuration = Date.now() - htmlStart;
    const htmlKb = (Buffer.byteLength(prodHtmlContent, 'utf-8') / 1024).toFixed(2);
    buildMetrics.stages.html = htmlDuration;
    buildMetrics.sizes.htmlKb = htmlKb;
    logItem(`生产环境 dist/index.html 零依赖压缩完成 (${htmlKb} KB, 耗时 ${htmlDuration}ms)`);

    // 🛡️ 构建断言（最终产物写盘前）：严禁残留任何 jsdelivr CDN 引用 ——
    // 生产 CSP 已剔除该域名，脚本或 CSP 白名单任一残留都会导致线上样式全挂且难以察觉，必须 fail build 阻断部署
    if (/jsdelivr/i.test(prodHtmlContent)) {
        throw new Error('构建断言失败: dist/index.html 最终产物中仍残留 jsdelivr CDN 引用，请检查 HTML 模板与构建注入内容');
    }

    // 🛡️ 构建断言（最终产物写盘前）：HTML 侧构建指纹必须存在且与 app.js 侧同源同版
    if (!prodHtmlContent.includes('__GLASS_BUILD_HTML__') || !prodHtmlContent.includes(`"${currentBuildVersion}"`)) {
        throw new Error('构建断言失败: dist/index.html 未注入构建指纹 (__GLASS_BUILD_HTML__)，运行时版本契约将失效');
    }

    fs.writeFileSync(path.join(targetDir, 'index.html'), prodHtmlContent, 'utf-8');
}

function getPathByteSize(itemPath) {
    try {
        const stat = fs.statSync(itemPath);
        if (stat.isDirectory()) {
            return fs.readdirSync(itemPath).reduce((acc, child) => {
                return acc + getPathByteSize(path.join(itemPath, child));
            }, 0);
        }
        return stat.size;
    } catch {
        return 0;
    }
}

// 6. 打印构建成功产物清单与耗时汇总
function printDistSummary(startTime) {
    const elapsed = Date.now() - startTime;
    console.log(`\n${c.gray}${HR_DOUBLE}${c.reset}`);
    console.log(`${c.green}${c.bold}✨ 生产打包成功！${c.reset}${c.dim} (总耗时: ${elapsed}ms)${c.reset}\n`);

    const { css, assets, js, html } = buildMetrics.stages;
    const { cssKb, jsKb, htmlKb, modules } = buildMetrics.sizes;
    console.log(`${c.cyan}⏱️  构建耗时与体积基线:${c.reset}`);
    console.log(`  阶段耗时: CSS ${css}ms · 资产同步 ${assets}ms · JS AST ${js}ms · HTML生成 ${html}ms`);
    console.log(`  核心体积: JS ${jsKb} KB (${modules} 个依赖模块) · CSS ${cssKb} KB (内联) · HTML ${htmlKb} KB\n`);

    console.log(`${c.cyan}📁 dist/ 构建产物清单:${c.reset}`);

    const files = fs.readdirSync(PATHS.dist).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    let totalBytes = 0;
    const items = files.map(file => {
        const fullPath = path.join(PATHS.dist, file);
        const stat = fs.statSync(fullPath);
        const isDir = stat.isDirectory();
        const size = isDir ? getPathByteSize(fullPath) : stat.size;
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

function executeBuild(targetDir, options = {}) {
    const compiledCss = compileTailwindCss();
    buildServiceWorkerAndAssets(targetDir);
    syncBookmarksData();
    processProductionAppJs(targetDir, options);
    processProductionHtml(compiledCss, targetDir);
}

// 主构建入口流程
function main() {
    const startTime = Date.now();
    currentBuildVersion = 'app-core-v' + startTime;
    resetBuildMetrics();

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

    cleanDir(PATHS.staging);
    fs.mkdirSync(PATHS.staging, { recursive: true });

    try {
        executeBuild(PATHS.staging);
        publishStagingToDist(PATHS.staging);
        printDistSummary(startTime);
    } catch (err) {
        cleanDir(PATHS.staging);
        console.error(`\n  ${c.yellow}❌ 构建失败（已保留上一版本正常产物）:${c.reset}\n`, err.message || err);
        process.exit(1);
    }
}

// 增量构建流程 (供 Watch Mode 与外部服务器调用)
function rebuild() {
    const startTime = Date.now();
    currentBuildVersion = 'app-core-v' + startTime;
    resetBuildMetrics();

    cleanDir(PATHS.staging);
    fs.mkdirSync(PATHS.staging, { recursive: true });

    try {
        executeBuild(PATHS.staging);
        publishStagingToDist(PATHS.staging);
        return {
            version: currentBuildVersion,
            duration: Date.now() - startTime
        };
    } catch (err) {
        cleanDir(PATHS.staging);
        throw err;
    }
}

// 独立监听模式
function startWatch(onRebuildSuccess, { label = 'Watch', delay = 80 } = {}) {
    if (label === 'Watch') {
        console.log(`\n${c.yellow}👀 开启文件修改自动构建监听模式 (Watch Mode)...${c.reset}`);
        console.log(`   ${c.dim}正在监听 src/, public/, bookmarks.json, package.json, LICENSE, sw.js ...${c.reset}\n`);
    }
    return watchFiles([
        { path: PATHS.src, name: 'src/' },
        { path: PATHS.public, name: 'public/' },
        { path: PATHS.bookmarksJson, name: 'bookmarks.json' },
        { path: PATHS.pkgJson, name: 'package.json' },
        { path: PATHS.license, name: 'LICENSE' },
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
    injectThemeConfig,
    buildAppJavaScript,
    executeBuild,
    PATHS
};

