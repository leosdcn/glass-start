import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// 终端格式化排版与 ANSI 彩色工具
const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
    reset: isTTY ? '\x1b[0m' : '',
    bold: isTTY ? '\x1b[1m' : '',
    dim: isTTY ? '\x1b[2m' : '',
    cyan: isTTY ? '\x1b[36m' : '',
    green: isTTY ? '\x1b[32m' : '',
    yellow: isTTY ? '\x1b[33m' : '',
    red: isTTY ? '\x1b[31m' : '',
    gray: isTTY ? '\x1b[90m' : '',
};

const LINE_WIDTH = 72;
const HR_DOUBLE = '═'.repeat(LINE_WIDTH);
const HR_SINGLE = '─'.repeat(LINE_WIDTH);

const startTime = Date.now();
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
  process.exit(0);
}

// 执行预构建
if (!skipBuildArg) {
  console.log(`${c.cyan}▶ 执行生产预构建 (npm run build)...${c.reset}`);
  const buildResult = spawnSync('npm', ['run', 'build'], { cwd: rootDir, stdio: 'inherit' });
  if (buildResult.status !== 0) {
    console.error(`\n${c.red}❌ 构建失败，已终止测试套件执行${c.reset}\n`);
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
  const activeWorkers = Math.min(CONCURRENCY, toRun.length);
  console.log(`\n${c.cyan}─── 🚀 运行待测套件清单 (待测: ${toRun.length} 项, 并发数: ${activeWorkers}) ${'─'.repeat(Math.max(4, LINE_WIDTH - 50))}${c.reset}`);
  
  async function worker() {
    while (index < toRun.length) {
      const item = toRun[index++];
      console.log(`\n${c.bold}${c.cyan}▸ [Running] ${item.filename}${c.reset}`);
      
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
        console.log(`  ${c.green}✅ ${item.filename} 通过${c.reset}`);
      } else {
        failedCount++;
        delete cache[item.filename];
        saveCache();
        console.error(`  ${c.red}❌ ${item.filename} 失败 (exit ${code})${c.reset}`);
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
