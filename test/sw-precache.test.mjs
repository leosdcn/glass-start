/**
 * BUG 5 回归测试：Service Worker 核心预缓存只允许包含真实存在的资源
 *
 * 回归背景：CORE_ASSETS 曾包含 './icon.svg' 与 './manifest.json'，但构建产物 dist/ 只有
 * index.html 与 sw.js（manifest.json 被 build.js 内联为 data URI，icon.svg 在仓库与产物中
 * 均不存在）。cache.addAll 遇任一 404 会整批 reject 并回滚，导致 './' 与 './index.html'
 * 也从未被预缓存（新装 PWA 首断网即命中 503 兜底）。修复后：
 *   1. CORE_ASSETS 只列 dist/ 中真实存在的资源
 *   2. 安装逻辑改为逐项 cache.add 并吞掉单项失败，不再使用 addAll
 *
 * 本测试为纯静态检查（不依赖 Chrome），由 run.mjs 在 npm run build 之后执行，
 * 因此 dist/ 必为最新产物。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTester } from './helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

const { pass, finish } = makeTester();
console.log('🔍 校验 Service Worker 核心预缓存资源清单 (CORE_ASSETS)...');

if (!existsSync(join(DIST, 'sw.js'))) {
  console.error('❌ dist/sw.js 不存在 —— 请先执行 npm run build');
  process.exit(1);
}

/** 从 sw.js 源码中提取 CORE_ASSETS 字符串数组 */
function extractCoreAssets(swContent) {
  const m = swContent.match(/const\s+CORE_ASSETS\s*=\s*\[([\s\S]*?)\];/);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]);
}

const srcSw = readFileSync(join(ROOT, 'sw.js'), 'utf-8');
const distSw = readFileSync(join(DIST, 'sw.js'), 'utf-8');

const srcAssets = extractCoreAssets(srcSw);
const distAssets = extractCoreAssets(distSw);

// 1. 结构完整性：两处清单都能被解析，且构建后保持一致（build 仅替换 CORE_CACHE 版本号）
pass('源码与构建产物的 CORE_ASSETS 清单一致', JSON.stringify(srcAssets) === JSON.stringify(distAssets),
  `src=${JSON.stringify(srcAssets)} dist=${JSON.stringify(distAssets)}`);

// 2. 回归核心：不再预缓存不存在的 icon.svg / manifest.json
pass('CORE_ASSETS 不再包含 icon.svg', !(distAssets || []).includes('./icon.svg'), JSON.stringify(distAssets));
pass('CORE_ASSETS 不再包含 manifest.json', !(distAssets || []).includes('./manifest.json'), JSON.stringify(distAssets));

// 3. 存在性不变量：清单中每个条目在 dist/ 中真实存在（防止未来再引入不存在的资源）
const missing = [];
for (const asset of distAssets || []) {
  const resolved = asset === './' ? DIST : join(DIST, asset.replace(/^\.\//, ''));
  if (!existsSync(resolved) || (asset !== './' && !statSync(resolved).isFile())) {
    missing.push(asset);
  }
}
pass(`CORE_ASSETS 每个条目均真实存在于 dist/ (${(distAssets || []).length} 项)`, missing.length === 0,
  missing.length ? `缺失: ${missing.join(', ')}` : distAssets.join(', '));

// 4. 关键资源确实在清单内（离线兜底的前提）
pass('CORE_ASSETS 包含 "./" 与 "./index.html"',
  (distAssets || []).includes('./') && (distAssets || []).includes('./index.html'),
  JSON.stringify(distAssets));

// 5. 安装逻辑：逐项 cache.add + 单项容错，禁止整体失败的 addAll
pass('安装逻辑使用逐项 cache.add 并容错单项失败',
  distSw.includes('cache.add(asset)') && distSw.includes('.catch(() => {}))'),
  'install 处理函数已改为 Promise.all(CORE_ASSETS.map(asset => cache.add(asset).catch(() => {})))');
pass('安装逻辑不再调用 cache.addAll()', !/cache\.addAll\s*\(/.test(distSw), 'addAll 调用已从 sw.js 中移除');

// 6. 前提校验：dist/ 产物确实不含 manifest.json / icon.svg（架构基线，防止静默漂移）
pass('构建产物不含 manifest.json / icon.svg（内联架构基线）',
  !existsSync(join(DIST, 'manifest.json')) && !existsSync(join(DIST, 'icon.svg')),
  'dist 仅含 index.html 与 sw.js');

process.exit(finish());
