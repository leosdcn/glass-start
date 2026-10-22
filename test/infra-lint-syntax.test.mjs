import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = mkdtempSync(join(tmpdir(), 'glass-lint-syntax-'));
try {
    for (const entry of ['src', 'scripts', 'public', 'bookmarks.json', 'package.json', 'package-lock.json', 'README.md', 'sw.js']) {
        cpSync(join(root, entry), join(fixture, entry), { recursive: true });
    }
    symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const lint = () => spawnSync(process.execPath, ['scripts/lint.mjs'], { cwd: fixture, encoding: 'utf8' });
    const clean = lint();
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    const templatePath = join(fixture, 'scripts/html-template.cjs');
    const originalTemplate = readFileSync(templatePath, 'utf8');
    writeFileSync(templatePath, 'const broken = ;\n');
    const invalidTemplate = lint();
    assert.equal(invalidTemplate.status, 1, invalidTemplate.stdout + invalidTemplate.stderr);
    assert.match(invalidTemplate.stdout, /scripts\/html-template\.cjs[^\n]*语法错误/);
    writeFileSync(templatePath, originalTemplate);
    const cssPath = join(fixture, 'src/styles/main.css');
    const originalCss = readFileSync(cssPath, 'utf8');
    const validCss = originalCss + `\n/* !important in comment */
@media (prefers-reduced-motion: reduce) {
    .lint-first { animation: none !important; }
    .lint-second { transition: none !important; }
}`;
    writeFileSync(cssPath, validCss);
    const reducedMotion = lint();
    assert.equal(reducedMotion.status, 0, reducedMotion.stdout + reducedMotion.stderr);
    writeFileSync(cssPath, validCss + '\n.lint-bad { color: red !important; backdrop-filter: none; -webkit-backdrop-filter: none; }');
    const invalidCss = lint();
    assert.equal(invalidCss.status, 1);
    assert.match(invalidCss.stdout, /1 处白名单外 !important/);
    assert.match(invalidCss.stdout, /CSS 前缀层叠顺序异常 \(1 处\)/);
    assert.match(invalidCss.stdout, /src\/styles\/main\.css:\d+:\d+/);
    writeFileSync(cssPath, originalCss);
    const htmlPath = join(fixture, 'src/index.html');
    writeFileSync(htmlPath, readFileSync(htmlPath, 'utf8').replace('</body>',
        '<div id="uncached-description" class="settings-tab-panel"></div></body>'));
    const probePath = join(fixture, 'src/js/lint-probe.js');
    writeFileSync(probePath, "const notice = document.getElementById('uncached-description'); notice.hidden = true;");
    const ordinary = lint();
    assert.equal(ordinary.status, 0, ordinary.stdout + ordinary.stderr);
    writeFileSync(probePath, "import { dom } from './state/dom.js'; dom['uncached-description'].hidden = true;");
    const missing = lint();
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /dom 访问的 ID 未注册缓存: uncached-description/);
    assert.match(missing.stdout, /dom 访问的 ID 未声明 DOMCache 类型: uncached-description/);
    writeFileSync(probePath, "import { dom } from './state/dom.js'; const popup = dom.editModal; popup.hidden = true;");
    const modal = lint();
    assert.equal(modal.status, 1);
    assert.match(modal.stdout, /弹窗显示生命周期门禁失败/);
    rmSync(probePath);
    // 两个后续文件同时有语法错误，必须全部检查并报告，而非只检查目录中的首个模块。
    for (const name of ['zz-lint-invalid-a.js', 'zz-lint-invalid-b.js']) {
        writeFileSync(join(fixture, 'src/js', name), 'export const broken = ;\n');
    }
    const broken = lint();
    assert.equal(broken.status, 1, broken.stdout + broken.stderr);
    assert.match(broken.stdout, /zz-lint-invalid-a\.js/);
    assert.match(broken.stdout, /zz-lint-invalid-b\.js/);
    console.log('✅ lint 允许普通元素与无须缓存的 ID，拦截缺失的缓存/类型及弹窗越权隐藏，并报告多个 ESM 语法错误');
} finally {
    rmSync(fixture, { recursive: true, force: true });
}
