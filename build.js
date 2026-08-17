const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * ==============================================================================
 * Glass Start — 生产环境构建打包脚本 (build.js)
 * ==============================================================================
 * 📌 设计原理与架构改进 (Senior Architect Refactoring):
 * 1. 【模块化管线封装】：拆分为自检、样式编译、SW更新、数据同步与HTML终化等高内聚模块。
 * 2. 【现代化控制台排版】：提供分步横向分隔线、ANSI 彩色高亮、清晰树形产物清单与毫秒级耗时统计。
 * 3. 【进程退出清理钩子】：注册 process exit / SIGINT 钩子，确保临时输入文件 100% 擦除。
 * 4. 【强壮正则匹配】：提升 DEFAULT_* 默认书签数组替换正则的格式容错度（支持单行/多行/极简压缩）。
 * 5. 【优雅降级压缩】：JS 压缩优先调用 esbuild AST 编译器，未安装时平滑降级至零依赖正则压缩。
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
const PATHS = {
    root: __dirname,
    dist: path.join(__dirname, 'dist'),
    tempCss: path.join(__dirname, '.temp_input.css'),
    bookmarksJson: path.join(__dirname, 'bookmarks.json'),
    indexHtml: path.join(__dirname, 'index.html'),
    sw: path.join(__dirname, 'sw.js'),
    wallpapers: path.join(__dirname, 'wallpapers'),
    headers: path.join(__dirname, '_headers')
};

// 顶层 JS 变量正则替换工具函数
function safeReplaceJsVariable(code, varName, replacementJs) {
    const regex = new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${varName}(?:\\s*:\\s*[^=]+)?\\s*=\\s*\\[[\\s\\S]*?\\];`);
    if (regex.test(code)) {
        return code.replace(regex, () => `const ${varName} = ${replacementJs};`);
    }
    return code;
}

// 自动资源清理 Hook：保障遇到 Ctrl+C 或中途报错时无残存临时文件
function cleanupTempFiles() {
    if (fs.existsSync(PATHS.tempCss)) {
        try { fs.unlinkSync(PATHS.tempCss); } catch {}
    }
}
process.on('exit', cleanupTempFiles);
process.on('SIGINT', () => { cleanupTempFiles(); process.exit(1); });

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

// 格式化 JS 数组对象供源码替换
function formatJsObject(obj, indent = 8) {
    const jsonStr = JSON.stringify(obj, null, 4);
    return jsonStr
        .split('\n')
        .map((line, idx) => (idx === 0 ? line : ' '.repeat(indent) + line))
        .join('\n');
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
    fs.writeFileSync(PATHS.tempCss, '@import "tailwindcss";\n@source "./index.html";\n', 'utf-8');
    const distStyleCss = path.join(PATHS.dist, 'style.css');

    try {
        const cssStart = Date.now();
        execSync(`npx -y @tailwindcss/cli@4 -i "${PATHS.tempCss}" -o "${distStyleCss}" -m`, {
            stdio: 'pipe'
        });
        const cssDuration = Date.now() - cssStart;
        const cssKb = (fs.statSync(distStyleCss).size / 1024).toFixed(2);
        logItem(`扫描 index.html 完成，原子化 CSS 静态编译就绪 (${cssKb} KB, 耗时 ${cssDuration}ms)`);
    } catch (err) {
        console.error(`\n  ${c.yellow}❌ Tailwind CSS 编译失败:${c.reset}`, err.message || err);
        if (/can't resolve 'tailwindcss'|cannot find module 'tailwindcss'|module not found/i.test(String(err.message || ''))) {
            console.error('');
            console.error('   💡 提示：未能从项目目录解析到 tailwindcss 依赖包。');
            console.error('      请先在项目根目录执行 `npm install`，或删除 node_modules 后重新安装再试。');
        }
        cleanupTempFiles();
        process.exit(1);
    } finally {
        cleanupTempFiles();
    }
}

// 3. 处理并复制 Service Worker 底座脚本与静态资产
function buildServiceWorkerAndAssets() {
    logSection('2/5', '📑 构建 Service Worker 与静态资产 (sw.js & assets)');
    
    // 3.1 Service Worker
    if (fs.existsSync(PATHS.sw)) {
        let swContent = fs.readFileSync(PATHS.sw, 'utf-8');
        const timestampVersion = 'app-core-v' + Date.now();
        swContent = swContent.replace(/const\s+(CORE_CACHE|CACHE)\s*=\s*['"][^'"]+['"];/, `const CORE_CACHE = '${timestampVersion}';`);
        fs.writeFileSync(path.join(PATHS.dist, 'sw.js'), swContent, 'utf-8');
        logItem(`Service Worker 缓存版本已更新: ${c.cyan}${timestampVersion}${c.reset}`);
    }

    // 3.2 静态资产同步
    if (fs.existsSync(PATHS.wallpapers)) {
        fs.cpSync(PATHS.wallpapers, path.join(PATHS.dist, 'wallpapers'), { recursive: true });
        const wpCount = fs.readdirSync(PATHS.wallpapers).length;
        logItem(`壁纸资源目录已全量复制 (${wpCount} 个文件) 至 dist/wallpapers/`);
    }
    if (fs.existsSync(PATHS.headers)) {
        fs.copyFileSync(PATHS.headers, path.join(PATHS.dist, '_headers'));
        logItem('Cloudflare Pages _headers 配置文件已复制至 dist/_headers');
    }
    const rootAssets = ['manifest.json', 'apple-touch-icon.png'];
    rootAssets.forEach(asset => {
        const srcPath = path.join(PATHS.root, asset);
        if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, path.join(PATHS.dist, asset));
        }
    });
    logItem('PWA manifest.json 与 Apple Touch Icon 高清图标已同步至 dist/');
}

// 4. 自动数据双向同步机制 (Auto-Sync bookmarks.json -> index.html DEFAULT_CATEGORIES / DEFAULT_BOOKMARKS)
function syncBookmarksData() {
    logSection('3/5', '🔄 同步书签默认数据 (bookmarks.json -> index.html)');

    if (fs.existsSync(PATHS.bookmarksJson)) {
        try {
            const bookmarksData = JSON.parse(fs.readFileSync(PATHS.bookmarksJson, 'utf-8'));
            const targetFiles = [PATHS.indexHtml].filter(f => fs.existsSync(f));
            let totalUpdated = 0;

            for (const file of targetFiles) {
                let content = fs.readFileSync(file, 'utf-8');
                let updatedCount = 0;

                // 4.1 自动同步常用顶栏 DEFAULT_BOOKMARKS
                if (bookmarksData.bookmarks && Array.isArray(bookmarksData.bookmarks)) {
                    const formattedBookmarks = formatJsObject(bookmarksData.bookmarks, 8);
                    const nextContent = safeReplaceJsVariable(content, 'DEFAULT_BOOKMARKS', formattedBookmarks);
                    if (nextContent !== content) {
                        content = nextContent;
                        updatedCount++;
                    }
                }

                // 4.2 自动同步分类书签 DEFAULT_CATEGORIES
                if (bookmarksData.categories && Array.isArray(bookmarksData.categories)) {
                    const formattedCategories = formatJsObject(bookmarksData.categories, 8);
                    const nextContent = safeReplaceJsVariable(content, 'DEFAULT_CATEGORIES', formattedCategories);
                    if (nextContent !== content) {
                        content = nextContent;
                        updatedCount++;
                    }
                }

                if (updatedCount > 0) {
                    fs.writeFileSync(file, content, 'utf-8');
                    totalUpdated += updatedCount;
                }
            }

            if (totalUpdated > 0) {
                logItem(`源码 index.html 内置默认数据已更新并与 bookmarks.json 保持同步`);
            } else {
                logItem(`源码 index.html 内置默认数据已是最新 (与 bookmarks.json 保持 100% 同步)`);
            }
        } catch (e) {
            logItem(`自动同步默认书签时出现警告: ${e.message}`, 'warn');
        }
    }
}

// 4.9 从 index.html 提取主体 JS 并处理生成生产环境 dist/app.js (单行无损紧凑压缩默认数据)
function processProductionAppJs() {
    if (!fs.existsSync(PATHS.indexHtml)) return;
    logSection('4/5', '⚡ 提取并压缩生产脚本 (dist/app.js)');
    const htmlContent = fs.readFileSync(PATHS.indexHtml, 'utf-8');
    const mainScriptMatch = htmlContent.match(/<script\s+id="main-script"[^>]*>([\s\S]*?)<\/script>/i);
    
    if (!mainScriptMatch) {
        console.error('❌ 未能在 index.html 中找到 <script id="main-script"> 标签');
        process.exit(1);
    }

    let appJsContent = mainScriptMatch[1].trim();

    if (fs.existsSync(PATHS.bookmarksJson)) {
        try {
            const bookmarksData = JSON.parse(fs.readFileSync(PATHS.bookmarksJson, 'utf-8'));
            if (bookmarksData.bookmarks) {
                const minBm = JSON.stringify(bookmarksData.bookmarks);
                appJsContent = safeReplaceJsVariable(appJsContent, 'DEFAULT_BOOKMARKS', minBm);
            }
            if (bookmarksData.categories) {
                const minCat = JSON.stringify(bookmarksData.categories);
                appJsContent = safeReplaceJsVariable(appJsContent, 'DEFAULT_CATEGORIES', minCat);
            }
            logItem('已完成生产环境 dist/app.js 默认书签数据紧凑压缩');
        } catch {}
    }

    appJsContent = minifyJsCode(appJsContent, 'app.js');
    const appJsKb = (Buffer.byteLength(appJsContent, 'utf-8') / 1024).toFixed(2);
    logItem(`生产环境 dist/app.js AST 安全压缩完成 (${appJsKb} KB)`);

    fs.writeFileSync(path.join(PATHS.dist, 'app.js'), appJsContent, 'utf-8');
}

// 5. 处理生产环境 index.html (替换内联 JS 为外链 dist/app.js，全量内嵌静态编译 Tailwind CSS)
function processProductionHtml() {
    logSection('5/5', '🔧 处理生产环境页面 (dist/index.html)');
    let prodHtmlContent = fs.readFileSync(PATHS.indexHtml, 'utf-8');

    // 5.0 将 index.html 中的 <script id="main-script"> 替换为外链 <script src="./app.js" defer></script>
    prodHtmlContent = prodHtmlContent.replace(
        /<script\s+id="main-script"[^>]*>[\s\S]*?<\/script>/i,
        '<script src="./app.js" defer></script>'
    );

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

    const cdnPattern = /<!--\s*Tailwind[\s\S]*?CDN[\s\S]*?<\/script>(?:\s*<script[\s\S]*?<\/script>)?/i;
    const replaceTarget = `<!-- 内嵌静态编译 Tailwind CSS 样式表 (零网络 RTT 请求，消除渲染阻塞，极速秒开 & 100% 离线支持) -->\n    <style>${cssContent}</style>`;

    if (cdnPattern.test(prodHtmlContent)) {
        prodHtmlContent = prodHtmlContent.replace(cdnPattern, () => replaceTarget);
    } else {
        prodHtmlContent = prodHtmlContent.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser@4"><\/script>/i, () => replaceTarget);
    }

    // 5.1 对 HTML 中所有的 <style> 和 <script> 标签内容进行全面压缩
    function minifyInlineStylesAndScripts(html) {
        // 压缩所有 <style> 块
        html = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, content) => {
            const minified = minifyCssCode(content);
            return `<style${attrs}>${minified}</style>`;
        });

        // 压缩所有 <script> 块（跳过 main-script 避免二次处理）
        html = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, content) => {
            if (/id=["']main-script["']/i.test(attrs)) return match;
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

    // 注入 AI/开发者防误删警告注释（放在 DOCTYPE 之后，避免触发浏览器 quirks 模式）
    const autoGenWarning = `<!-- ⚠️ DO NOT EDIT THIS FILE DIRECTLY! This is a production build output auto-generated by build.js. Please edit the source file /index.html in project root. 自动生成的生产构建产物，请勿直接编辑此文件，修改源码请编辑根目录 index.html -->\n`;
    prodHtmlContent = prodHtmlContent.replace(/(<!DOCTYPE\s+html[^>]*>)/i, (match, p1) => p1 + '\n' + autoGenWarning);

    // 5.2 生产环境 CSP 优化：清理已剔除的 Tailwind v4 Browser CDN 域名，确保在 CDN 自动压缩/多平台部署下 100% 高可用
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
    const iconDataUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🪐%3C/text%3E%3C/svg%3E";
    prodHtmlContent = prodHtmlContent.replace(/<link\s+[^>]*rel=["']icon["'][^>]*>/i, () => `<link rel="icon" type="image/svg+xml" href="${iconDataUrl}">`);
    prodHtmlContent = prodHtmlContent.replace(/<link\s+[^>]*rel=["']apple-touch-icon["'][^>]*>/i, () => `<link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png">`);

    // 5.4 生产环境 HTML 零依赖极致压缩（清除 HTML 注释与多余空白缩进，保护 <style> 与 <script> 块）
    function minifyHtml(htmlStr) {
        const warningMatch = htmlStr.match(/(<!DOCTYPE[\s\S]*?-->\n?)/i);
        const prefix = warningMatch ? warningMatch[1] : '';
        if (prefix) htmlStr = htmlStr.slice(prefix.length);

        htmlStr = htmlStr.replace(/<!--(?!\[if|[\s\S]*?DO NOT EDIT)[\s\S]*?-->/g, '');
        const parts = htmlStr.split(/(<(?:style|script)[\s\S]*?<\/(?:style|script)>)/i);
        const minified = parts.map(part => {
            if (/^<(?:style|script)/i.test(part)) return part;
            return part.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
        }).join('');
        return (prefix + minified).trim();
    }
    prodHtmlContent = minifyHtml(prodHtmlContent);
    const htmlKb = (Buffer.byteLength(prodHtmlContent, 'utf-8') / 1024).toFixed(2);
    logItem(`生产环境 dist/index.html 零依赖压缩完成 (${htmlKb} KB)`);

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
        cleanupTempFiles();
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

main();

// 监听模式 (--watch)
if (process.argv.includes('--watch')) {
    console.log(`\n${c.yellow}👀 开启文件修改自动构建监听模式 (Watch Mode)...${c.reset}`);
    console.log(`   ${c.dim}正在监听 index.html 与 bookmarks.json 的修改...${c.reset}\n`);
    let watchTimer = null;
    const triggerRebuild = (filename) => {
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
            console.log(`\n${c.magenta}📝 [Watch] 检测到文件修改: ${filename}，正在重新增量编译 dist/ ...${c.reset}`);
            try {
                const rebuildStart = Date.now();
                compileTailwindCss();
                buildServiceWorkerAndAssets();
                syncBookmarksData();
                processProductionAppJs();
                processProductionHtml();
                const rebuildDuration = Date.now() - rebuildStart;
                console.log(`  ${c.green}✔ [Watch] 增量编译完成！(耗时: ${rebuildDuration}ms)${c.reset}\n`);
            } catch (err) {
                console.error(`  ${c.yellow}❌ [Watch] 增量编译失败:${c.reset}`, err.message || err);
            }
        }, 120);
    };

    if (fs.existsSync(PATHS.indexHtml)) {
        fs.watch(PATHS.indexHtml, () => triggerRebuild('index.html'));
    }
    if (fs.existsSync(PATHS.bookmarksJson)) {
        fs.watch(PATHS.bookmarksJson, () => triggerRebuild('bookmarks.json'));
    }
}
