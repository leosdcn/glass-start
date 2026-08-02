/**
 * 零依赖静态检查：
 * 1. 提取 index.html 内所有内联 <script> 做语法校验（ESLint 无法直接覆盖内联脚本）
 * 2. 对根目录 .js / test 目录 .mjs 用 node --check 校验语法
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)));
let fail = 0;

// ---- 1. index.html 内联 <script> 语法校验 ----
const htmlPath = join(root, 'index.html');
if (statSync(htmlPath).isFile()) {
  const html = readFileSync(htmlPath, 'utf-8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  scripts.forEach((m, i) => {
    const code = m[1];
    const label = `index.html 内联 script #${i} (${code.length} chars)`;
    try {
      new vm.Script(code, { filename: `inline-${i}.js` });
      console.log(`✅ ${label} 语法通过`);
    } catch (e) {
      fail++;
      console.error(`❌ ${label} 语法错误: ${e.message}`);
    }
  });
}

// ---- 2. 根目录 .js + test/ .mjs 用 node --check ----
const jsFiles = ['build.js'].filter(f => statSync(join(root, f)).isFile());
const testDir = join(root, 'test');
const mjsFiles = readdirSync(testDir).filter(f => f.endsWith('.mjs')).map(f => join(testDir, f));

for (const f of [...jsFiles, ...mjsFiles]) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf-8' });
  if (r.status === 0) {
    console.log(`✅ node --check ${basename(f)} 通过`);
  } else {
    fail++;
    console.error(`❌ node --check ${basename(f)} 失败:\n${r.stderr}`);
  }
}

console.log(fail ? `\n✗ ${fail} 项检查失败` : '\n✅ 全部静态检查通过');
process.exit(fail ? 1 : 0);
