import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(__dirname, '..');
const cacheFile = join(__dirname, '.cache.json');

// 解析命令行参数
const args = process.argv.slice(2);
const force = args.includes('--force') || args.includes('-f');
const skipBuildArg = args.includes('--no-build');
const pattern = args.find(a => !a.startsWith('-'));

// 计算指定文件的 MD5
function getFileHash(filepath) {
  try {
    if (!existsSync(filepath)) return '';
    return createHash('md5').update(readFileSync(filepath)).digest('hex');
  } catch {
    return '';
  }
}

// 核心依赖文件的哈希组合（任意源文件修改都会触发依赖它的测试重新运行）
const sharedFiles = [
  join(rootDir, 'app.js'),
  join(rootDir, 'index.html'),
  join(rootDir, 'sw.js'),
  join(rootDir, 'build.js'),
  join(rootDir, 'bookmarks.json'),
  join(__dirname, 'helpers.mjs'),
  join(__dirname, 'cdp.mjs'),
  join(__dirname, 'server.mjs'),
];

const sharedHash = sharedFiles.map(f => getFileHash(f)).join(':');

// 读取缓存
let cache = {};
if (!force && existsSync(cacheFile)) {
  try {
    cache = JSON.parse(readFileSync(cacheFile, 'utf-8'));
  } catch {
    cache = {};
  }
}

// 扫描所有 test/*.test.mjs
let files = readdirSync(__dirname).filter(f => f.endsWith('.test.mjs')).sort();

if (pattern) {
  files = files.filter(f => f.toLowerCase().includes(pattern.toLowerCase()));
  console.log(`🔍 匹配模式 "${pattern}": 找到 ${files.length} 个测试文件`);
}

if (files.length === 0) {
  console.log('未找到匹配的测试文件');
  process.exit(0);
}

// 识别命中缓存与需要运行的测试文件
const toRun = [];
const skipped = [];

for (const f of files) {
  const fileHash = createHash('md5')
    .update(sharedHash + ':' + getFileHash(join(__dirname, f)))
    .digest('hex');

  if (!force && cache[f] === fileHash) {
    skipped.push(f);
  } else {
    toRun.push({ filename: f, hash: fileHash });
  }
}

if (skipped.length > 0) {
  console.log(`⚡ [缓存命中] 跳过 ${skipped.length} 个未修改测试:`);
  for (const s of skipped) {
    console.log(`  ✔ ${s} (cached)`);
  }
}

if (toRun.length === 0) {
  console.log(`\n✨ 所有 ${files.length} 个测试文件均命中缓存通过！(耗时 <10ms)`);
  process.exit(0);
}

console.log(`\n🚀 准备运行 ${toRun.length} 个待测文件...`);

// 执行构建
if (!skipBuildArg) {
  console.log('▶ npm run build (同步 bookmarks 并重建 dist)');
  const buildResult = spawnSync('npm', ['run', 'build'], { cwd: rootDir, stdio: 'inherit' });
  if (buildResult.status !== 0) {
    console.error('✗ 构建失败，终止测试');
    process.exit(1);
  }
}

// 写入缓存文件辅助函数
function saveCache() {
  try {
    writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.error('缓存写入失败:', err.message);
  }
}

// 运行测试队列（限制并发数，防止很多 CDP/Puppeteer 实例同时拉起耗尽系统资源）
const CONCURRENCY = 3;
let failedCount = 0;

async function runQueue() {
  let index = 0;
  
  async function worker() {
    while (index < toRun.length) {
      const item = toRun[index++];
      console.log(`\n▸ [Running] ${item.filename}`);
      
      const code = await new Promise((resolve) => {
        const child = spawn('node', [join(__dirname, item.filename)], {
          cwd: rootDir,
          stdio: 'inherit'
        });
        child.on('close', resolve);
      });

      if (code === 0) {
        cache[item.filename] = item.hash;
        saveCache();
        console.log(`  ✅ ${item.filename} 通过`);
      } else {
        failedCount++;
        delete cache[item.filename];
        saveCache();
        console.error(`  ❌ ${item.filename} 失败 (exit ${code})`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, toRun.length) }, () => worker());
  await Promise.all(workers);
}

await runQueue();

console.log(`\n=== 测试完成: ${files.length - failedCount - skipped.length}/${toRun.length} 个运行项通过，${skipped.length} 个命中缓存 ===`);
process.exit(failedCount ? 1 : 0);

