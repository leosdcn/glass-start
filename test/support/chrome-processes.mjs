import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';

export function trackChromeProcess(pid, profile) {
  const sandbox = process.env.GLASS_TEST_TMPDIR;
  if (!sandbox || !pid) return;
  const record = join(sandbox, `chrome-process-${pid}.json`);
  writeFileSync(record, JSON.stringify(profile), { flag: 'wx' });
  return record;
}

export function killChromeProcess(pid, signal = 'SIGKILL') {
  if (!pid) return;
  try { process.kill(process.platform === 'win32' ? pid : -pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

// Called by the runner after its test process group has been stopped.
export function cleanupChromeProcesses(sandbox) {
  for (const name of readdirSync(sandbox)) {
    const match = /^chrome-process-([1-9]\d*)\.json$/.exec(name);
    if (!match) continue;
    const pid = Number(match[1]);
    try {
      const profile = JSON.parse(readFileSync(join(sandbox, name), 'utf8'));
      if (!Number.isSafeInteger(pid) || typeof profile !== 'string' ||
          !isAbsolute(profile) || !basename(profile).startsWith('glass-start-test-')) continue;
      killChromeProcess(pid);
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    } catch (error) {
      console.error(`无法回收 Chrome 测试进程 ${pid}：${error.message}`);
    }
  }
}
