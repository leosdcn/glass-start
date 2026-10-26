import { spawn } from 'node:child_process';
import { readdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { requiresBuild } from './test-selection.mjs';

const testDir = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(testDir, '..');
const pattern = process.argv.slice(2).find(arg => !arg.startsWith('-'));
const files = readdirSync(testDir).filter(name => name.endsWith('.test.mjs') &&
  (!pattern || name.toLowerCase().includes(pattern.toLowerCase()))).sort();
if (!files.length) {
  console.error(`未找到匹配的测试文件: ${pattern || '*'}`);
  process.exit(1);
}

// 仅明确列出的纯单元测试可跳过构建；未知测试默认验证新产物。
const needsBuild = requiresBuild(files);

const runProcess = (cmd, args) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { cwd: rootDir, stdio: 'inherit' });
  p.on('close', code => resolve(code ?? 0));
  p.on('error', reject);
});

const tasks = [
  runProcess(process.execPath, [join(rootDir, 'node_modules/typescript/bin/tsc'), '--project', join(rootDir, 'tsconfig.json')])
];
if (needsBuild) {
  tasks.push(runProcess(process.execPath, [join(rootDir, 'scripts/build.js')]));
}

const [typeCode, buildCode = 0] = await Promise.all(tasks);
if (typeCode !== 0) process.exit(typeCode);
if (buildCode !== 0) process.exit(buildCode);

const runTempDir = mkdtempSync(join(tmpdir(), 'glass-start-run-'));

// 为测试会话预先编译共享测试脚本，消除各测试服务器重复 AST 编译开销。
if (needsBuild) {
  try {
    const appJs = readFileSync(join(rootDir, 'dist/app.js'), 'utf-8');
    const versionMatch = appJs.match(/window\.__GLASS_BUILD_APP__="([^"]+)";/);
    if (versionMatch) {
      const { buildAppJavaScript } = createRequire(import.meta.url)('../scripts/build.js');
      buildAppJavaScript({
        testMode: true,
        version: versionMatch[1],
        outfile: join(runTempDir, 'app.test.js')
      });
    }
  } catch {}
}
const grouped = process.platform !== 'win32';
const concurrency = process.env.GLASS_TEST_CONCURRENCY || (process.env.CI ? '1' : '6');
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
