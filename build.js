const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * ==============================================================================
 * Glass Start — 生产环境构建打包脚本 (build.js)
 * ==============================================================================
 * 📌 设计原理与架构改进 (Senior Architect Refactoring):
 * 1. 【模块化管线封装】：拆分为自检、样式编译、SW更新、数据同步与HTML终化等高内聚模块。
 * 2. 【进程退出清理钩子】：注册 process exit / SIGINT 钩子，确保临时输入文件 100% 擦除。
 * 3. 【强壮正则匹配】：提升 DEFAULT_* 默认书签数组替换正则的格式容错度（支持单行/多行/极简压缩）。
 * 4. 【完整日志与诊断】：保持原始脚本极为丰富的控制台交互日志与分步骤 KB 体积统计。
 */

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

console.log('🚀 开始生产环境构建打包 (Glass Start)...');

// 1. 确保 dist 目录存在并清空旧构建产物
if (fs.existsSync(PATHS.dist)) {
    fs.rmSync(PATHS.dist, { recursive: true, force: true });
}
fs.mkdirSync(PATHS.dist, { recursive: true });

// 1.1 构建前依赖自检
function checkTailwindInstalled() {
    const pkgJsonPath = path.join(PATHS.root, 'node_modules', 'tailwindcss', 'package.json');
    try {
        return !!(require(pkgJsonPath).version);
    } catch {
        return false;
    }
}

if (!checkTailwindInstalled()) {
    console.error('❌ 未检测到 Tailwind CSS 依赖 (node_modules/tailwindcss)。');
    console.error('');
    console.error('   请在项目根目录先安装依赖（包含 devDependencies 中的 tailwindcss）：');
    console.error('');
    console.error('       npm install');
    console.error('');
    console.error('   若已安装过仍报此错，可尝试删除 node_modules 后重新安装：');
    console.error('');
    console.error('       rm -rf node_modules && npm install');
    console.error('');
    console.error('   💡 提示：从 GitHub 下载的 ZIP 或新克隆的仓库不包含 node_modules，需先执行上述安装步骤。');
    cleanupTempFiles();
    process.exit(1);
}

// 2. 编译 Tailwind CSS (v4 CLI)
function compileTailwindCss() {
    fs.writeFileSync(PATHS.tempCss, '@import "tailwindcss";\n@source "./index.html";\n', 'utf-8');
    const distStyleCss = path.join(PATHS.dist, 'style.css');

    try {
        console.log('📦 正在扫描 HTML 并编译精简 CSS 样式表 (Tailwind CLI)...');
        execSync(`npx -y @tailwindcss/cli@4 -i "${PATHS.tempCss}" -o "${distStyleCss}" -m`, {
            stdio: 'inherit'
        });
    } catch (err) {
        console.error('❌ Tailwind CSS 编译失败:', err.message || err);
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
compileTailwindCss();

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
            console.warn(`   ⚠️ esbuild 压缩 ${filename} 时出现警告，自动回退到基础正则压缩:`, e.message);
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

// 3. 处理并复制 Service Worker 底座脚本
function buildServiceWorker() {
    console.log('📑 编译 Service Worker 缓存版本 (sw.js)...');
    if (fs.existsSync(PATHS.sw)) {
        let swContent = fs.readFileSync(PATHS.sw, 'utf-8');
        const timestampVersion = 'app-core-v' + Date.now();
        swContent = swContent.replace(/const\s+(CORE_CACHE|CACHE)\s*=\s*['"][^'"]+['"];/, `const CORE_CACHE = '${timestampVersion}';`);
        fs.writeFileSync(path.join(PATHS.dist, 'sw.js'), swContent, 'utf-8');
        console.log(`   ✅ Service Worker 缓存版本已自动为 dist/sw.js 更新为: ${timestampVersion}`);
    }
}
buildServiceWorker();

// 3.1 复制 wallpapers 本地壁纸目录与 _headers 配置文件
function copyStaticAssets() {
    if (fs.existsSync(PATHS.wallpapers)) {
        fs.cpSync(PATHS.wallpapers, path.join(PATHS.dist, 'wallpapers'), { recursive: true });
        console.log('   ✅ 已将 wallpapers/ 壁纸资源目录全量复制至 dist/wallpapers/');
    }
    if (fs.existsSync(PATHS.headers)) {
        fs.copyFileSync(PATHS.headers, path.join(PATHS.dist, '_headers'));
        console.log('   ✅ 已将 Cloudflare Pages _headers 配置文件复制至 dist/_headers');
    }
}
copyStaticAssets();

/**
 * 4. 自动数据双向同步机制 (Auto-Sync bookmarks.json -> index.html DEFAULT_CATEGORIES / DEFAULT_BOOKMARKS)
 */
function formatJsObject(obj, indent = 8) {
    const jsonStr = JSON.stringify(obj, null, 4);
    return jsonStr
        .split('\n')
        .map((line, idx) => (idx === 0 ? line : ' '.repeat(indent) + line))
        .join('\n');
}

function syncBookmarksData() {
    console.log('🔄 正在同步 bookmarks.json 数据至 index.html 内置默认回退数组 (DEFAULT_BOOKMARKS & DEFAULT_CATEGORIES)...');

    if (fs.existsSync(PATHS.bookmarksJson)) {
        try {
            const bookmarksData = JSON.parse(fs.readFileSync(PATHS.bookmarksJson, 'utf-8'));
            const targetFiles = [PATHS.indexHtml].filter(f => fs.existsSync(f));

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
                    console.log(`   ✅ 源码 ${path.basename(file)} 内置默认数据已自动与 bookmarks.json 保持 100% 同步！`);
                }
            }
        } catch (e) {
            console.warn('   ⚠️ 自动同步默认书签时出现警告（未影响主体打包流程）:', e.message);
        }
    }
}
syncBookmarksData();

// 4.9 从 index.html 提取主体 JS 并处理生成生产环境 dist/app.js (单行无损紧凑压缩默认数据)
let cachedAppJsContent = '';
function processProductionAppJs() {
    if (!fs.existsSync(PATHS.indexHtml)) return;
    console.log('⚡️ 正在从 index.html 提取主体逻辑并生成生产环境 dist/app.js 与内联脚本...');
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
            console.log('   ✅ 已完成生产环境 dist/app.js 默认书签数据的紧凑压缩');
        } catch {}
    }

    appJsContent = minifyJsCode(appJsContent, 'app.js');
    cachedAppJsContent = appJsContent;
    const appJsKb = (Buffer.byteLength(appJsContent, 'utf-8') / 1024).toFixed(2);
    console.log(`   ⚡️ 已完成生产环境 dist/app.js 标准 AST 压缩 (${appJsKb} KB)`);

    fs.writeFileSync(path.join(PATHS.dist, 'app.js'), appJsContent, 'utf-8');
}
processProductionAppJs();

// 5. 处理生产环境 index.html (替换内联 JS 为外链 dist/app.js，全量内嵌静态编译 Tailwind CSS)
function processProductionHtml() {
    console.log('🔧 处理生产环境 index.html (剥离内联 JS 转换为 app.js 外链，全量内嵌 Tailwind CSS)...');
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
        console.log(`   ✅ 已提取静态编译 CSS (${cssKb} KB) 并进行防注入安全转义，准备全量内嵌至 dist/index.html`);
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
            const minified = content.replace(/\/\*[\s\S]*?\*\//g, '')
                .split('\n')
                .map(l => l.trim())
                .filter(Boolean)
                .join('\n')
                .replace(/\s*\{\s*/g, '{')
                .replace(/\s*;\s*/g, ';')
                .replace(/;\}/g, '}');
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
    console.log('   🛡️ 已完成生产环境 CSP 策略优化（剔除已废弃的 CDN 域名）');

    // 5.3 自动转译与内嵌应用图标为 Data URI (使用原生 🪐 SVG 图标)
    const iconDataUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🪐%3C/text%3E%3C/svg%3E";
    prodHtmlContent = prodHtmlContent.replace(/<link\s+[^>]*rel=["']icon["'][^>]*>/i, () => `<link rel="icon" href="${iconDataUrl}">`);
    prodHtmlContent = prodHtmlContent.replace(/<link\s+[^>]*rel=["']apple-touch-icon["'][^>]*>/i, () => `<link rel="apple-touch-icon" href="${iconDataUrl}">`);

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
    console.log('   ⚡️ 已完成生产环境 dist/index.html 零依赖 HTML 压缩');

    fs.writeFileSync(path.join(PATHS.dist, 'index.html'), prodHtmlContent, 'utf-8');
}
processProductionHtml();



console.log('\n✅ 生产打包成功！构建产物保存在 dist/ 目录下：');
const distFiles = fs.readdirSync(PATHS.dist);
distFiles.forEach(file => {
    const stat = fs.statSync(path.join(PATHS.dist, file));
    const kb = (stat.size / 1024).toFixed(2);
    console.log(`   └─ dist/${file} (${kb} KB)`);
});
console.log('\n💡 提示：部署时只需将 dist/ 文件夹下的内容上传至 GitHub Pages / Cloudflare Pages 即可！\n');

// 监听模式 (--watch)
if (process.argv.includes('--watch')) {
    console.log('👀 开启文件修改自动构建监听模式 (Watch Mode)...');
    console.log('   正在监听 index.html 与 bookmarks.json 的修改...\n');
    let watchTimer = null;
    const triggerRebuild = (filename) => {
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
            console.log(`\n📝 [Watch] 检测到文件修改: ${filename}，正在重新增量编译 dist/ ...`);
            try {
                compileTailwindCss();
                buildServiceWorker();
                syncBookmarksData();
                processProductionAppJs();
                processProductionHtml();
                console.log('   ✅ [Watch] 增量编译完成！');
            } catch (err) {
                console.error('   ❌ [Watch] 增量编译失败:', err.message || err);
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


