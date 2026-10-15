/** 构建插槽必须唯一；不依赖周围标签的属性顺序或缩进。 */
function replaceOnce(html, marker, value) {
    const index = html.indexOf(marker);
    if (index < 0 || html.indexOf(marker, index + marker.length) !== -1) {
        throw new Error(`构建插槽 ${marker} 必须出现一次`);
    }
    return html.slice(0, index) + value + html.slice(index + marker.length);
}

function replaceRegion(html, name, value) {
    const start = `<!-- BUILD_${name}_START -->`;
    const end = `<!-- BUILD_${name}_END -->`;
    // 先验证两侧唯一，再检查顺序，不能吞掉其他区域。
    replaceOnce(html, start, '');
    replaceOnce(html, end, '');
    const from = html.indexOf(start), to = html.indexOf(end);
    if (to < from) throw new Error(`构建插槽 ${name} 结束标记位于开始标记之前`);
    return html.slice(0, from) + value + html.slice(to + end.length);
}

function injectDocumentShell(html, { css, svg, version }) {
    if (typeof css !== 'string' || !css.trim()) throw new Error('Refusing to generate HTML without compiled CSS');
    if (typeof svg !== 'string' || !svg.trim()) throw new Error('Refusing to generate HTML without SVG sprite');
    const fingerprint = JSON.stringify(version).replace(/</g, '\\u003c');
    html = replaceOnce(html, '<!-- INJECT_APP_HEAD -->', `<script>window.__GLASS_BUILD_HTML__=${fingerprint}</script><script src="./app.js?v=${encodeURIComponent(version)}" defer></script>`);
    html = replaceRegion(html, 'APP_ENTRY', '');
    html = replaceOnce(html, '<!-- INJECT_SVG_SPRITE -->', svg);
    html = replaceRegion(html, 'STYLES', `<style>${css.replace(/<\/style>/gi, '\\3c/style>')}</style>`);
    return html;
}

module.exports = { replaceOnce, replaceRegion, injectDocumentShell };
