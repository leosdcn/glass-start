const fs = require('node:fs');
const { dirname, basename, join, relative } = require('node:path');
const { createHash } = require('node:crypto');
const { c } = require('./terminal.cjs');

const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** @param {string | null | undefined} filename */
function shouldIgnore(filename) {
    if (!filename) return false;
    const segments = filename.split(/[/\\]/);
    if (segments.some(segment => segment.startsWith('.icon-sync-'))) return true;
    const base = segments.at(-1);
    if (!base) return true;
    if (IGNORED_NAMES.has(base)) return true;
    // 忽略 macOS 伴生资源分支、编辑器临时文件与备份文件
    if (base.startsWith('._') || base.endsWith('~') || base.endsWith('.tmp') || base.startsWith('.#')) return true;
    return false;
}

/** @param {string} filePath */
function readSignature(filePath) {
    try {
        const stats = fs.lstatSync(filePath, { throwIfNoEntry: false });
        if (!stats) return undefined;
        if (stats.isDirectory()) return `directory:${stats.dev}:${stats.ino}`;
        if (stats.isSymbolicLink()) return `link:${fs.readlinkSync(filePath)}`;
        if (!stats.isFile()) return `mode:${stats.mode}`;
        if (/\.(?:png|jpe?g|webp|avif|ico)$/i.test(filePath)) {
            return `stat:${stats.size}:${stats.mtimeMs}`;
        }
        return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    } catch (error) {
        const code = /** @type {NodeJS.ErrnoException} */ (error)?.code;
        if (code === 'ENOENT' || code === 'EPERM' || code === 'EACCES') return undefined;
        throw error;
    }
}

/** @param {string | undefined} signature */
function isDirectorySignature(signature) {
    return signature?.startsWith('directory:');
}

/** @param {string} path */
function snapshotDirectory(path) {
    /** @type {Map<string, string>} */
    const snapshot = new Map();
    for (const entry of fs.readdirSync(path, { recursive: true, withFileTypes: true })) {
        const file = join(entry.parentPath, entry.name);
        if (shouldIgnore(relative(path, file))) continue;
        const signature = readSignature(file);
        if (signature !== undefined) snapshot.set(file, signature);
    }
    return snapshot;
}

// 监听入口共用防抖与关闭流程；重建期间的新变化合并到下一轮。
/**
 * @param {Array<{ path: string, name: string }>} files
 * @param {{ rebuild: () => Promise<{ version: string, duration: number }>, label?: string, delay?: number }} options
 */
function watchFiles(files, { rebuild, label = 'Watch', delay = 80 }) {
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    /** @type {string | null} */
    let pending = null;
    let rebuilding = false, closed = false;
    const run = async () => {
        timer = null;
        if (closed || rebuilding) return;
        const filename = pending;
        pending = null;
        rebuilding = true;
        console.log(`\n${c.magenta}📝 [${label}] 检测到源码修改: ${filename}，正在重新构建 dist/ ...${c.reset}`);
        try {
            const { version, duration } = await rebuild();
            if (!closed) {
                console.log(`  ${c.green}✔ [${label}] 重新构建完成！版本: ${c.cyan}${version}${c.reset}${c.green} (耗时: ${duration}ms)${c.reset}\n`);
            }
        } catch (err) {
            console.error(`  ${c.yellow}❌ [${label}] 重新构建失败:${c.reset}`, err instanceof Error ? err.message : err);
        } finally {
            rebuilding = false;
            if (!closed && pending !== null) timer = setTimeout(run, delay);
        }
    };
    /** @param {string} name */
    const trigger = name => {
        if (closed) return;
        pending = name;
        if (timer) clearTimeout(timer);
        if (!rebuilding) timer = setTimeout(run, delay);
    };
    /** @type {Set<fs.FSWatcher>} */
    const watchers = new Set();
    /** @type {Map<string, Map<string, { path: string, name: string, previous: string | undefined }>>} */
    const filesByDirectory = new Map();
    /**
     * @param {string} path
     * @param {string} name
     * @param {fs.WatchListener<string>} onChange
     */
    const watch = (path, name, onChange) => {
        try {
            const watcher = fs.watch(path, { recursive: false }, onChange);
            watchers.add(watcher);
            return watcher;
        } catch (err) {
            console.warn(`  ${c.yellow}⚠ 无法监听 ${name}: ${err instanceof Error ? err.message : String(err)}${c.reset}`);
        }
    };
    /** @param {fs.FSWatcher} watcher */
    const closeWatcher = watcher => {
        watchers.delete(watcher);
        try { watcher.close(); } catch {}
    };

    /**
     * @param {string} path
     * @param {string} name
     */
    function watchDirectoryTree(path, name) {
        let previous = snapshotDirectory(path);
        /** @type {Map<string, { watcher: fs.FSWatcher, signature: string | undefined }>} */
        const directories = new Map();
        /**
         * @param {string} directory
         * @param {string | null} filename
         */
        const onChange = (directory, filename) => {
            const file = filename ? join(directory, filename) : null;
            const relativeFile = file && relative(path, file);
            if (shouldIgnore(relativeFile)) return;
            const label = relativeFile ? `${name}${relativeFile}` : name;
            try {
                const signature = file ? readSignature(file) : undefined;
                if (!file || isDirectorySignature(signature) || isDirectorySignature(previous.get(file))) {
                    const current = snapshotDirectory(path);
                    refreshDirectories(current);
                    const changed = current.size !== previous.size ||
                        [...current].some(([key, value]) => previous.get(key) !== value);
                    previous = current;
                    if (changed) trigger(label);
                    return;
                }
                if (signature === previous.get(file)) return;
                if (signature === undefined) previous.delete(file);
                else previous.set(file, signature);
            } catch {
                // 无法比较时仍安排重建，让构建处理读写冲突或无效资源。
            }
            trigger(label);
        };
        // Linux 的递归实现也监听文件 inode，原子替换后可能漏掉后续事件。
        // 直接监听每一级父目录，目录本身被替换时再更新对应的监听器。
        /** @param {Map<string, string>} snapshot */
        function refreshDirectories(snapshot) {
            const current = new Map([[path, readSignature(path)]]);
            for (const [file, signature] of snapshot) {
                if (isDirectorySignature(signature)) current.set(file, signature);
            }
            for (const [directory, { watcher, signature }] of directories) {
                if (current.get(directory) === signature) continue;
                closeWatcher(watcher);
                directories.delete(directory);
            }
            for (const [directory, signature] of current) {
                if (!isDirectorySignature(signature) || directories.has(directory)) continue;
                const watcher = watch(directory, directory, (_, filename) => onChange(directory, filename));
                if (watcher) directories.set(directory, { watcher, signature });
            }
        }
        refreshDirectories(previous);
    }

    for (const { path, name } of files) {
        try {
            if (fs.statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
                watchDirectoryTree(path, name);
            } else {
                const directory = dirname(path);
                if (!filesByDirectory.has(directory)) filesByDirectory.set(directory, new Map());
                filesByDirectory.get(directory)?.set(basename(path), { path, name, previous: readSignature(path) });
            }
        } catch (err) {
            console.warn(`  ${c.yellow}⚠ 无法监听 ${name}: ${err instanceof Error ? err.message : String(err)}${c.reset}`);
        }
    }
    // 通过父目录追踪路径名，编辑器原子替换后仍可收到新文件的变化。
    for (const [directory, entries] of filesByDirectory) {
        watch(directory, directory, (_, filename) => {
            const changed = filename ? [entries.get(filename)] : entries.values();
            for (const entry of changed) {
                if (!entry) continue;
                try {
                    const signature = readSignature(entry.path);
                    if (signature === entry.previous) continue;
                    entry.previous = signature;
                } catch {}
                trigger(entry.name);
            }
        });
    }
    return () => {
        if (closed) return;
        closed = true;
        pending = null;
        if (timer) clearTimeout(timer);
        for (const watcher of watchers) closeWatcher(watcher);
    };
}

module.exports = { watchFiles };
