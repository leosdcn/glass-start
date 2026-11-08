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

module.exports = { publishBuild };
