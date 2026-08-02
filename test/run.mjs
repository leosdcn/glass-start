import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

console.log('▶ npm run build (同步 bookmarks 并重建 dist)');
const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
if (build.status !== 0) {
  console.error('✗ 构建失败，终止测试');
  process.exit(1);
}

const files = readdirSync(__dirname).filter(f => f.endsWith('.test.mjs')).sort();
console.log(`\n发现 ${files.length} 个测试文件`);
let failed = 0;
for (const f of files) {
  console.log(`\n▸ ${f}`);
  const r = spawnSync('node', [join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) {
    failed++;
    console.error(`  ✗ ${f} 失败 (exit ${r.status})`);
  }
}

console.log(`\n=== ${files.length - failed}/${files.length} 测试文件通过 ===`);
process.exit(failed ? 1 : 0);
