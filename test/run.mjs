import { spawn } from 'node:child_process';
import { readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants, tmpdir } from 'node:os';
import { requiresBuild, standaloneTests } from './support/test-selection.mjs';

const testDir = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(testDir, '..');
const pattern = process.argv.slice(2).find(arg => !arg.startsWith('-'));
const unitOnly = process.argv.includes('--unit');
const files = readdirSync(testDir).filter(name => name.endsWith('.test.mjs') &&
  (!unitOnly || standaloneTests.has(name)) &&
  (!pattern || name.toLowerCase().includes(pattern.toLowerCase()))).sort();
if (!files.length) {
  console.error(`未找到匹配的测试文件: ${pattern || '*'}`);
  process.exit(1);
}

// 仅明确列出的纯单元测试可跳过构建；未知测试默认验证新产物。
const needsBuild = requiresBuild(files);
const runTempDir = mkdtempSync(join(tmpdir(), 'glass-start-run-'));
const grouped = process.platform !== 'win32';
const children = new Set();
let interrupted = 0, shutdownTimer;

function killGroup(child) {
  try {
    if (grouped && child.pid) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {}
}
process.on('exit', () => {
  children.forEach(killGroup);
  rmSync(runTempDir, { recursive: true, force: true });
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (interrupted) return;
    interrupted = 128 + constants.signals[signal];
    for (const child of children) child.kill(signal);
    // 先让 CDP 的退出钩子清理浏览器，失去响应时才终止本次进程组。
    shutdownTimer = setTimeout(() => children.forEach(killGroup), 3000);
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

const concurrency = process.env.GLASS_TEST_CONCURRENCY || (process.env.CI ? '1' : '6');
const code = await runProcess(['--test', `--test-concurrency=${concurrency}`, ...files.map(name => join(testDir, name))],
  { ...process.env, GLASS_TEST_TMPDIR: runTempDir });
clearTimeout(shutdownTimer);
process.exit(interrupted || code);
