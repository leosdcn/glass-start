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

// 3. 复制静态数据与服务文件
console.log('📑 复制 bookmarks.json & sw.js...');
if (fs.existsSync(bookmarksJsonPath)) {
    fs.copyFileSync(bookmarksJsonPath, path.join(distDir, 'bookmarks.json'));
}
if (fs.existsSync(path.join(rootDir, 'sw.js'))) {
    fs.copyFileSync(path.join(rootDir, 'sw.js'), path.join(distDir, 'sw.js'));
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
    // 转换为 JS 对象字面量格式 (清洗双引号键名)
    const formatted = jsonStr
        .replace(/"([^"]+)":/g, '$1:')
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

        // 4.1 自动同步常用顶栏 DEFAULT_BOOKMARKS
        if (bookmarksData.bookmarks && Array.isArray(bookmarksData.bookmarks)) {
            const formattedBookmarks = formatJsObject(bookmarksData.bookmarks, 8);
            const bmRegex = /const DEFAULT_BOOKMARKS = \[[\s\S]*?\n        \];/;
            if (bmRegex.test(htmlContent)) {
                htmlContent = htmlContent.replace(bmRegex, `const DEFAULT_BOOKMARKS = ${formattedBookmarks};`);
                updatedCount++;
            }
        }

        // 4.2 自动同步分类书签 DEFAULT_CATEGORIES
        if (bookmarksData.categories && Array.isArray(bookmarksData.categories)) {
            const formattedCategories = formatJsObject(bookmarksData.categories, 8);
            const catRegex = /const DEFAULT_CATEGORIES = \[[\s\S]*?\n        \];/;
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

// 5. 处理生产环境 index.html (替换 Play CDN 为 style.css)
console.log('🔧 处理生产环境 index.html (移除 Play CDN 脚本，注入 style.css)...');
let prodHtmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');

const cdnPattern = /<!--\s*Tailwind Play CDN[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/i;
const replaceTarget = `<!-- 静态编译 Tailwind CSS 样式表 (高优先级 Preload + 零 JS 运行开销，极速秒开 & 100% 离线支持) -->\n    <link rel="preload" href="style.css" as="style">\n    <link rel="stylesheet" href="style.css">`;

if (cdnPattern.test(prodHtmlContent)) {
    prodHtmlContent = prodHtmlContent.replace(cdnPattern, replaceTarget);
} else {
    prodHtmlContent = prodHtmlContent.replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/i, replaceTarget);
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
