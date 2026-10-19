import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

let hasSips = false;
try {
  const check = spawnSync('sips', ['--version'], { stdio: 'ignore' });
  hasSips = check.status === 0;
} catch {
  hasSips = false;
}

if (!hasSips) {
  console.log('⚠️ 当前环境未检测到 sips（通常仅 macOS 支持），跳过图标正方形规范化测试');
  process.exit(0);
}

const source = readFileSync(new URL('../scripts/sync-icons.mjs', import.meta.url), 'utf8');
const implementation = source.slice(source.indexOf('function saveAsPng('), source.indexOf('\nasync function runConcurrent'));
const context = { Buffer, mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync, join, dirname, execFileSync };
const normalize = vm.runInNewContext(`(${implementation})`, context);
const workDir = mkdtempSync(join(tmpdir(), 'glass-icon-regression-'));
try {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
  const input = join(workDir, 'rectangle.png'), output = join(workDir, 'icon.png');
  writeFileSync(input, png);
  execFileSync('sips', ['-z', '19', '16', input], { stdio: 'ignore' });
  assert.equal(normalize(readFileSync(input), output), true);
  const square = readFileSync(output);
  assert.equal(square.readUInt32BE(16), 19);
  assert.equal(square.readUInt32BE(20), 19);
  console.log('✅ 非正方形图标等比例填充为 1:1 PNG');

  execFileSync('sips', ['-z', '256', '128', input], { stdio: 'ignore' });
  assert.equal(normalize(readFileSync(input), output), true);
  const capped = readFileSync(output);
  assert.equal(capped.readUInt32BE(16), 128);
  assert.equal(capped.readUInt32BE(20), 128);
  console.log('✅ 超限图标先等比缩放再正方形填充，上限为 128px');

  assert.equal(normalize(Buffer.from('not an image'), output), false);
  assert.deepEqual(readFileSync(output), capped);
  const unavailable = vm.runInNewContext(`(${implementation})`, { ...context, execFileSync: () => { throw new Error('sips unavailable'); } });
  assert.equal(unavailable(png, output), false);
  assert.deepEqual(readFileSync(output), capped);
  assert.equal(readdirSync(workDir).some(name => name.startsWith('.icon-sync-')), false);
  console.log('✅ 坏输入与转换失败保留原图标，返回失败并清理本次临时文件');
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
