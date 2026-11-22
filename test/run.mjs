import { spawn } from 'node:child_process';
import { readdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants, tmpdir, availableParallelism } from 'node:os';
import { cleanupChromeProcesses } from './support/chrome-processes.mjs';
import { requiresBuild, standaloneTests } from './support/test-selection.mjs';

process.env.AUTO_OPEN = '0';

const testDir = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(testDir, '..');
const patterns = process.argv.slice(2).filter(arg => !arg.startsWith('-')).map(pattern => pattern.toLowerCase());
const unitOnly = process.argv.includes('--unit');
const available = readdirSync(testDir).filter(name => name.endsWith('.test.mjs') &&
  (!unitOnly || standaloneTests.has(name)));
const unmatched = patterns.filter(pattern => !available.some(name => name.toLowerCase().includes(pattern)));
const files = available.filter(name => !patterns.length || patterns.some(pattern => name.toLowerCase().includes(pattern))).sort();
if (unmatched.length || !files.length) {
  console.error(`未找到匹配的测试文件: ${unmatched.join(', ') || '*'}`);
  process.exit(1);
}

// 只回收本项目中能确认所有者已退出的测试沙箱。
const project = realpathSync(rootDir);
for (const entry of readdirSync(tmpdir(), { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^glass-start-run-[a-zA-Z0-9]{6}$/.test(entry.name)) continue;
  const candidate = join(tmpdir(), entry.name);
  try {
    const { pid, root } = JSON.parse(readFileSync(join(candidate, 'runner.pid'), 'utf8'));
    if (root !== project || !Number.isSafeInteger(pid) || pid <= 0) continue;
    try { process.kill(pid, 0); }
    catch (error) {
      if (error.code === 'ESRCH') rmSync(candidate, { recursive: true, force: true });
    }
  } catch {}
}

// 仅明确列出的纯单元测试可跳过构建；未知测试默认验证新产物。
const needsBuild = requiresBuild(files);
const runTempDir = mkdtempSync(join(tmpdir(), 'glass-start-run-'));
writeFileSync(join(runTempDir, 'runner.pid'), JSON.stringify({ pid: process.pid, root: project }));
const grouped = process.platform !== 'win32';
const children = new Set();
let interrupted = 0, shutdownTimer;

function killGroup(child, signal = 'SIGKILL') {
  try {
    if (grouped && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {}
}
process.on('exit', () => {
  children.forEach(child => killGroup(child, 'SIGKILL'));
  cleanupChromeProcesses(runTempDir);
  rmSync(runTempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (interrupted) {
      process.exit(128 + (constants.signals[signal] || 1));
    }
    interrupted = 128 + (constants.signals[signal] || 1);
    for (const child of children) killGroup(child, signal);
    // 先让 CDP 的退出钩子清理浏览器，失去响应时才终止本次进程组并硬退出。
    shutdownTimer = setTimeout(() => {
      children.forEach(child => killGroup(child, 'SIGKILL'));
      setTimeout(() => process.exit(interrupted || 1), 500);
    }, 3000);
  });
}

function runProcess(args, env = process.env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: rootDir, stdio: 'inherit', detached: grouped, env });
    children.add(child);
    child.once('error', error => console.error(error.message));
    child.once('close', (code, signal) => {
      killGroup(child);
      children.delete(child);
      if (signal) {
        console.error(`子进程被 ${signal} 终止: ${args.join(' ')}`);
        resolve(constants.signals[signal] ? 128 + constants.signals[signal] : 1);
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

const tsc = join(rootDir, 'node_modules/typescript/bin/tsc');
const tasks = ['tsconfig.json', 'tsconfig.sw.json'].map(config =>
  runProcess([tsc, '--project', join(rootDir, config)]));
if (needsBuild) {
  tasks.push(runProcess([join(rootDir, 'scripts/build.cjs'), `--test-snapshot=${runTempDir}`]));
}
const prerequisiteFailure = (await Promise.all(tasks)).find(code => code !== 0);
if (interrupted || prerequisiteFailure) process.exit(interrupted || prerequisiteFailure);

const defaultConcurrency = process.env.CI ? '1' : String(Math.min(4, Math.max(1, Math.floor((availableParallelism?.() || 4) / 2))));
const concurrency = process.env.GLASS_TEST_CONCURRENCY || defaultConcurrency;
const testTimeout = process.env.GLASS_TEST_TIMEOUT || '60000';
const code = await runProcess(['--test', `--test-timeout=${testTimeout}`, `--test-concurrency=${concurrency}`, ...files.map(name => join(testDir, name))],
  { ...process.env, GLASS_TEST_TMPDIR: runTempDir });
clearTimeout(shutdownTimer);
process.exit(interrupted || code);
