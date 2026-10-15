import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { replaceOnce, replaceRegion, injectDocumentShell } = require('../scripts/html-template.cjs');
const template = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const options = {css:'body{color:red}', svg:'<svg id="fixture-sprite"></svg>', version:'app-core-v123'};
const render = html => injectDocumentShell(html, options);
const output = render(template);
assert.match(output, /<style>body\{color:red\}<\/style>/);
assert.match(output, /app\.js\?v=app-core-v123/);
assert.match(output, /__GLASS_BUILD_HTML__="app-core-v123"/);
assert.match(output, /id="fixture-sprite"/);
assert.equal(output.includes('src="./js/main.js"'), false);
assert.equal(output.includes('href="./styles/main.css"'), false);
for (const marker of ['<!-- INJECT_APP_HEAD -->','<!-- INJECT_SVG_SPRITE -->','<!-- BUILD_STYLES_START -->','<!-- BUILD_STYLES_END -->','<!-- BUILD_APP_ENTRY_START -->','<!-- BUILD_APP_ENTRY_END -->']) {
    assert.throws(() => render(template.replace(marker, '')), /必须出现一次/);
    assert.throws(() => render(template + marker), /必须出现一次/);
}
assert.throws(() => replaceRegion('<!-- BUILD_A_END --><!-- BUILD_A_START -->', 'A', ''), /结束标记/);
assert.equal(replaceOnce('a SLOT b', 'SLOT', '$&'), 'a $& b');
assert.throws(() => injectDocumentShell(template, {...options, css:''}), /without compiled CSS/);
assert.throws(() => injectDocumentShell(template, {...options, svg:''}), /without SVG/);
const safe = injectDocumentShell(template, {...options,css:'x{content:"</style><script>bad</script>"}'});
assert.equal(safe.includes('</style><script>bad'), false);
// 标签属性重排不影响插槽；只替换目标区域，保留其他标签。
const reordered = template.replace('<script type="module" src="./js/main.js"></script>', '<script src="./js/main.js" type="module"></script>');
assert.equal(render(reordered), output);
console.log('✅ 构建插槽缺失、重复、顺序错误和空资源均失败；属性重排不影响注入，内容安全转义');
