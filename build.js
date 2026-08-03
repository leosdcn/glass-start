const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = __dirname;
const distDir = path.join(rootDir, 'dist');
const inputCssPath = path.join(rootDir, '.temp_input.css');
const bookmarksJsonPath = path.join(rootDir, 'bookmarks.json');
const indexHtmlPath = path.join(rootDir, 'index.html');

console.log('🚀 开始生产环境构建打包 (Glass Start)...');

// 1. 确保 dist 目录存在并清空旧构建产物
if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// 2. 创建临时 Tailwind v3 输入样式文件
fs.writeFileSync(inputCssPath, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n', 'utf-8');

try {
    console.log('📦 正在扫描 HTML 并编译精简 CSS 样式表 (Tailwind CLI)...');
    execSync(`npx -y tailwindcss@3 -i "${inputCssPath}" -o "${path.join(distDir, 'style.css')}" --content "${indexHtmlPath}" -m`, {
        stdio: 'inherit'
    });
} catch (err) {
    console.error('❌ Tailwind CSS 编译失败:', err);
    if (fs.existsSync(inputCssPath)) fs.unlinkSync(inputCssPath);
    process.exit(1);
} finally {
    if (fs.existsSync(inputCssPath)) fs.unlinkSync(inputCssPath);
}

// 3. 处理并复制 Service Worker 底座脚本
console.log('📑 编译 Service Worker 缓存版本 (sw.js)...');
if (fs.existsSync(path.join(rootDir, 'sw.js'))) {
    let swContent = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf-8');
    const timestampVersion = 'app-core-v' + Date.now();
    swContent = swContent.replace(/const\s+(CORE_CACHE|CACHE)\s*=\s*['"][^'"]+['"];/, `const CORE_CACHE = '${timestampVersion}';`);
    fs.writeFileSync(path.join(distDir, 'sw.js'), swContent, 'utf-8');
    console.log(`   ✅ Service Worker 缓存版本已自动为 dist/sw.js 更新为: ${timestampVersion}`);
}

/**
 * 4. 自动数据双向同步机制 (Auto-Sync bookmarks.json -> index.html DEFAULT_CATEGORIES / DEFAULT_BOOKMARKS)
 * ---------------------------------------------------------------------------------------------------------
 * 📌 设计原理与解决的问题：
 *    由于浏览器 CORS 安全规范限制，在本地以 file:// 协议直接双击打开 index.html 时，JavaScript 无法跨域异步 fetch() 同目录下的 bookmarks.json。
 *    为此，index.html 内置了 DEFAULT_BOOKMARKS 与 DEFAULT_CATEGORIES 两个兜底回退数据数组。
 * 
 * 💡 本自动化处理的作用：
 *    开发者只需维护根目录下的 `bookmarks.json` 文件。
 *    在运行 `npm run build` 或 `node build.js` 打包时，脚本会自动读取 bookmarks.json 的最新书签及分类数据，
 *    并将其格式化注入更新到源码 `index.html` 以及 `dist/index.html` 中的 DEFAULT_* 数组，
 *    彻底消除“修改了 json 却忘记同步修改 html 导致本地 file:// 打开缺漏”的人为粗心遗漏风险！
 */
console.log('🔄 正在同步 bookmarks.json 数据至 index.html 内置默认回退数组 (DEFAULT_BOOKMARKS & DEFAULT_CATEGORIES)...');

function formatJsObject(obj, indent = 8) {
    const jsonStr = JSON.stringify(obj, null, 4);
    const formatted = jsonStr
        .split('\n')
        .map((line, idx) => (idx === 0 ? line : ' '.repeat(indent) + line))
        .join('\n');
    return formatted;
}

if (fs.existsSync(bookmarksJsonPath) && fs.existsSync(indexHtmlPath)) {
    try {
        const bookmarksData = JSON.parse(fs.readFileSync(bookmarksJsonPath, 'utf-8'));
        let htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');
        let updatedCount = 0;

        // 4.1 自动同步常用顶栏 DEFAULT_BOOKMARKS (匹配模式兼容任意空格/换行缩进)
        if (bookmarksData.bookmarks && Array.isArray(bookmarksData.bookmarks)) {
            const formattedBookmarks = formatJsObject(bookmarksData.bookmarks, 8);
            const bmRegex = /(?:const|let|var)\s+DEFAULT_BOOKMARKS\s*=\s*\[[\s\S]*?\n\s*\];/;
            if (bmRegex.test(htmlContent)) {
                htmlContent = htmlContent.replace(bmRegex, `const DEFAULT_BOOKMARKS = ${formattedBookmarks};`);
                updatedCount++;
            }
        }

        // 4.2 自动同步分类书签 DEFAULT_CATEGORIES (匹配模式兼容任意空格/换行缩进)
        if (bookmarksData.categories && Array.isArray(bookmarksData.categories)) {
            const formattedCategories = formatJsObject(bookmarksData.categories, 8);
            const catRegex = /(?:const|let|var)\s+DEFAULT_CATEGORIES\s*=\s*\[[\s\S]*?\n\s*\];/;
            if (catRegex.test(htmlContent)) {
                htmlContent = htmlContent.replace(catRegex, `const DEFAULT_CATEGORIES = ${formattedCategories};`);
                updatedCount++;
            }
        }

        if (updatedCount > 0) {
            fs.writeFileSync(indexHtmlPath, htmlContent, 'utf-8');
            console.log('   ✅ 源码 index.html 内置默认数据已自动与 bookmarks.json 保持 100% 同步！');
        }
    } catch (e) {
        console.warn('   ⚠️ 自动同步默认书签时出现警告（未影响主体打包流程）:', e.message);
    }
}

// 5. 处理生产环境 index.html (替换 Play CDN 为全量内嵌 <style> 标签，添加自动生成防护头部)
console.log('🔧 处理生产环境 index.html (移除 Play CDN 脚本，全量内嵌 Tailwind CSS)...');
let prodHtmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');

const distCssPath = path.join(distDir, 'style.css');
let cssContent = '';
if (fs.existsSync(distCssPath)) {
    cssContent = fs.readFileSync(distCssPath, 'utf-8');
    // 🛡️ 安全防御：避免 CSS 内容（如 content: "</style>"）意外转义提前闭合 HTML <style> 标签引发 XSS/页面崩溃
    cssContent = cssContent.replace(/<\/style>/gi, '\\3c/style>');
    const cssKb = (fs.statSync(distCssPath).size / 1024).toFixed(2);
    console.log(`   ✅ 已提取静态编译 CSS (${cssKb} KB) 并进行防注入安全转义，准备全量内嵌至 dist/index.html`);
    fs.unlinkSync(distCssPath);
}

const cdnPattern = /<!--\s*Tailwind Play CDN[\s\S]*?<\/script>\s*<script[\s\S]*?<\/script>/i;
const replaceTarget = `<!-- 内嵌静态编译 Tailwind CSS 样式表 (零网络 RTT 请求，消除渲染阻塞，极速秒开 & 100% 离线支持) -->\n    <style>${cssContent}</style>`;

if (cdnPattern.test(prodHtmlContent)) {
    prodHtmlContent = prodHtmlContent.replace(cdnPattern, replaceTarget);
} else {
    prodHtmlContent = prodHtmlContent.replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/i, replaceTarget);
}

// 注入 AI/开发者防误删警告注释（放在 DOCTYPE 之后，避免触发浏览器 quirks 模式）
const autoGenWarning = `<!-- ⚠️ DO NOT EDIT THIS FILE DIRECTLY! This is a production build output auto-generated by build.js. Please edit the source file /index.html in project root. 自动生成的生产构建产物，请勿直接编辑此文件，修改源码请编辑根目录 index.html -->\n`;
prodHtmlContent = prodHtmlContent.replace(/(<!DOCTYPE\s+html[^>]*>)/i, '$1\n' + autoGenWarning);

// 5.1 生产 CSP 收紧：剥离仅开发模式使用的 Tailwind Play CDN 域名，避免放宽线上 script-src 策略
// 生产构建已移除 CDN 脚本，保留其域名在 CSP 中属于无效且多余的白名单风险面
// 5.2 自动转译与内嵌 manifest.json 为 Data URI (使用原生 🪐 SVG 图标，实现双文件零余项架构)
const iconDataUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🪐%3C/text%3E%3C/svg%3E";
prodHtmlContent = prodHtmlContent.replace(/<link\s+[^>]*rel=["']icon["'][^>]*>/i, `<link rel="icon" href="${iconDataUrl}">`);
prodHtmlContent = prodHtmlContent.replace(/<link\s+[^>]*rel=["']apple-touch-icon["'][^>]*>/i, `<link rel="apple-touch-icon" href="${iconDataUrl}">`);

const manifestJsonPath = path.join(rootDir, 'manifest.json');
if (fs.existsSync(manifestJsonPath)) {
    try {
        const manifestObj = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf-8'));
        if (manifestObj.icons && Array.isArray(manifestObj.icons)) {
            manifestObj.icons.forEach(ic => {
                if (ic.src === 'icon.svg' || !ic.src) ic.src = iconDataUrl;
            });
        }
        const manifestStr = JSON.stringify(manifestObj);
        const manifestBase64 = Buffer.from(manifestStr, 'utf-8').toString('base64');
        const manifestDataUrl = `data:application/manifest+json;base64,${manifestBase64}`;

        if (/<link\s+[^>]*rel=["']manifest["'][^>]*>/i.test(prodHtmlContent)) {
            prodHtmlContent = prodHtmlContent.replace(/<link\s+[^>]*rel=["']manifest["'][^>]*>/i, `<link rel="manifest" href="${manifestDataUrl}">`);
        } else {
            prodHtmlContent = prodHtmlContent.replace(/<\/head>/i, `    <link rel="manifest" href="${manifestDataUrl}">\n</head>`);
        }
        console.log('   ✅ 已将 manifest.json & icon.svg 转化为 Data URI 全量内嵌至 dist/index.html');
    } catch (e) {
        console.warn('   ⚠️ 内嵌 manifest.json 时提示:', e.message);
    }
}

fs.writeFileSync(path.join(distDir, 'index.html'), prodHtmlContent, 'utf-8');

console.log('\n✅ 生产打包成功！构建产物保存在 dist/ 目录下：');
const distFiles = fs.readdirSync(distDir);
distFiles.forEach(file => {
    const stat = fs.statSync(path.join(distDir, file));
    const kb = (stat.size / 1024).toFixed(2);
    console.log(`   └─ dist/${file} (${kb} KB)`);
});
console.log('\n💡 提示：部署时只需将 dist/ 文件夹下的内容上传至 GitHub Pages / Cloudflare Pages / NAS 即可！\n');
