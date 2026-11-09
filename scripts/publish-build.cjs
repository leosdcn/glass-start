const fs = require('node:fs');
const path = require('node:path');

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

/** 网页预览通过一次重命名切换发布入口。每次构建独占目标目录。 */
function publishWebBuild(output, populate) {
    const parent = path.dirname(output);
    const prefix = path.join(parent, `.${path.basename(output)}-build-`);
    const release = fs.mkdtempSync(prefix);
    const link = release + '-link';
    let published = false;
    try {
        const result = populate(release);
        fs.chmodSync(release, 0o777 & ~process.umask());
        fs.symlinkSync(release, link, process.platform === 'win32' ? 'junction' : 'dir');
        const entry = fs.lstatSync(output, { throwIfNoEntry: false });
        if (entry?.isDirectory()) {
            // 只在迁移旧构建的实体目录时保留备份。之后的发布直接替换链接。
            const lock = output + '.migration';
            acquirePublishLock(lock);
            try {
                const backup = path.join(lock, 'previous');
                if (fs.lstatSync(output, { throwIfNoEntry: false })?.isDirectory()) fs.renameSync(output, backup);
                try {
                    fs.renameSync(link, output);
                    published = true;
                } catch (error) {
                    if (fs.existsSync(backup) && !fs.existsSync(output)) fs.renameSync(backup, output);
                    throw error;
                }
            } finally {
                if (fs.existsSync(output)) fs.rmSync(lock, { recursive: true, force: true });
            }
            return result;
        }

        const previous = entry?.isSymbolicLink() ? path.resolve(parent, fs.readlinkSync(output)) : null;
        fs.renameSync(link, output);
        published = true;
        if (previous?.startsWith(prefix) && path.dirname(previous) === parent && previous !== release) {
            fs.rmSync(previous, { recursive: true, force: true });
        }
        return result;
    } finally {
        if (!published) {
            fs.rmSync(link, { force: true });
            fs.rmSync(release, { recursive: true, force: true });
        }
    }
}

module.exports = { publishBuild, publishWebBuild };
