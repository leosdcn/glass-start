import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let hasSips = false;
try {
  const check = spawnSync('sips', ['--version'], { stdio: 'ignore' });
  hasSips = check.status === 0;
} catch {
  hasSips = false;
}

if (!hasSips) {
  console.log('⚠️ 当前环境未检测到 sips（通常仅 macOS 支持），跳过图标 CLI 同步测试');
  process.exit(0);
}

// 执行完整 CLI，仅替换 HTTPS 传输边界；实际校验和 sips 转换均运行。
const root = mkdtempSync(join(tmpdir(), 'glass-icon-sync-'));
const png = readFileSync(new URL('../public/icons/github.com.png', import.meta.url));
const transport = `import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
export default { get(url, options, callback) {
  appendFileSync(process.env.ICON_REQUEST_LOG, url + '\\n');
  const request = new EventEmitter();
  request.setTimeout = () => request;
  queueMicrotask(() => {
    if (process.env.ICON_FAIL === '1') { request.emit('error', new Error('offline')); return; }
    const response = new EventEmitter();
    response.statusCode = 200; response.headers = {};
    callback(response);
    response.emit('data', Buffer.from(process.env.ICON_PNG, 'base64'));
    response.emit('end');
  });
  return request;
}};`;
const script = readFileSync(new URL('../scripts/sync-icons.mjs', import.meta.url), 'utf8')
  .replace("import https from 'node:https';", `import https from 'data:text/javascript;base64,${Buffer.from(transport).toString('base64')}';`);
const log = join(root, 'requests.log');
const icons = join(root, 'public/icons');
const normal = join(icons, 'example.test.png'), official = join(icons, 'qianwen.com.png');
const s2Url = 'https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https%3A%2F%2Fexample.test&size=128';
const officialUrl = 'https://img.alicdn.com/imgextra/i4/O1CN01OXv3EM1FN8t9W4P79_!!6000000000474-2-tps-80-80.png';
function run(args = [], fail = false) {
  writeFileSync(log, '');
  const result = spawnSync(process.execPath, [join(root, 'scripts/sync-icons.mjs'), ...args], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, ICON_REQUEST_LOG: log, ICON_PNG: png.toString('base64'), ICON_FAIL: fail ? '1' : '0' }
  });
  const requests = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  return { ...result, requests };
}
try {
  mkdirSync(join(root, 'scripts'));
  mkdirSync(icons, { recursive: true });
  writeFileSync(join(root, 'scripts/sync-icons.mjs'), script);
  writeFileSync(join(root, 'bookmarks.json'), JSON.stringify({ bookmarks: [
    { name: 'Normal', url: 'https://example.test', icon: './icons/example.test.png' },
    { name: 'Official', url: 'https://qianwen.com', icon: './icons/qianwen.com.png' }
  ], categories: [] }));
  writeFileSync(normal, png); writeFileSync(official, png);
  const reuse = run();
  assert.equal(reuse.status, 0, reuse.stdout + reuse.stderr);
  assert.deepEqual(reuse.requests, []);
  assert.deepEqual(readFileSync(normal), png);

  rmSync(normal);
  const missing = run();
  assert.equal(missing.status, 0, missing.stdout + missing.stderr);
  assert.deepEqual(missing.requests, [s2Url]);
  assert.equal(existsSync(normal), true);

  // 保留合法文件头的截断 PNG 也必须修复，不能只检查魔数和尺寸。
  writeFileSync(normal, png.subarray(0, 24));
  const corrupt = run();
  assert.equal(corrupt.status, 0, corrupt.stdout + corrupt.stderr);
  assert.deepEqual(corrupt.requests, [s2Url]);

  // 合法头尾和尺寸不能替代解码：缺少有效图像数据时仍须重新下载。
  const repairedPng = readFileSync(normal);
  writeFileSync(normal, Buffer.concat([png.subarray(0, 33), Buffer.alloc(12), png.subarray(-12)]));
  const invalidData = run();
  assert.equal(invalidData.status, 0, invalidData.stdout + invalidData.stderr);
  assert.deepEqual(invalidData.requests, [s2Url]);
  assert.deepEqual(readFileSync(normal), repairedPng);

  const refresh = run(['--refresh']);
  assert.equal(refresh.status, 0, refresh.stdout + refresh.stderr);
  assert.deepEqual(refresh.requests.sort(), [officialUrl, s2Url].sort());
  assert.equal(existsSync(normal), true);
  assert.equal(existsSync(official), true);

  const originalNormal = readFileSync(normal);
  const originalOfficial = readFileSync(official);
  const failed = run(['--refresh'], true);
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.deepEqual(readFileSync(normal), originalNormal);
  assert.deepEqual(readFileSync(official), originalOfficial);

  writeFileSync(official, Buffer.from('broken'));
  const repairOfficial = run();
  assert.equal(repairOfficial.status, 0, repairOfficial.stdout + repairOfficial.stderr);
  assert.deepEqual(repairOfficial.requests, [officialUrl]);
  assert.equal(readdirSync(icons).some(name => name.startsWith('.icon-sync-')), false);
  console.log('✅ 图标 CLI 复用有效 PNG、补齐缺失及损坏项；支持官方直链与 Google S2，失败保留原图并清理临时文件');
} finally {
  rmSync(root, { recursive: true, force: true });
}
