import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const testDir = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(testDir, '..');
const pattern = process.argv.slice(2).find(arg => !arg.startsWith('-'));
const files = readdirSync(testDir).filter(name => name.endsWith('.test.mjs') &&
  (!pattern || name.toLowerCase().includes(pattern.toLowerCase()))).sort();
if (!files.length) {
  console.error(`未找到匹配的测试文件: ${pattern || '*'}`);
  process.exit(1);
}

// 类型契约先行；失败不启动构建或浏览器。
const types = spawnSync(process.execPath, [join(rootDir, 'node_modules/typescript/bin/tsc'), '--project', join(rootDir, 'tsconfig.json')], { cwd: rootDir, stdio: 'inherit' });
if (types.status !== 0) process.exit(types.status || 1);

// 每次验证先构建，测试均实际运行；不再维护通过记录或源码指纹缓存。
const build = spawnSync(process.execPath, [join(rootDir, 'scripts/build.js')], { cwd: rootDir, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);

const runTempDir = mkdtempSync(join(tmpdir(), 'glass-start-run-'));
const grouped = process.platform !== 'win32';
const concurrency = process.env.GLASS_TEST_CONCURRENCY || (process.env.CI ? '2' : '6');
const child = spawn(process.execPath, ['--test', `--test-concurrency=${concurrency}`, ...files.map(name => join(testDir, name))], {
  cwd: rootDir, stdio: 'inherit', detached: grouped,
  env: { ...process.env, GLASS_TEST_TMPDIR: runTempDir }
});
let interrupted = 0, shutdownTimer;
function killGroup() {
  try { if (grouped) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {}
}
process.on('exit', () => {
  killGroup();
  rmSync(runTempDir, { recursive: true, force: true });
});
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(signal, () => {
    if (interrupted) return;
    interrupted = code;
    child.kill(signal);
    // 先让 CDP 的退出钩子清理浏览器，失去响应时才终止本次进程组。
    shutdownTimer = setTimeout(killGroup, 3000);
  });
}
child.on('error', error => { console.error(error.message); process.exit(1); });
child.on('close', code => {
  clearTimeout(shutdownTimer);
  process.exit(interrupted || (code ?? 1));
});
