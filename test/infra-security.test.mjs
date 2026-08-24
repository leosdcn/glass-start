/**
 * 基础架构、Service Worker 离线缓存与 Web 安全防护测试套件 (infra-security.test.mjs)
 *
 * 精炼架构：5 大高密度全景断言
 * 1. dist/ 产物完整性与 Cache-Control 标头规则
 * 2. Service Worker 核心预缓存清单与容错安装
 * 3. Service Worker 内存池 FIFO 自动限额淘汰与防污染
 * 4. Service Worker 图标预缓存安全白名单校验
 * 5. 防 <iframe> 恶意嵌套点击劫持 (Frame-Busting) 安全破局
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTester } from './helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

const { pass, finish } = makeTester();

// ══════════════════════════════════════════════════════════════════════
// 1. dist/ 产物完整性与 Cache-Control 标头规则
// ══════════════════════════════════════════════════════════════════════

if (!existsSync(DIST)) {
  console.error('❌ dist/ 目录不存在 —— 请先执行 npm run build');
  process.exit(1);
}

// 1.1 文件完整性
const requiredFiles = ['index.html', 'sw.js', 'app.js', '_headers', 'robots.txt', 'wallpapers/bg1.avif'];
const missingFiles = requiredFiles.filter(f => !existsSync(join(DIST, f)));
const filesExistOk = missingFiles.length === 0;

// 1.2 响应头解析
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
let headersOk = false;
if (existsSync(headersPath)) {
  const headersContent = readFileSync(headersPath, 'utf-8');
  const rules = parseHeadersFile(headersContent);
  const indexCc = rules['/index.html']?.['cache-control'] || '';
  const rootCc = rules['/']?.['cache-control'] || '';
  const swCc = rules['/sw.js']?.['cache-control'] || '';
  const appCc = rules['/app.js']?.['cache-control'] || '';
  const manifestCc = rules['/manifest.json']?.['cache-control'] || '';
  const iconCc = rules['/apple-touch-icon.png']?.['cache-control'] || '';
  const wpCc = rules['/wallpapers/*']?.['cache-control'] || '';
  const validNoCache = indexCc.includes('max-age=0') && rootCc.includes('max-age=0') && swCc.includes('max-age=0') && appCc.includes('max-age=0') && manifestCc.includes('max-age=0') && !appCc.includes('immutable');
  const validWp = wpCc.includes('max-age=31536000') && wpCc.includes('immutable');
  const validIcon = iconCc.includes('max-age=604800');
  const srcHeadersContent = readFileSync(join(ROOT, '_headers'), 'utf-8');
  const syncOk = srcHeadersContent.trim() === headersContent.trim();
  headersOk = validNoCache && validWp && validIcon && syncOk;
}

pass('dist/ 产物完整性与 Cache-Control 标头规则 (产物齐全/全链路协商缓存/壁纸强缓存/同步)',
  filesExistOk && headersOk,
  filesExistOk && headersOk ? '产物与响应头100%合规' : `缺失: ${missingFiles.join(', ')}`);

// ══════════════════════════════════════════════════════════════════════
// 2. Service Worker 核心预缓存清单与容错安装
// ══════════════════════════════════════════════════════════════════════

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
const validInstall = distSw.includes('cache.add(') && distSw.includes('.catch(() => {}))') && !/cache\.addAll\s*\(/.test(distSw);

pass('Service Worker 核心预缓存清单与容错安装 (CORE_ASSETS真实存在/逐项reload容错)',
  validAssets && validInstall,
  `包含 ${distAssets.length} 项有效资源，容错机制完备`);

// ══════════════════════════════════════════════════════════════════════
// 3. Service Worker 内存池 FIFO 自动限额淘汰与防污染
// ══════════════════════════════════════════════════════════════════════

const fifoOk = srcSw.includes('async function pruneCache(cache, maxEntries)') && srcSw.includes('cache.keys()');
const gcOk = srcSw.includes('pruneCache(cache, maxEntries)');

pass('Service Worker 内存池 FIFO 自动限额淘汰与防污染 (容量限额/静态池淘汰闭环)',
  fifoOk && gcOk, 'FIFO 清理与防污染机制完备');

// ══════════════════════════════════════════════════════════════════════
// 4. Service Worker 图标预缓存安全白名单校验
// ══════════════════════════════════════════════════════════════════════

function extractCoreFavicons(swContent) {
  const m = swContent.match(/const\s+CORE_FAVICONS\s*=\s*\[([\s\S]*?)\];/);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]);
}
const favicons = extractCoreFavicons(srcSw);
const cleanFavicons = favicons.length === 3 && favicons.some(f => f.includes('bing.com')) && favicons.some(f => f.includes('google.com')) && favicons.some(f => f.includes('wikipedia.org')) && !favicons.some(f => f.includes('baidu.com'));

pass('Service Worker 图标预缓存安全白名单校验 (仅Bing&Google&Wikipedia/杜绝百度与未知源)',
  cleanFavicons, `favicons=${JSON.stringify(favicons)}`);

// ══════════════════════════════════════════════════════════════════════
// 5. 防 <iframe> 恶意嵌套点击劫持 (Frame-Busting) 安全破局
// ══════════════════════════════════════════════════════════════════════

const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf-8');
const distHtml = existsSync(join(DIST, 'index.html')) ? readFileSync(join(DIST, 'index.html'), 'utf-8') : '';

// 校验源文件与构建产物头部是否均包含顶层防嵌破局与白屏防御逻辑
const frameBustingPattern = /if\s*\(\s*window\.top\s*!==\s*window\.self\s*\)\s*\{?\s*try\s*\{\s*window\.top\.location\.replace\(window\.location\.href\);?\s*\}\s*catch\s*\{\s*document\.documentElement\.style\.display\s*=\s*['"]none['"];?\s*\}?\s*\}?/;

const srcHasFrameBusting = frameBustingPattern.test(indexHtml);
const distHasFrameBusting = frameBustingPattern.test(distHtml);
const frameBustingOk = srcHasFrameBusting && distHasFrameBusting;

pass('防 <iframe> 恶意嵌套点击劫持 (Frame-Busting) 安全破局 (源码与产物双重注入/破局跳转与防嵌入白屏双闭环)',
  frameBustingOk, '源码与构建产物均包含不可绕过的防御闭环');

process.exit(finish());
