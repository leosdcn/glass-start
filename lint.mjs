/**
 * 根目录零依赖静态语法与格式检查：
 * 1. 提取 index.html 内所有内联 <script> 做语法校验
 * 2. 对根目录 JavaScript 核心脚本 (build.js, sw.js) 用 node --check 校验语法
 * 3. 对根目录 JSON 配置文件 (bookmarks.json, manifest.json, package.json) 做合法性校验
 */
import { readFileSync, statSync } from 'node:fs';
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
    const fullTag = m[0];
    const code = m[1];
    const label = `index.html 内联 script #${i} (${code.length} chars)`;
    try {
      if (fullTag.includes('application/ld+json')) {
        JSON.parse(code);
      } else {
        new vm.Script(code, { filename: `inline-${i}.js` });
      }
      console.log(`✅ ${label} 语法通过`);
    } catch (e) {
      fail++;
      console.error(`❌ ${label} 语法错误: ${e.message}`);
    }
  });
}

// ---- 2. 根目录 JS 脚本 (build.js, sw.js, server.js) 用 node --check 校验 ----
const jsFiles = ['build.js', 'sw.js', 'server.js'].filter(f => statSync(join(root, f)).isFile());

for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf-8' });
  if (r.status === 0) {
    console.log(`✅ node --check ${basename(f)} 通过`);
  } else {
    fail++;
    console.error(`❌ node --check ${basename(f)} 失败:\n${r.stderr}`);
  }
}

// ---- 3. 根目录 JSON 配置文件合法性校验 ----
const jsonFiles = ['bookmarks.json', 'manifest.json', 'package.json'].filter(f => statSync(join(root, f)).isFile());

for (const f of jsonFiles) {
  try {
    const content = readFileSync(join(root, f), 'utf-8');
    JSON.parse(content);
    console.log(`✅ JSON 格式 ${basename(f)} 通过`);
  } catch (e) {
    fail++;
    console.error(`❌ JSON 格式 ${basename(f)} 语法错误: ${e.message}`);
  }
}

console.log(fail ? `\n✗ ${fail} 项检查失败` : '\n✅ 全部静态检查通过');
process.exit(fail ? 1 : 0);
