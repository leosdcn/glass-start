import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { fork, spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createConnection, createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { launchChrome } from './support/cdp.mjs';
import { waitFor } from './support/helpers.mjs';
import { startServer } from './support/server.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const serverScript = join(root, 'scripts/server.cjs');
const syncScript = join(root, 'scripts/sync-icons.mjs');
const posixOnly = { skip: process.platform === 'win32' };

function sandbox(t) {
  const dir = mkdtempSync(join(process.env.GLASS_TEST_TMPDIR || tmpdir(), 'glass-cleanup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function keepChild(t, child) {
  const closed = once(child, 'exit', { signal: AbortSignal.timeout(15000) });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  });
  return closed;
}

async function assertPortCanBind(port) {
  const probe = createServer();
  probe.listen(port, '127.0.0.1');
  await once(probe, 'listening');
  await new Promise(resolve => probe.close(resolve));
}

function processTable() {
  return execFileSync('ps', ['-axo', 'pid=,pgid=,stat=,command='], { encoding: 'utf8', timeout: 2000 })
    .trim().split('\n').map(line => {
      const [, pid, group, state, command] = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      return { pid: Number(pid), group: Number(group), state, command };
    });
}

test('预览服务在 IPC 断开时退出，释放端口并回收实际创建的配置目录', posixOnly, async t => {
  const dir = sandbox(t);
  const fakeChrome = join(dir, 'chrome');
  const marker = join(dir, 'profile');
  writeFileSync(fakeChrome, `#!/usr/bin/env node
const profile = process.argv.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
require('node:fs').writeFileSync(${JSON.stringify(marker)}, profile);
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  const child = fork(serverScript, ['--no-watch', '--isolated'], {
    execArgv: [],
    env: { ...process.env, NODE_ENV: 'development', AUTO_OPEN: '1', PORT: '0', CHROME_PATH: fakeChrome,
      GLASS_TEST_TMPDIR: '', TMPDIR: dir },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc']
  });
  const closed = keepChild(t, child);
  const [port] = await once(child, 'message', { signal: AbortSignal.timeout(8000) });
  await waitFor(() => existsSync(marker), 'Chrome profile created');
  const profile = readFileSync(marker, 'utf8');
  assert.equal(dirname(profile), dir);
  assert.equal(existsSync(profile), true);
  child.disconnect();
  assert.deepEqual(await closed, [0, null]);
  assert.equal(existsSync(profile), false);
  await assertPortCanBind(port);
});

test('预览启动异常保留失败退出码和错误输出', () => {
  assert.throws(() => execFileSync(process.execPath, [serverScript, '--no-watch'], {
    env: { ...process.env, AUTO_OPEN: '0', PORT: '65536' },
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 8000, killSignal: 'SIGKILL'
  }), error => error instanceof Error && 'status' in error && error.status === 1 && 'stderr' in error && /ERR_SOCKET_BAD_PORT/.test(String(error.stderr)));
});

test('图标解码和网页编译被信号中断时实际停止子工具并保留已发布内容', posixOnly, async t => {
  const dir = sandbox(t);
  const fixture = join(dir, 'project');
  mkdirSync(fixture);
  for (const name of ['scripts', 'src', 'public', 'package.json', 'bookmarks.json', 'sw.js', 'LICENSE']) {
    cpSync(join(root, name), join(fixture, name), { recursive: true });
  }
  symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'junction');
  const { publishWebBuild } = await import('../scripts/publish-build.cjs');
  const dist = join(fixture, 'dist');
  publishWebBuild(dist, stage => writeFileSync(join(stage, 'index.html'), 'live version'));
  const live = readlinkSync(dist);
  const tools = join(dir, 'bin');
  mkdirSync(tools);
  writeFileSync(join(tools, 'sips'), `#!/usr/bin/env node
if (process.argv.includes('--version')) process.exit(0);
require('node:fs').writeFileSync(process.env.PROBE_MARKER + '.' + process.pid, '');
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  const preload = join(dir, 'tailwind-pause.cjs');
  writeFileSync(preload, `
if (process.argv.includes('-m')) {
  require('node:fs').writeFileSync(process.env.PROBE_MARKER + '.' + process.pid, '');
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
  require('node:module').registerHooks({
    load: (url, context, next) => url.includes('/@tailwindcss/cli/dist/index.mjs')
      ? { format: 'module', source: '', shortCircuit: true } : next(url, context)
  });
}
`);
  /** @type {Array<[string, string[]]>} */
  const scriptArgs = [
    ['icons', ['scripts/sync-icons.mjs', '--check-only']],
    ['build', ['scripts/build.cjs']]
  ];
  for (const signal of /** @type {NodeJS.Signals[]} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])) {
    for (const [kind, args] of scriptArgs) {
      const marker = `${kind}-${signal}`;
      const child = spawn(process.execPath, args, {
        cwd: fixture, stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, GLASS_TEST_TMPDIR: dir, PATH: tools + ':' + process.env.PATH,
          PROBE_MARKER: join(dir, marker), NODE_OPTIONS: `--require=${JSON.stringify(preload)}` }
      });
      const closed = keepChild(t, child);
      const children = () => readdirSync(dir).filter(name => name.startsWith(marker + '.'));
      try {
        await waitFor(() => children().length, `${kind} entered its tool`);
        if (kind === 'icons') assert.ok(readdirSync(dir).some(name => name.startsWith(`glass-icon-check-${child.pid}-`)));
        assert.equal(child.kill(signal), true);
        assert.deepEqual(await closed, [128 + constants.signals[signal], null]);
        await waitFor(() => !processTable().some(({ pid, state }) =>
          children().includes(`${marker}.${pid}`) && !state.startsWith('Z')), 'child tools stopped');
      } finally {
        for (const name of children()) {
          try { process.kill(Number(name.split('.').at(-1)), 'SIGKILL'); } catch {}
        }
      }
      assert.ok(readdirSync(dir).every(name => !name.startsWith('glass-icon-check-')));
      assert.deepEqual(readdirSync(fixture).filter(name => name.startsWith('.dist-build-')), [basename(live)]);
      assert.equal(readlinkSync(dist), live);
      assert.equal(readFileSync(join(dist, 'index.html'), 'utf8'), 'live version');
    }
  }
});

test('Chrome 会话释放进程组和配置目录，Crashpad 不使用宿主目录', async t => {
  const dir = sandbox(t);
  const original = process.env.CHROME_PROFILE_DIR;
  process.env.CHROME_PROFILE_DIR = dir;
  const checkProcesses = process.platform !== 'win32';
  const crashpads = () => processTable().filter(({ command }) => /(?:\/|^)chrome_crashpad_handler(?:\s|$)/.test(command));
  let chrome;
  try {
    const before = checkProcesses ? new Set(crashpads().map(({ pid }) => pid)) : null;
    chrome = await launchChrome({ url: 'about:blank', testMode: true });
    assert.equal(dirname(chrome.profileDir), dir);
    assert.equal(existsSync(chrome.profileDir), true);
    if (checkProcesses) {
      // 同轮的其他 Chrome 测试也可能启动，独立配置目录都使用同一命名前缀。
      const newCrashpads = crashpads().filter(({ pid }) => !before.has(pid));
      for (const { command } of newCrashpads) assert.match(command, /--database=.*[\\/]glass-start-(?:test|preview)-/);
      assert.ok(processTable().some(({ pid, group }) => pid === chrome.pid && group === pid));
    }
    await chrome.close();
    if (checkProcesses) await waitFor(() => !processTable().some(({ group, state, command }) =>
      (group === chrome.pid || command.includes(chrome.profileDir)) && !state.startsWith('Z')), 'Chrome process group and tagged helpers exited');
    assert.equal(existsSync(chrome.profileDir), false);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    if (original === undefined) delete process.env.CHROME_PROFILE_DIR;
    else process.env.CHROME_PROFILE_DIR = original;
    await chrome?.close();
  }
});

test('HTTP 测试服务关闭时主动终止正在传输的响应并释放监听端口', async t => {
  const server = await startServer(0, undefined, {
    '/keepalive': (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('unfinished response');
    }
  });
  const socket = createConnection({ port: server.port, host: '127.0.0.1' });
  t.after(async () => { socket.destroy(); await server.close(); });
  await once(socket, 'connect', { signal: AbortSignal.timeout(2000) });
  socket.write('GET /keepalive HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
  const [data] = await once(socket, 'data', { signal: AbortSignal.timeout(2000) });
  assert.match(String(data), /unfinished response/);
  const closed = once(socket, 'close', { signal: AbortSignal.timeout(2000) });
  await Promise.all([server.close(), closed]);
  await assertPortCanBind(server.port);
});

test('独立系统临时目录在构建发布、图标检查及服务启停后无新增条目', async t => {
  const dir = sandbox(t);
  const systemTemp = join(dir, 'tmp');
  mkdirSync(systemTemp);
  const before = readdirSync(systemTemp);
  const { publishWebBuild } = await import('../scripts/publish-build.cjs');
  const dist = join(dir, 'dist');
  for (const version of ['v1', 'v2']) {
    publishWebBuild(dist, stage => writeFileSync(join(stage, 'index.html'), version));
    assert.equal(readFileSync(join(dist, 'index.html'), 'utf8'), version);
  }
  execFileSync(process.execPath, [syncScript, '--check-only'], {
    env: { ...process.env, GLASS_TEST_TMPDIR: '', TMPDIR: systemTemp, TEMP: systemTemp, NODE_DISABLE_COMPILE_CACHE: '1' },
    stdio: ['ignore', 'pipe', 'inherit'], timeout: 30000, killSignal: 'SIGKILL'
  });
  const server = await startServer();
  await server.close();
  assert.deepEqual(readdirSync(systemTemp), before);
  assert.deepEqual(readdirSync(dir).sort(), [basename(readlinkSync(dist)), 'dist', 'tmp'].sort());
});
