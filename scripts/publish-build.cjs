const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

const activeCleanups = new Set();
function registerCleanup(fn) {
    activeCleanups.add(fn);
    return () => activeCleanups.delete(fn);
}
function executeCleanups() {
    for (const fn of activeCleanups) {
        try { fn(); } catch {}
    }
    activeCleanups.clear();
}
let signalsRegistered = false;
function ensureSignalHandlers() {
    if (signalsRegistered) return;
    signalsRegistered = true;
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.once(sig, () => {
            executeCleanups();
            const sigCode = os.constants?.signals?.[sig] || 1;
            process.exit(128 + sigCode);
        });
    }
    process.on('exit', executeCleanups);
}

function publishBuild(output, populate) {
    ensureSignalHandlers();
    const parent = path.dirname(output);
    const prefix = path.join(parent, `.${path.basename(output)}`);
    const stagingPrefix = prefix + '-build-';
    removeAbandonedBuilds(parent, stagingPrefix, '');
    const staging = fs.mkdtempSync(stagingPrefix + process.pid + '-');
    const candidate = staging + '-lock';
    const lock = prefix + '-publish-lock';
    // 备份沿用原路径，回收失效锁时仍能恢复被中断的发布。
    const backupDir = prefix + '-publish';
    const previous = path.join(backupDir, 'previous');
    const unregister = registerCleanup(() => {
        try { fs.rmSync(candidate, { recursive: true, force: true }); } catch {}
        try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
    });
    try {
        const result = populate(staging);
        // mkdtemp 创建的目录只允许当前用户访问。发布产物沿用普通目录的权限。
        fs.chmodSync(staging, 0o777 & ~process.umask());
        const owner = acquirePublishLock(lock, candidate);
        try {
            if (fs.existsSync(previous) && !fs.existsSync(output)) fs.renameSync(previous, output);
            fs.rmSync(backupDir, { recursive: true, force: true });
            if (fs.existsSync(output)) {
                fs.mkdirSync(backupDir);
                fs.renameSync(output, previous);
            }
            try {
                fs.renameSync(staging, output);
            } catch (error) {
                if (fs.existsSync(previous)) {
                    try {
                        fs.renameSync(previous, output);
                    } catch (restoreError) {
                        throw new Error(`恢复上一版产物失败，备份保留在 ${previous}`, {
                            cause: new AggregateError([error, restoreError])
                        });
                    }
                    fs.rmdirSync(backupDir);
                }
                throw error;
            }
            fs.rmSync(backupDir, { recursive: true, force: true });
            removeAbandonedBuilds(parent, stagingPrefix, staging);
            return result;
        } finally {
            removePublishLock(lock, owner);
        }
    } finally {
        unregister();
        fs.rmSync(candidate, { recursive: true, force: true });
        fs.rmSync(staging, { recursive: true, force: true });
    }
}

// 非空目录通过 rename 竞争发布权。回收者只删除失效进程的唯一标记，
// 即使有多个构建同时发现它，也不能删除后来取得锁的进程的标记。
function removePublishLock(lock, owner) {
    try {
        if (owner) fs.unlinkSync(path.join(lock, owner));
        fs.rmdirSync(lock);
    } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    }
}

function acquirePublishLock(lock, candidate) {
    const owner = `${process.pid}-${randomUUID()}`;
    fs.mkdirSync(candidate);
    fs.writeFileSync(path.join(candidate, owner), '');
    const deadline = performance.now() + 5000;
    const delay = new Int32Array(new SharedArrayBuffer(4));
    for (;;) {
        try {
            fs.renameSync(candidate, lock);
            return owner;
        } catch (error) {
            if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
            if (performance.now() >= deadline) {
                throw new Error(`等待构建发布超时，请检查 ${lock}`, { cause: error });
            }
        }
        let ownerFile;
        try { [ownerFile] = fs.readdirSync(lock); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        const pid = Number(ownerFile?.split('-')[0]);
        if (pid > 0) {
            try {
                process.kill(pid, 0);
            } catch (error) {
                if (error.code === 'ESRCH') removePublishLock(lock, ownerFile);
            }
        } else if (!ownerFile) removePublishLock(lock);
        Atomics.wait(delay, 0, 0, 25);
    }
}

/** 清理可确认归属已退出进程的暂存目录，保留当前版本和并行构建。 */
function removeAbandonedBuilds(parent, prefix, release) {
    const base = path.basename(prefix);
    const resolvedRelease = release ? path.resolve(release) : null;
    for (const name of fs.readdirSync(parent)) {
        if (!name.startsWith(base)) continue;
        const owner = /^([1-9]\d*)-[a-zA-Z0-9]{6}(?:-(?:lock|link))?$/.exec(name.slice(base.length));
        const file = path.join(parent, name);
        const resolvedFile = path.resolve(file);
        if (!owner || resolvedFile === resolvedRelease) continue;
        try {
            process.kill(Number(owner[1]), 0);
        } catch (error) {
            if (error.code === 'ESRCH') fs.rmSync(file, { recursive: true, force: true });
        }
    }
}

/** 并行准备各自的目录，在同一发布锁内读取前版、切换入口并回收。 */
function publishWebBuild(output, populate, prepare = (release, previous) => {}) {
    ensureSignalHandlers();
    const parent = path.dirname(output);
    const prefix = path.join(parent, `.${path.basename(output)}-build-`);
    const release = fs.mkdtempSync(prefix + process.pid + '-');
    const link = release + '-link';
    const candidate = release + '-lock';
    const lock = path.join(parent, `.${path.basename(output)}-publish`);
    const migration = output + '.migration';
    const backup = path.join(migration, 'previous');
    let published = false;
    const unregister = registerCleanup(() => {
        try { fs.rmSync(candidate, { recursive: true, force: true }); } catch {}
        if (!published) {
            try { fs.rmSync(link, { force: true }); } catch {}
            try { fs.rmSync(release, { recursive: true, force: true }); } catch {}
        }
    });
    try {
        const result = populate(release);
        fs.chmodSync(release, 0o777 & ~process.umask());
        const target = process.platform === 'win32' ? release : path.relative(parent, release);
        fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
        const owner = acquirePublishLock(lock, candidate);
        try {
            if (fs.existsSync(backup) && !fs.lstatSync(output, { throwIfNoEntry: false })) {
                fs.renameSync(backup, output);
            }
            const currentEntry = fs.lstatSync(output, { throwIfNoEntry: false });
            const previous = currentEntry?.isSymbolicLink() ? path.resolve(parent, fs.readlinkSync(output)) : null;
            prepare(release, currentEntry ? output : null);
            if (currentEntry?.isDirectory()) {
                fs.mkdirSync(migration, { recursive: true });
                fs.renameSync(output, backup);
            }
            try {
                if (process.platform === 'win32' && fs.existsSync(output)) {
                    fs.rmSync(output, { recursive: true, force: true });
                }
                fs.renameSync(link, output);
                published = true;
            } catch (error) {
                if (currentEntry?.isDirectory()) fs.renameSync(backup, output);
                throw error;
            }
            fs.rmSync(migration, { recursive: true, force: true });
            if (previous?.startsWith(prefix) && path.dirname(previous) === parent && previous !== release) {
                fs.rmSync(previous, { recursive: true, force: true });
            }
            removeAbandonedBuilds(parent, prefix, release);
            return result;
        } finally {
            removePublishLock(lock, owner);
        }
    } finally {
        unregister();
        fs.rmSync(candidate, { recursive: true, force: true });
        if (!published) {
            fs.rmSync(link, { force: true });
            fs.rmSync(release, { recursive: true, force: true });
        }
    }
}

module.exports = { publishBuild, publishWebBuild, ensureSignalHandlers };
