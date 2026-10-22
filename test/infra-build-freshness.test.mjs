import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, cpSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requiresBuild } from './test-selection.mjs';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const { injectHeadConfig } = createRequire(import.meta.url)('../scripts/build.js');
const { watchFiles } = createRequire(import.meta.url)('../scripts/watch.cjs');

test('单文件重复通知不触发重建，真实修改及删除恢复仍触发', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'glass-watch-content-'));
  const file = join(dir, 'sw.js');
  const originalWatch = fs.watch;
  let notify;
  let builds = 0;
  let close;
  try {
    writeFileSync(file, 'before');
    fs.watch = (_path, _options, callback) => {
      notify = () => callback('change', 'sw.js');
      return { close() {} };
    };
    close = watchFiles([{ path: file, name: 'sw.js' }], {
      delay: 1,
      rebuild() {
        builds++;
        // 构建期间再次收到同内容通知，不应排入下一轮。
        notify();
      }
    });
    fs.watch = originalWatch;
    notify();
    writeFileSync(file, 'before');
    notify();
    await delay(30);
    assert.equal(builds, 0);
    writeFileSync(file, 'after');
    notify();
    await delay(30);
    assert.equal(builds, 1);
    rmSync(file);
    notify();
    await delay(30);
    assert.equal(builds, 2);
    writeFileSync(file, 'restored');
    notify();
    await delay(30);
    assert.equal(builds, 3);
  } finally {
    fs.watch = originalWatch;
    close?.();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('浏览器、未知及混合测试均要求构建，明确的纯单元测试可以跳过', () => {
  assert.equal(requiresBuild(['ui-rendering-performance.test.mjs']), true);
  assert.equal(requiresBuild(['new-browser-test.test.mjs']), true);
  assert.equal(requiresBuild(['data-pure-models.test.mjs']), false);
  assert.equal(requiresBuild(['data-pure-models.test.mjs', 'ui-rendering-performance.test.mjs']), true);
});

test('同一进程中首屏注入跟随间接依赖更新，删除依赖必须报错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glass-head-dependencies-'));
  try {
    const entryPath = join(dir, 'entry.js');
    const dependency = join(dir, 'dependency.js');
    writeFileSync(entryPath, "export { value } from './dependency.js';");
    writeFileSync(dependency, "export const value = 'before';");
    const render = () => injectHeadConfig('/* SLOT */', {
      marker: '/* SLOT */', entryPath, globalName: 'fixture', binding: ''
    });
    assert.match(render(), /before/);
    writeFileSync(dependency, "export const value = 'after';");
    const updated = render();
    assert.match(updated, /after/);
    assert.doesNotMatch(updated, /before/);
    rmSync(dependency);
    assert.throws(render, /Could not resolve/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Watch 合并事件后仍编译 JS 模板新增的 Tailwind 类', () => {
  const dir = mkdtempSync(join(tmpdir(), 'glass-css-freshness-'));
  const root = fileURLToPath(new URL('..', import.meta.url));
  try {
    for (const name of ['scripts', 'src', 'public', 'bookmarks.json', 'package.json', 'sw.js']) {
      cpSync(join(root, name), join(dir, name), { recursive: true });
    }
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    execFileSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const build = require('./scripts/build.js');
      build.main();
      fs.writeFileSync('src/js/watch-css-fixture.js', 'export const markup = "h-[137px]";');
      // 模拟同批 JS 和 public 变化，防抖只保留最后一个 public 路径。
      build.rebuild('public/robots.txt');
      const html = fs.readFileSync('dist/index.html', 'utf8');
      assert.match(html, /height:137px/);
    `], { cwd: dir, stdio: 'pipe', timeout: 60000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
