const fs = require('node:fs');
const path = require('node:path');
const { executeBuild, PATHS } = require('./build.cjs');
const { replaceOnce } = require('./html-template.cjs');

// 复用网页编译与资源注入，独立输出；失败时保留上一份扩展。
const output = path.join(PATHS.root, 'extension');
const staging = path.join(PATHS.root, '.extension_staging');

function buildExtension() {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    try {
        executeBuild(staging, { extension: true });
        const manifest = JSON.parse(fs.readFileSync(path.join(PATHS.src, 'extension/manifest.json'), 'utf8'));
        manifest.version = JSON.parse(fs.readFileSync(PATHS.pkgJson, 'utf8')).version;
        fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
        fs.copyFileSync(path.join(PATHS.src, 'extension/icon128.png'), path.join(staging, 'icon128.png'));

        let html = fs.readFileSync(path.join(staging, 'index.html'), 'utf8');
        html = html.replace(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/i,
            `<meta http-equiv="Content-Security-Policy" content="${manifest.content_security_policy.extension_pages}">`);
        html = html.replace(/<link\b[^>]*rel="manifest"[^>]*>/gi, '');
        html = replaceOnce(html, '离线 Service Worker 缓存', '临时缓存');
        html = replaceOnce(html, '若离线资源异常或更新未及时应用，可手动刷新 Service Worker 离线缓存。',
            '可清理临时缓存并刷新页面，不影响已保存的书签、壁纸和设置。');
        html = replaceOnce(html, '一键刷新 Service Worker 离线缓存', '清理缓存并刷新');
        // 外置首屏脚本会阻塞解析；先应用现有样式，避免等待脚本时透出白色画布。
        const initialStyle = html.match(/<style\b[^>]*>[\s\S]*?<\/style>/i)?.[0];
        if (!initialStyle) throw new Error('扩展页面缺少首屏样式');
        html = replaceOnce(html, initialStyle, '');
        html = replaceOnce(html, '<meta charset="UTF-8">',
            `<meta charset="UTF-8"><meta name="color-scheme" content="dark">${initialStyle}`);
        // 保留原位置的阻塞执行顺序，首屏预渲染仍在对应 DOM 解析后执行。
        let scriptIndex = 0;
        html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs, code) => {
            if (/\bsrc\s*=/i.test(attrs)) return tag;
            if (/type="application\/ld\+json"/i.test(attrs)) return '';
            const filename = `bootstrap-${++scriptIndex}.js`;
            fs.writeFileSync(path.join(staging, filename), code);
            return `<script${attrs} src="./${filename}"></script>`;
        });
        fs.writeFileSync(path.join(staging, 'index.html'), html);
        for (const name of ['sw.js', '_headers', 'robots.txt', 'sitemap.xml']) {
            fs.rmSync(path.join(staging, name), { force: true });
        }
        fs.rmSync(output, { recursive: true, force: true });
        fs.renameSync(staging, output);
        console.log('\nChrome 扩展已生成：extension/（chrome://extensions → 加载已解压的扩展程序）');
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
}

if (require.main === module) buildExtension();
module.exports = { buildExtension };
