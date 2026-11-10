const fs = require('node:fs');
const path = require('node:path');
const { executeBuild, PATHS } = require('./build.cjs');
const { replaceOnce } = require('./html-template.cjs');
const { publishBuild } = require('./publish-build.cjs');

// 复用网页编译与资源注入，独立输出；失败时保留上一份扩展。
function buildExtension(output = path.join(PATHS.root, 'extension')) {
    publishBuild(output, staging => {
        executeBuild(staging, { extension: true });
        const manifest = JSON.parse(fs.readFileSync(path.join(PATHS.src, 'extension/manifest.json'), 'utf8'));
        manifest.version = JSON.parse(fs.readFileSync(PATHS.pkgJson, 'utf8')).version;
        fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
        const langConfig = fs.readFileSync(path.join(PATHS.src, 'js/config/language.js'), 'utf8');
        const langMatch = langConfig.match(/SUPPORTED_LANGUAGES\s*=\s*Object\.freeze\((\[[^\]]+\])\)/);
        /** @type {string[]} */
        const supportedLocales = langMatch ? JSON.parse(langMatch[1].replace(/'/g, '"')) : ['zh-CN', 'en'];
        for (const locale of supportedLocales) {
            const folder = locale.replace('-', '_');
            const messages = JSON.parse(fs.readFileSync(path.join(PATHS.src, 'js/config/locales', `${locale}.json`), 'utf8'));
            const directory = path.join(staging, '_locales', folder);
            fs.mkdirSync(directory, { recursive: true });
            fs.writeFileSync(path.join(directory, 'messages.json'), JSON.stringify({
                extensionName: { message: messages['extension.name'] },
                extensionDescription: { message: messages['extension.description'] }
            }, null, 2) + '\n');
        }
        for (const iconName of ['icon16.png', 'icon48.png', 'icon128.png']) {
            const iconPath = path.join(PATHS.src, 'extension', iconName);
            if (fs.existsSync(iconPath)) {
                fs.copyFileSync(iconPath, path.join(staging, iconName));
            }
        }

        let html = fs.readFileSync(path.join(staging, 'index.html'), 'utf8');
        // 移除扩展环境冗余的 CSP Meta（MV3 完全由 manifest.json CSP 控制）与社交/搜索引擎 Meta
        html = html.replace(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/i, '');
        html = html.replace(/<link\b[^>]*rel="(?:canonical|manifest)"[^>]*>/gi, '');
        html = html.replace(/<meta\b[^>]*(?:name="robots"|property="og:[^"]+")[^>]*>/gi, '');
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
        for (const name of ['_headers', 'robots.txt', 'sitemap.xml']) {
            fs.rmSync(path.join(staging, name), { force: true });
        }
    });
}

if (require.main === module) {
    buildExtension();
    console.log('\nChrome 扩展已生成：extension/（chrome://extensions → 加载已解压的扩展程序）');
}
module.exports = { buildExtension };
