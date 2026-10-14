import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    const lint = () => spawnSync(process.execPath, ['scripts/lint.mjs'], { cwd: fixture, encoding: 'utf8' });
    const clean = lint();
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    // 两个后续文件同时有语法错误，必须全部检查并报告，而非只检查目录中的首个模块。
    for (const name of ['zz-lint-invalid-a.js', 'zz-lint-invalid-b.js']) {
        writeFileSync(join(fixture, 'src/js', name), 'export const broken = ;\n');
    }
    const broken = lint();
    assert.equal(broken.status, 1, broken.stdout + broken.stderr);
    assert.match(broken.stdout, /zz-lint-invalid-a\.js/);
    assert.match(broken.stdout, /zz-lint-invalid-b\.js/);
    console.log('✅ lint 逐文件检查 ESM，后续多个语法错误均报告且返回失败');
} finally {
    rmSync(fixture, { recursive: true, force: true });
}
