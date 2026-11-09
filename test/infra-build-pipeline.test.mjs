import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { launchChrome } from './support/cdp.mjs';
import { getFreePort, sleep, waitFor } from './support/helpers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const exec = promisify(execFile);
const serverModule = new URL('./support/server.mjs', import.meta.url).href;
const cdpModule = new URL('./support/cdp.mjs', import.meta.url).href;

function temporaryDirectory(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'glass-pipeline-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function node(args, { cwd = root, env = {} } = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  return exec(process.execPath, args, { cwd, env: childEnv, timeout: 30000 });
}

test('页面、Worker 类型检查或构建被信号终止时不启动测试', { skip: process.platform === 'win32' }, async t => {
  const cwd = temporaryDirectory(t);
  for (const dir of ['test/support', 'scripts', 'node_modules/typescript/bin']) {
    fs.mkdirSync(join(cwd, dir), { recursive: true });
  }
  for (const file of ['test/run.mjs', 'test/support/test-selection.mjs']) {
    fs.copyFileSync(join(root, file), join(cwd, file));
  }
  fs.writeFileSync(join(cwd, 'node_modules/typescript/bin/tsc'),
    "if (process.argv[3].endsWith('/' + process.env.STOP_STEP)) process.kill(process.pid, 'SIGTERM')");
  fs.writeFileSync(join(cwd, 'scripts/build.cjs'),
    "if (process.env.STOP_STEP === 'build') process.kill(process.pid, 'SIGTERM')");
  const executed = join(cwd, 'test-ran');
  fs.writeFileSync(join(cwd, 'test/smoke.test.mjs'),
    "import { writeFileSync } from 'node:fs'; writeFileSync(new URL('../test-ran', import.meta.url), '')");
  for (const step of ['tsconfig.json', 'tsconfig.sw.json', 'build']) {
    await assert.rejects(node(['test/run.mjs'], { cwd, env: { STOP_STEP: step } }),
      { code: 143, stderr: /SIGTERM/ });
    assert.equal(fs.existsSync(executed), false, step);
  }
  await node(['test/run.mjs'], { cwd });
  assert.equal(fs.existsSync(executed), true);
});

test('并发网页构建各自产生一致快照，测试服务不读取随后发布的 dist', async t => {
  const dir = temporaryDirectory(t);
  const cwd = join(dir, 'project');
  fs.mkdirSync(cwd);
  for (const name of ['.gitignore', 'scripts', 'src', 'public', 'package.json', 'bookmarks.json', 'sw.js', 'LICENSE']) {
    fs.cpSync(join(root, name), join(cwd, name), { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
  }
  fs.symlinkSync(join(root, 'node_modules'), join(cwd, 'node_modules'), 'junction');
  const snapshotA = join(dir, 'run-a');
  const snapshotB = join(dir, 'run-b');
  const clock = join(dir, 'build-clock.cjs');
  fs.writeFileSync(clock, 'Date.now = () => Number(process.env.BUILD_TIME)');
  const builds = await Promise.allSettled([snapshotA, snapshotB].map((snapshot, i) =>
    node(['--require', clock, 'scripts/build.cjs', `--test-snapshot=${snapshot}`], {
      cwd, env: { BUILD_TIME: String(1790000000000 + i) }
    })));
  for (const build of builds) if (build.status === 'rejected') throw build.reason;

  const read = (directory, name) => fs.readFileSync(join(directory, name), 'utf8');
  const buildId = directory => read(directory, 'index.html').match(/__GLASS_BUILD_HTML__="([^"]+)"/)?.[1];
  const verify = (directory, version) => {
    assert.match(read(directory, 'index.html'), new RegExp(`__GLASS_BUILD_HTML__="${version}"`));
    assert.match(read(directory, `app-builds/${version}.js`), new RegExp(`__GLASS_BUILD_APP__="${version}"`));
    assert.ok(read(directory, 'sw.js').includes(version));
    assert.ok(fs.existsSync(join(directory, 'wallpapers/bg1.avif')));
  };
  for (const [i, snapshot] of [snapshotA, snapshotB].entries()) {
    const version = buildId(join(snapshot, 'dist'));
    assert.match(version, new RegExp(`^app-core-v${1790000000000 + i}-[0-9a-f]{16}$`));
    verify(join(snapshot, 'dist'), version);
    assert.match(read(snapshot, 'app.test.js'), new RegExp(`__GLASS_BUILD_APP__="${version}"`));
  }
  const dist = join(cwd, 'dist');
  const publishedVersion = buildId(dist);
  assert.ok([snapshotA, snapshotB].some(snapshot => buildId(join(snapshot, 'dist')) === publishedVersion));
  verify(dist, publishedVersion);
  assert.equal(fs.lstatSync(dist).isSymbolicLink(), true);
  assert.match(fs.realpathSync(dist), /[/\\]\.dist-build-[^/\\]+$/);

  const snapshot = publishedVersion === buildId(join(snapshotA, 'dist')) ? snapshotB : snapshotA;
  const script = `app-builds/${buildId(join(snapshot, 'dist'))}.js`;
  await node(['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { startServer } from ${JSON.stringify(serverModule)};
    for (const testMode of [true, false]) {
      const server = await startServer(0, undefined, {}, { testMode });
      try {
        const script = ${JSON.stringify(script)};
        for (const file of ['index.html', script, 'sw.js']) {
          const res = await fetch('http://127.0.0.1:' + server.port + '/' + file);
          assert.ok(res.ok);
          const expected = testMode && file === script ? 'app.test.js' : join('dist', file);
          assert.equal(await res.text(), readFileSync(join(process.env.GLASS_TEST_TMPDIR, expected), 'utf8'));
        }
      } finally { await server.close(); }
    }
  `], { cwd, env: { GLASS_TEST_TMPDIR: snapshot } });
});

test('发布暂存目录失败时恢复上一次完整产物', t => {
  const dir = temporaryDirectory(t);
  const output = join(dir, 'dist');
  const { publishBuild } = require('../scripts/publish-build.cjs');
  publishBuild(output, staging => fs.writeFileSync(join(staging, 'app.js'), 'previous'));
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(output).mode & 0o777, 0o777 & ~process.umask());
  }
  assert.throws(() => publishBuild(output, staging => {
    fs.writeFileSync(join(staging, 'app.js'), 'incomplete');
    throw new Error('injected build failure');
  }), /injected build failure/);
  assert.equal(fs.readFileSync(join(output, 'app.js'), 'utf8'), 'previous');
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (from.startsWith(join(dir, '.dist-build-')) && to === output) throw new Error('injected publish failure');
    rename(from, to);
  });
  assert.throws(() => publishBuild(output, staging => fs.writeFileSync(join(staging, 'app.js'), 'next')),
    /injected publish failure/);
  assert.equal(fs.readFileSync(join(output, 'app.js'), 'utf8'), 'previous');
  assert.deepEqual(fs.readdirSync(dir), ['dist']);
});

test('网页切换前进程被中止时旧入口继续服务，已打开的文件可读完', { skip: process.platform === 'win32' }, async t => {
  const dir = temporaryDirectory(t);
  const output = join(dir, 'dist');
  const modulePath = join(root, 'scripts/publish-build.cjs');
  const { publishWebBuild } = require(modulePath);
  const write = value => staging => fs.writeFileSync(join(staging, 'index.html'), value);
  fs.mkdirSync(output);
  fs.writeFileSync(join(output, 'index.html'), 'legacy');
  publishWebBuild(output, write('previous'));
  assert.equal(fs.lstatSync(output).isSymbolicLink(), true);

  await assert.rejects(node(['-e', `
    const fs = require('node:fs');
    const { join } = require('node:path');
    const output = ${JSON.stringify(output)};
    const rename = fs.renameSync;
    fs.renameSync = (source, target) => {
      if (target === output) process.kill(process.pid, 'SIGKILL');
      rename(source, target);
    };
    require(${JSON.stringify(modulePath)}).publishWebBuild(output, staging =>
      fs.writeFileSync(join(staging, 'index.html'), 'interrupted'));
  `]), { signal: 'SIGKILL' });
  assert.equal(fs.readFileSync(join(output, 'index.html'), 'utf8'), 'previous');

  const file = fs.openSync(join(output, 'index.html'), 'r');
  try {
    publishWebBuild(output, write('next'));
    assert.equal(fs.readFileSync(join(output, 'index.html'), 'utf8'), 'next');
    assert.equal(fs.readFileSync(file, 'utf8'), 'previous');
  } finally {
    fs.closeSync(file);
  }
});

test('Chrome 会话各自清理配置子目录，保留外部父目录和已有文件', async t => {
  const parent = temporaryDirectory(t);
  const oldParent = process.env.CHROME_PROFILE_DIR;
  process.env.CHROME_PROFILE_DIR = parent;
  t.after(() => {
    if (oldParent === undefined) delete process.env.CHROME_PROFILE_DIR;
    else process.env.CHROME_PROFILE_DIR = oldParent;
  });
  fs.writeFileSync(join(parent, 'keep.txt'), 'keep');
  const first = await launchChrome({ port: await getFreePort(), url: 'about:blank', testMode: false });
  try {
    const second = await launchChrome({ port: await getFreePort(), url: 'about:blank', testMode: false });
    try {
      assert.equal(fs.readdirSync(parent).length, 3);
      await first.close();
      assert.equal(fs.readdirSync(parent).length, 2);
    } finally { await second.close(); }
  } finally { await first.close(); }

  await node(['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { launchChrome } from ${JSON.stringify(cdpModule)};
    await assert.rejects(launchChrome({ port: ${await getFreePort()}, url: 'about:blank' }), { code: 'ENOENT' });
  `], { env: { CHROME_PROFILE_DIR: parent, CHROME_PATH: join(parent, 'missing-chrome') } });
  assert.deepEqual(fs.readdirSync(parent), ['keep.txt']);
  assert.equal(fs.readFileSync(join(parent, 'keep.txt'), 'utf8'), 'keep');
});

test('源码文件原子替换后继续监听，并忽略同内容保存和无关文件', async t => {
  const root = temporaryDirectory(t);
  const bookmarks = join(root, 'bookmarks.json');
  const config = join(root, 'package.json');
  const swap = join(root, 'editor-save.tmp');
  fs.writeFileSync(bookmarks, 'initial');
  fs.writeFileSync(config, 'config');
  const { watchFiles } = require('../scripts/watch.cjs');
  const changes = [];
  const stop = watchFiles([
    { path: bookmarks, name: 'bookmarks.json' },
    { path: config, name: 'package.json' }
  ], { delay: 25, label: 'Test', rebuild: () => {
    changes.push(fs.readFileSync(bookmarks, 'utf8'));
    return { version: 'test', duration: 0 };
  } });
  try {
    // macOS 目录事件流异步启动，先用另一个受监听文件确认已开始接收事件。
    await waitFor(() => {
      if (changes.length) return true;
      fs.writeFileSync(config, 'watcher ready probe');
      return false;
    }, 'directory watcher ready', 4000, 60);
    assert.deepEqual(changes.splice(0), ['initial']);

    fs.writeFileSync(bookmarks, 'first edit');
    await waitFor(() => changes.length >= 1, 'in-place write', 4000);
    fs.writeFileSync(swap, 'atomic replacement');
    fs.renameSync(swap, bookmarks);
    await waitFor(() => changes.length >= 2, 'replacement', 4000);
    fs.writeFileSync(bookmarks, 'edit replacement');
    await waitFor(() => changes.length >= 3, 'edit of replacement', 4000);
    fs.writeFileSync(bookmarks, 'edit replacement');
    fs.writeFileSync(swap, 'ignored');
    await sleep(150);
    assert.deepEqual(changes, ['first edit', 'atomic replacement', 'edit replacement']);
    fs.writeFileSync(config, 'config changed');
    await waitFor(() => changes.length === 4, 'second watched file', 4000);
  } finally {
    stop();
  }
});
