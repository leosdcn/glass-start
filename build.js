const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = __dirname;
const distDir = path.join(rootDir, 'dist');
const inputCssPath = path.join(rootDir, '.temp_input.css');

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
    execSync(`npx -y tailwindcss@3 -i "${inputCssPath}" -o "${path.join(distDir, 'style.css')}" --content "${path.join(rootDir, 'index.html')}" -m`, {
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
if (fs.existsSync(path.join(rootDir, 'bookmarks.json'))) {
    fs.copyFileSync(path.join(rootDir, 'bookmarks.json'), path.join(distDir, 'bookmarks.json'));
}
if (fs.existsSync(path.join(rootDir, 'sw.js'))) {
    fs.copyFileSync(path.join(rootDir, 'sw.js'), path.join(distDir, 'sw.js'));
}

// 4. 处理 index.html：替换 Tailwind Play CDN 脚本为静态编译 style.css 链接
console.log('🔧 处理生产环境 index.html (移除 Play CDN 脚本，注入 style.css)...');
let htmlContent = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');

// 匹配并替换 Tailwind Play CDN 标签段
const cdnPattern = /<!--\s*Tailwind Play CDN[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/i;
const replaceTarget = `<!-- 静态编译 Tailwind CSS 样式表 (零 JS 运行开销，极速秒开 & 100% 离线支持) -->\n    <link rel="stylesheet" href="style.css">`;

if (cdnPattern.test(htmlContent)) {
    htmlContent = htmlContent.replace(cdnPattern, replaceTarget);
} else {
    // 降级替换方案
    htmlContent = htmlContent.replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/i, replaceTarget);
}

fs.writeFileSync(path.join(distDir, 'index.html'), htmlContent, 'utf-8');

console.log('\n✅ 生产打包成功！构建产物保存在 dist/ 目录下：');
const distFiles = fs.readdirSync(distDir);
distFiles.forEach(file => {
    const stat = fs.statSync(path.join(distDir, file));
    const kb = (stat.size / 1024).toFixed(2);
    console.log(`   └─ dist/${file} (${kb} KB)`);
});
console.log('\n💡 提示：部署时只需将 dist/ 文件夹下的内容上传至 GitHub Pages / Cloudflare Pages / NAS 即可！\n');
