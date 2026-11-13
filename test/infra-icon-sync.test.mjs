import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const hasSips = spawnSync('sips', ['--version'], { stdio: 'ignore' }).status === 0;
const officialHost = 'official.example';
const officialUrl = 'https://assets.example/official.png';
// 两张独立于站内资源的有效灰色 PNG，分别为 19×19 和 128×128。
const smallFixture = 'iVBORw0KGgoAAAANSUhEUgAAABMAAAATCAAAAABXO2kQAAAAEUlEQVR42mNowAQMo2J0EQMAAFa0gUbBi0UAAAAASUVORK5CYII=';
const largeFixture = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAAAAADmVT4XAAAAWUlEQVR42u3OIQEAAAACIKc73RkWWEB6FgEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBgXdgvAQB4V1F2L0AAAAASUVORK5CYII=';

test('图标 CLI 下载、尺寸规范化、缓存修复与失败回滚', () => {
  const png = Buffer.from(largeFixture, 'base64');
  const transport = `import { EventEmitter } from 'node:events';
import { appendFileSync } from 'node:fs';
export default { get(url, options, callback) {
  appendFileSync(process.env.ICON_REQUEST_LOG, url + '\\n');
  const request = new EventEmitter();
  request.setTimeout = () => request;
  queueMicrotask(() => {
    if (process.env.ICON_FAIL === 'network') { request.emit('error', new Error('offline')); return; }
    const response = new EventEmitter();
    response.statusCode = 200; response.headers = {};
    callback(response);
    const s2 = url.startsWith('https://t2.gstatic.com/');
    const target = s2 ? new URL(url).searchParams.get('url') : '';
    const failure = process.env.ICON_FAIL;
    const invalid = failure === 'image' || (failure === 'official-html' && !s2)
      || (failure === 'primary-html' && target === 'https://example.test')
      || (failure === 'example-html' && target.endsWith('example.test'));
    const image = s2 ? process.env.ICON_SMALL_PNG : process.env.ICON_LARGE_PNG;
    response.emit('data', invalid ? Buffer.from('<html>not an image</html>') : Buffer.from(image, 'base64'));
    response.emit('end');
  });
  return request;
}};`;
  const source = readFileSync(new URL('../scripts/sync-icons.mjs', import.meta.url), 'utf8');
  const transportImport = "import https from 'node:https';";
  const entryPoint = 'main().catch(';
  assert.ok(source.includes(transportImport) && source.includes(entryPoint), '图标测试夹具需要适配同步脚本入口');
  const script = source
    .replace(transportImport, `import https from 'data:text/javascript;base64,${Buffer.from(transport).toString('base64')}';`)
    .replace(entryPoint, `OFFICIAL_HOST_SOURCES.set(${JSON.stringify(officialHost)}, ${JSON.stringify(officialUrl)});\n${entryPoint}`);
  const root = mkdtempSync(join(tmpdir(), 'glass-icon-sync-'));
  const log = join(root, 'requests.log');
  const icons = join(root, 'public/icons');
  const normal = join(icons, 'example.test.png'), official = join(icons, officialHost + '.png');
  const s2Url = 'https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https%3A%2F%2Fexample.test&size=128';
  const wwwUrl = s2Url.replace('%2F%2Fexample.test', '%2F%2Fwww.example.test');
  const officialFallback = s2Url.replace('example.test', officialHost);

  function resizedPng(name, height, width) {
    const path = join(root, name);
    writeFileSync(path, png);
    execFileSync('sips', ['-z', String(height), String(width), path], { stdio: 'ignore' });
    return readFileSync(path).toString('base64');
  }

  try {
    const smallPng = hasSips ? resizedPng('small.png', 19, 16) : smallFixture;
    const largePng = hasSips ? resizedPng('large.png', 256, 128) : largeFixture;
    function run(args = [], failure = '') {
      writeFileSync(log, '');
      const result = spawnSync(process.execPath, [join(root, 'scripts/sync-icons.mjs'), ...args], {
        cwd: root, encoding: 'utf8',
        env: { ...process.env, ICON_REQUEST_LOG: log, ICON_SMALL_PNG: smallPng, ICON_LARGE_PNG: largePng, ICON_FAIL: failure }
      });
      const requests = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
      return { ...result, requests };
    }

    mkdirSync(join(root, 'scripts'));
    mkdirSync(icons, { recursive: true });
    writeFileSync(join(root, 'scripts/sync-icons.mjs'), script);
    writeFileSync(join(root, 'scripts/terminal.cjs'), readFileSync(new URL('../scripts/terminal.cjs', import.meta.url)));
    writeFileSync(join(root, 'bookmarks.json'), JSON.stringify({ bookmarks: [
      { name: 'Normal', url: 'https://example.test', icon: './icons/example.test.png' },
      { name: 'Official', url: 'https://' + officialHost, icon: './icons/' + officialHost + '.png' }
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
    const small = readFileSync(normal);
    assert.deepEqual([small.readUInt32BE(16), small.readUInt32BE(20)], [19, 19]);

    // 保留合法文件头的截断 PNG 也必须修复
    writeFileSync(normal, png.subarray(0, 24));
    const corrupt = run();
    assert.equal(corrupt.status, 0, corrupt.stdout + corrupt.stderr);
    assert.deepEqual(corrupt.requests, [s2Url]);

    if (hasSips) {
      // 文件头和尾标有效，但像素数据损坏时需要重新下载。
      const repairedPng = readFileSync(normal);
      writeFileSync(normal, Buffer.concat([png.subarray(0, 33), Buffer.alloc(12), png.subarray(-12)]));
      const invalidData = run();
      assert.equal(invalidData.status, 0, invalidData.stdout + invalidData.stderr);
      assert.deepEqual(invalidData.requests, [s2Url]);
      assert.deepEqual(readFileSync(normal), repairedPng);
    }

    const refresh = run(['--refresh']);
    assert.equal(refresh.status, 0, refresh.stdout + refresh.stderr);
    assert.deepEqual(refresh.requests.sort(), [officialUrl, s2Url].sort());
    assert.equal(existsSync(normal), true);
    const large = readFileSync(official);
    assert.deepEqual([large.readUInt32BE(16), large.readUInt32BE(20)], [128, 128]);

    const originalNormal = readFileSync(normal);
    const originalOfficial = readFileSync(official);
    for (const failure of ['network', 'image']) {
      const failed = run(['--refresh'], failure);
      assert.equal(failed.status, 1, failed.stdout + failed.stderr);
      assert.deepEqual(readFileSync(normal), originalNormal);
      assert.deepEqual(readFileSync(official), originalOfficial);
    }

    writeFileSync(official, Buffer.from('broken'));
    const repairOfficial = run();
    assert.equal(repairOfficial.status, 0, repairOfficial.stdout + repairOfficial.stderr);
    assert.deepEqual(repairOfficial.requests, [officialUrl]);

    rmSync(official);
    const officialHtml = run([], 'official-html');
    assert.equal(officialHtml.status, 0, officialHtml.stdout + officialHtml.stderr);
    assert.deepEqual(officialHtml.requests, [officialUrl, officialFallback]);
    assert.deepEqual(readFileSync(official), small);

    rmSync(normal);
    const primaryHtml = run([], 'primary-html');
    assert.equal(primaryHtml.status, 0, primaryHtml.stdout + primaryHtml.stderr);
    assert.deepEqual(primaryHtml.requests, [s2Url, wwwUrl]);
    assert.deepEqual(readFileSync(normal), small);

    const bookmarks = join(root, 'bookmarks.json');
    const draft = JSON.parse(readFileSync(bookmarks, 'utf8'));
    draft.bookmarks[0].icon = './icons/old-example.png';
    draft.bookmarks[1].icon = './icons/old-official.png';
    draft.categories = [{ name: 'Test', bookmarks: draft.bookmarks }];
    const raw = JSON.stringify(draft);
    writeFileSync(bookmarks, raw);
    writeFileSync(join(icons, 'old-example.png'), png);
    rmSync(normal);
    rmSync(official);
    const allFailed = run([], 'image');
    assert.equal(allFailed.status, 1, allFailed.stdout + allFailed.stderr);
    assert.equal(readFileSync(bookmarks, 'utf8'), raw);

    const partial = run([], 'example-html');
    assert.equal(partial.status, 1, partial.stdout + partial.stderr);
    assert.equal(existsSync(normal), false);
    assert.equal(existsSync(official), true);
    const saved = JSON.parse(readFileSync(bookmarks, 'utf8'));
    for (const list of [saved.bookmarks, saved.categories[0].bookmarks]) {
      assert.deepEqual(list.map(bookmark => bookmark.icon), ['./icons/old-example.png', './icons/' + officialHost + '.png']);
    }
    assert.deepEqual(readFileSync(join(icons, 'old-example.png')), png);
    assert.equal(readdirSync(icons).some(name => name.startsWith('.icon-sync-')), false);
    assert.equal(readdirSync(root).some(name => name.startsWith('.icon-sync-')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
