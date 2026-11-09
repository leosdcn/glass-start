const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function acquirePublishLock(lockDir) {
    const deadline = performance.now() + 5000;
    const delay = new Int32Array(new SharedArrayBuffer(4));
    for (;;) {
        try {
            fs.mkdirSync(lockDir);
            return;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            if (performance.now() >= deadline) {
                throw new Error(`等待构建发布超时，请检查是否仍有构建进程占用 ${lockDir}`, { cause: error });
            }
            Atomics.wait(delay, 0, 0, 25);
        }
    }
}

function publishBuild(output, populate) {
    const prefix = path.join(path.dirname(output), `.${path.basename(output)}`);
    const staging = fs.mkdtempSync(prefix + '-build-');
    const lockDir = prefix + '-publish';
    const previous = path.join(lockDir, 'previous');
    try {
        const result = populate(staging);
        // mkdtemp 创建的目录只允许当前用户访问。发布产物沿用普通目录的权限。
        fs.chmodSync(staging, 0o777 & ~process.umask());
        acquirePublishLock(lockDir);
        let restoreFailed = false;
        try {
            if (fs.existsSync(output)) fs.renameSync(output, previous);
            try {
                fs.renameSync(staging, output);
            } catch (error) {
                if (fs.existsSync(previous)) {
                    try {
                        fs.renameSync(previous, output);
                    } catch (restoreError) {
                        restoreFailed = true;
                        throw new Error(`恢复上一版产物失败，备份保留在 ${previous}`, {
                            cause: new AggregateError([error, restoreError])
                        });
                    }
                }
                throw error;
            }
            return result;
        } finally {
            // 恢复失败时，留住备份和发布锁，避免下一次构建覆盖现场。
            if (!restoreFailed) {
                fs.rmSync(lockDir, { recursive: true, force: true });
            }
        }
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
}

// 非空目录通过 rename 竞争发布权。回收者只删除失效进程的唯一标记，
// 即使有多个构建同时发现它，也不能删除后来取得锁的进程的标记。
function removeWebPublishLock(lock, owner) {
    try {
        if (owner) fs.unlinkSync(path.join(lock, owner));
        fs.rmdirSync(lock);
    } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    }
}

function acquireWebPublishLock(lock, candidate) {
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
                throw new Error(`等待网页发布超时，请检查 ${lock}`, { cause: error });
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
                if (error.code === 'ESRCH') removeWebPublishLock(lock, ownerFile);
            }
        } else if (!ownerFile) removeWebPublishLock(lock);
        Atomics.wait(delay, 0, 0, 25);
    }
}

/** 并行准备各自的目录，在同一发布锁内读取前版、切换入口并回收。 */
function publishWebBuild(output, populate, prepare = () => {}) {
    const parent = path.dirname(output);
    const prefix = path.join(parent, `.${path.basename(output)}-build-`);
    const release = fs.mkdtempSync(prefix);
    const link = release + '-link';
    const candidate = release + '-lock';
    const lock = path.join(parent, `.${path.basename(output)}-publish`);
    const migration = output + '.migration';
    const backup = path.join(migration, 'previous');
    let published = false;
    try {
        const result = populate(release);
        fs.chmodSync(release, 0o777 & ~process.umask());
        fs.symlinkSync(release, link, process.platform === 'win32' ? 'junction' : 'dir');
        const owner = acquireWebPublishLock(lock, candidate);
        try {
            if (fs.existsSync(backup) && !fs.lstatSync(output, { throwIfNoEntry: false })) {
                fs.renameSync(backup, output);
            }
            const entry = fs.lstatSync(output, { throwIfNoEntry: false });
            const previous = entry?.isSymbolicLink() ? path.resolve(parent, fs.readlinkSync(output)) : null;
            prepare(release, entry ? output : null);
            if (entry?.isDirectory()) {
                fs.mkdirSync(migration, { recursive: true });
                fs.renameSync(output, backup);
            }
            try {
                fs.renameSync(link, output);
                published = true;
            } catch (error) {
                if (entry?.isDirectory()) fs.renameSync(backup, output);
                throw error;
            }
            fs.rmSync(migration, { recursive: true, force: true });
            if (previous?.startsWith(prefix) && path.dirname(previous) === parent && previous !== release) {
                fs.rmSync(previous, { recursive: true, force: true });
            }
            return result;
        } finally {
            removeWebPublishLock(lock, owner);
        }
    } finally {
        fs.rmSync(candidate, { recursive: true, force: true });
        if (!published) {
            fs.rmSync(link, { force: true });
            fs.rmSync(release, { recursive: true, force: true });
        }
    }
}

module.exports = { publishBuild, publishWebBuild };
