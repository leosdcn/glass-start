import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir, cpus } from 'node:os';

// 仅清理本次测试持有的进程组和独占临时目录。
const runTempDir = mkdtempSync(join(tmpdir(), 'glass-start-run-'));
const runningChildProcesses = new Set();
function cleanupLingeringTestProcesses() {
  for (const child of runningChildProcesses) {
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }
  try { rmSync(runTempDir, { recursive: true, force: true }); } catch {}
}

// 注册退出信号保护
process.on('SIGINT', () => {
  for (const child of runningChildProcesses) {
    try { child.kill('SIGKILL'); } catch {}
  }
  cleanupLingeringTestProcesses();
  process.exit(130);
});
process.on('SIGTERM', () => {
  for (const child of runningChildProcesses) {
    try { child.kill('SIGKILL'); } catch {}
  }
  cleanupLingeringTestProcesses();
  process.exit(143);
});
process.on('exit', () => {
  cleanupLingeringTestProcesses();
});

// 终端格式化排版与 ANSI 彩色工具
import { c, LINE_WIDTH, HR_DOUBLE } from '../scripts/terminal.cjs';

const startTime = Date.now();
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(__dirname, '..');
const cacheFile = join(__dirname, '.cache.json');

// 解析命令行参数
const args = process.argv.slice(2);
const force = args.includes('--force') || args.includes('-f');
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

// 递归计算源码目录的文件签名映射
function getDirHash(dirPath) {
  let hashStr = '';
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true, recursive: true });
    for (const ent of entries) {
      if (ent.isFile() && !ent.name.startsWith('.')) {
        const fullPath = join(ent.parentPath || ent.path, ent.name);
        hashStr += ent.name + ':' + getFileHash(fullPath) + ';';
      }
    }
  } catch {}
  return createHash('md5').update(hashStr).digest('hex');
}

// 核心源码输入指纹（用于智能感知 dist/ 产物是否滞后）
function getSrcBuildFingerprint() {
  const parts = [
    getDirHash(join(rootDir, 'src')),
    getDirHash(join(rootDir, 'public')),
    getFileHash(join(rootDir, 'bookmarks.json')),
    getFileHash(join(rootDir, 'package.json')),
    getFileHash(join(rootDir, 'scripts', 'build.js')),
    getFileHash(join(rootDir, 'scripts', 'terminal.cjs')),
    getFileHash(join(rootDir, 'scripts', 'watch.cjs')),
    getFileHash(join(rootDir, 'sw.js')),
  ];
  return createHash('md5').update(parts.join(':')).digest('hex');
}

// 检查 dist 产物是否存在且与源码保持同步
function isDistOutOfDate(currentSrcFingerprint, cacheData) {
  const requiredDist = [
    join(rootDir, 'dist', 'index.html'),
    join(rootDir, 'dist', 'app.js'),
    join(rootDir, 'dist', 'sw.js'),
    join(rootDir, 'dist', '_headers'),
  ];
  for (const f of requiredDist) {
    if (!existsSync(f)) return true;
  }
  return cacheData.__srcBuildFingerprint !== currentSrcFingerprint;
}

// 核心依赖文件的哈希组合（任意源文件修改都会触发依赖它的测试重新运行）
const sharedFiles = [
  join(rootDir, 'dist', 'app.js'),
  join(rootDir, 'src', 'index.html'),
  join(rootDir, 'sw.js'),
  join(rootDir, 'scripts', 'build.js'),
  join(rootDir, 'scripts', 'terminal.cjs'),
  join(rootDir, 'scripts', 'watch.cjs'),
  join(rootDir, 'bookmarks.json'),
  join(__dirname, 'helpers.mjs'),
  join(__dirname, 'cdp.mjs'),
  join(__dirname, 'server.mjs'),
];

let sharedHash = sharedFiles.map(f => getFileHash(f)).join(':');

// 读取缓存
let cache = {};
if (!force && existsSync(cacheFile)) {
  try {
    cache = JSON.parse(readFileSync(cacheFile, 'utf-8'));
  } catch {
    cache = {};
  }
}

// 智能构建感知：源码有变动则自动补建，产物有效则 0ms 免构建放行
const currentSrcFp = getSrcBuildFingerprint();
const needsBuild = force || isDistOutOfDate(currentSrcFp, cache);

if (needsBuild) {
  console.log(`${c.cyan}⚡ 检测到源码变动或首次运行，自动执行预构建 (npm run build)...${c.reset}`);
  const buildResult = spawnSync('npm', ['run', 'build'], { cwd: rootDir, stdio: 'inherit' });
  if (buildResult.status !== 0) {
    console.error(`\n${c.red}❌ 构建失败，已终止测试套件执行${c.reset}\n`);
    process.exit(1);
  }
  cache.__srcBuildFingerprint = currentSrcFp;
  // 构建后更新 sharedHash
  sharedHash = sharedFiles.map(f => getFileHash(f)).join(':');
} else {
  console.log(`${c.dim}⏩ [构建感知] dist/ 产物已是最新，自动跳过重复构建 (0ms)${c.reset}`);
}

console.log(`\n${c.cyan}${HR_DOUBLE}${c.reset}`);
console.log(`${c.bold}${c.cyan}🧪 Glass Start — 自动化端到端与架构综合测试套件 (Test Suite)${c.reset}`);
console.log(`${c.cyan}${HR_DOUBLE}${c.reset}\n`);

// 扫描所有 test/*.test.mjs
let files = readdirSync(__dirname).filter(f => f.endsWith('.test.mjs')).sort();

if (pattern) {
  files = files.filter(f => f.toLowerCase().includes(pattern.toLowerCase()));
  console.log(`${c.cyan}🔍 匹配过滤模式 "${pattern}": 找到 ${files.length} 个测试文件${c.reset}\n`);
}

if (files.length === 0) {
  console.log(`${c.yellow}⚠️ 未找到匹配的测试文件${c.reset}\n`);
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
  console.log(`${c.yellow}⚡ [缓存命中]${c.reset} 跳过 ${skipped.length} 个未修改测试文件:`);
  for (const s of skipped) {
    console.log(`  ${c.green}✔${c.reset} ${c.dim}${s} (cached)${c.reset}`);
  }
  console.log('');
}

if (toRun.length === 0) {
  console.log(`${c.gray}${HR_DOUBLE}${c.reset}`);
  console.log(`${c.green}${c.bold}✨ 全部 ${files.length} 个测试文件均命中缓存通过！${c.reset}${c.dim} (耗时: <10ms)${c.reset}`);
  console.log(`${c.gray}${HR_DOUBLE}${c.reset}\n`);
  saveCache();
  process.exit(0);
}

// 写入缓存文件辅助函数
function saveCache() {
  try {
    writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.error('缓存写入失败:', err.message);
  }
}

// 最长处理时间优先调度 (LPT): 优先将重型 UI 套件分发给并发 Worker，杜绝末尾长尾阻塞
const ESTIMATED_WEIGHTS = {
  'ui-overlay-modals.test.mjs': 100,
  'ui-screen-gestures.test.mjs': 90,
  'lifecycle-diag.test.mjs': 50,
  'data-features.test.mjs': 40,
  'infra-security.test.mjs': 10
};
toRun.sort((a, b) => (ESTIMATED_WEIGHTS[b.filename] || 50) - (ESTIMATED_WEIGHTS[a.filename] || 50));

// 运行测试队列（动态并发支持，兼顾系统 CPU 核心数与 Chrome 进程承载）
const cpuCount = cpus()?.length || 4;
const CONCURRENCY = Math.min(Math.max(cpuCount, 4), 6);
let failedCount = 0;

async function runQueue() {
  let index = 0;
  const activeWorkers = Math.min(CONCURRENCY, toRun.length);
  console.log(`\n${c.cyan}─── 🚀 运行待测套件清单 (待测: ${toRun.length} 项, 并发数: ${activeWorkers}) ${'─'.repeat(Math.max(4, LINE_WIDTH - 50))}${c.reset}`);
  
  async function worker() {
    while (index < toRun.length) {
      const item = toRun[index++];
      console.log(`\n${c.bold}${c.cyan}▸ [Running] ${item.filename}${c.reset}`);
      
      const startSuiteTime = Date.now();
      const code = await new Promise((resolve) => {
        const child = spawn('node', [join(__dirname, item.filename)], {
          cwd: rootDir,
          stdio: 'inherit',
          detached: process.platform !== 'win32',
          env: { ...process.env, GLASS_TEST_TMPDIR: runTempDir }
        });
        runningChildProcesses.add(child);
        child.on('close', (res) => {
          runningChildProcesses.delete(child);
          resolve(res);
        });
      });
      const suiteDuration = ((Date.now() - startSuiteTime) / 1000).toFixed(2);

      if (code === 0) {
        cache[item.filename] = item.hash;
        saveCache();
        console.log(`  ${c.green}✅ ${item.filename} 通过${c.reset}${c.dim} (耗时: ${suiteDuration}s)${c.reset}`);
      } else {
        failedCount++;
        delete cache[item.filename];
        saveCache();
        console.error(`  ${c.red}❌ ${item.filename} 失败 (exit ${code})${c.reset}${c.dim} (耗时: ${suiteDuration}s)${c.reset}`);
      }
    }
  }

  const workers = Array.from({ length: activeWorkers }, () => worker());
  await Promise.all(workers);
}

await runQueue();

const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`\n${c.gray}${HR_DOUBLE}${c.reset}`);
if (failedCount === 0) {
  console.log(`${c.green}${c.bold}✨ 全部测试套件通过！${c.reset}${c.dim} (${toRun.length}/${toRun.length} 运行项通过, ${skipped.length} 命中缓存, 总耗时: ${elapsed}s)${c.reset}`);
} else {
  console.log(`${c.red}${c.bold}❌ 测试未通过！${c.reset}${c.dim} (${failedCount} 项失败, ${toRun.length - failedCount} 项通过, 总耗时: ${elapsed}s)${c.reset}`);
}
console.log(`${c.gray}${HR_DOUBLE}${c.reset}\n`);

process.exit(failedCount ? 1 : 0);
