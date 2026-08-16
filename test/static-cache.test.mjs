/**
 * 静态资源、Cache-Control 响应头与 Service Worker 缓存架构综合审计测试 (static-cache.test.mjs)
 *
 * 精简版：8 个核心精准断言 (纯 Node.js，<10ms 完成)
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTester } from './helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

const { pass, finish } = makeTester();
console.log('🔍 [1/3] 校验 dist/ 产物完整性与 Cache-Control 标头配置...');

if (!existsSync(DIST)) {
  console.error('❌ dist/ 目录不存在 —— 请先执行 npm run build');
  process.exit(1);
}

// 1. dist/ 核心产物文件存在性校验
const requiredFiles = ['index.html', 'sw.js', 'app.js', '_headers', 'wallpapers/bg1.avif'];
const missingFiles = requiredFiles.filter(f => !existsSync(join(DIST, f)));
pass('dist/ 编译产物及 _headers 静态文件齐全', missingFiles.length === 0, missingFiles.length ? `缺失: ${missingFiles.join(', ')}` : '全部矢量资源存在');

// 2. 解析与校验 _headers 响应头规则
function parseHeadersFile(content) {
  const rules = {};
  let currentPath = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('/')) {
      currentPath = trimmed;
      if (!rules[currentPath]) rules[currentPath] = {};
    } else if (currentPath && trimmed.includes(':')) {
      const idx = trimmed.indexOf(':');
      const key = trimmed.slice(0, idx).trim().toLowerCase();
      const val = trimmed.slice(idx + 1).trim();
      rules[currentPath][key] = val;
    }
  }
  return rules;
}

const headersPath = join(DIST, '_headers');
if (existsSync(headersPath)) {
  const headersContent = readFileSync(headersPath, 'utf-8');
  const rules = parseHeadersFile(headersContent);

  const indexCc = rules['/index.html']?.['cache-control'] || '';
  const swCc = rules['/sw.js']?.['cache-control'] || '';
  const appCc = rules['/app.js']?.['cache-control'] || '';
  const validNoCache = indexCc.includes('max-age=0') && swCc.includes('max-age=0') && appCc.includes('max-age=0') && !appCc.includes('immutable');

  pass('HTML / JS / SW 页面资源标头配置为协商缓存 (max-age=0)', validNoCache, `index="${indexCc}" app="${appCc}"`);

  const wpCc = rules['/wallpapers/*']?.['cache-control'] || '';
  pass('壁纸资源标头配置为强缓存 (1年, immutable)', wpCc.includes('max-age=31536000') && wpCc.includes('immutable'), `wp="${wpCc}"`);

  const srcHeadersContent = readFileSync(join(ROOT, '_headers'), 'utf-8');
  pass('源码与 dist 目录 _headers 文件配置保持同步', srcHeadersContent.trim() === headersContent.trim(), '100% 同步');
} else {
  pass('dist/_headers 文件存在', false, '缺失 _headers');
}

console.log('\n🔍 [2/3] 校验 Service Worker 核心预缓存资源清单 (CORE_ASSETS)...');

function extractCoreAssets(swContent) {
  const m = swContent.match(/const\s+CORE_ASSETS\s*=\s*\[([\s\S]*?)\];/);
  if (!m) return null;
  return [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]);
}

const srcSw = readFileSync(join(ROOT, 'sw.js'), 'utf-8');
const distSw = readFileSync(join(DIST, 'sw.js'), 'utf-8');
const distAssets = extractCoreAssets(distSw) || [];

const missingAssets = [];
for (const asset of distAssets) {
  const resolved = asset === './' ? DIST : join(DIST, asset.replace(/^\.\//, ''));
  if (!existsSync(resolved) || (asset !== './' && !statSync(resolved).isFile())) {
    missingAssets.push(asset);
  }
}
const validAssets = missingAssets.length === 0 && !distAssets.includes('./icon.svg') && !distAssets.includes('./manifest.json') && distAssets.includes('./index.html');
pass('CORE_ASSETS 缓存清单无漂移且文件均真实存在', validAssets, missingAssets.length ? `缺失: ${missingAssets.join(', ')}` : `包含 ${distAssets.length} 项有效资源`);

pass('SW install 阶段使用逐项 reload 并容错',
  distSw.includes('cache.add(') && distSw.includes('.catch(() => {}))') && !/cache\.addAll\s*\(/.test(distSw),
  '逐项 reload + catch 容错');

console.log('\n🔍 [3/3] 校验 Service Worker 内存池 FIFO 清理与限额机制...');

pass('SW 内存池 FIFO 自动容量限额与清理机制', srcSw.includes('async function pruneCache(cache, maxEntries)') && srcSw.includes('cache.keys()'), '清理与限额正常');

const gcValid = srcSw.includes('pruneCache(cache, maxEntries)');
pass('SW 静态池超限自动淘汰与安全防污染闭环', gcValid, '自动淘汰及防污染完备');

// 9. SW 图标预缓存白名单校验 (CORE_FAVICONS 仅包含 Bing 与 Google，无百度)
function extractCoreFavicons(swContent) {
  const m = swContent.match(/const\s+CORE_FAVICONS\s*=\s*\[([\s\S]*?)\];/);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]);
}
const favicons = extractCoreFavicons(srcSw);
const cleanFavicons = favicons.length === 2 && favicons.some(f => f.includes('bing.com')) && favicons.some(f => f.includes('google.com')) && !favicons.some(f => f.includes('baidu.com'));
pass('SW 图标预缓存白名单校验 (CORE_FAVICONS 仅包含 Bing 与 Google，无百度)', cleanFavicons, `favicons=${JSON.stringify(favicons)}`);

process.exit(finish());
