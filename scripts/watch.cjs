const fs = require('node:fs');
const { dirname, basename, join } = require('node:path');
const { createHash } = require('node:crypto');
const { c } = require('./terminal.cjs');

const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

function shouldIgnore(filename) {
    if (!filename) return false;
    const base = filename.split(/[/\\]/).pop();
    if (!base) return true;
    if (IGNORED_NAMES.has(base)) return true;
    // 忽略 macOS 伴生资源分支、编辑器临时文件与备份文件
    if (base.startsWith('._') || base.endsWith('~') || base.endsWith('.tmp') || base.startsWith('.#')) return true;
    return false;
}

function readSignature(path) {
    const stats = fs.lstatSync(path, { throwIfNoEntry: false });
    if (!stats) return undefined;
    if (stats.isDirectory()) return 'directory';
    if (stats.isSymbolicLink()) return `link:${fs.readlinkSync(path)}`;
    if (!stats.isFile()) return `mode:${stats.mode}`;
    return createHash('sha256').update(fs.readFileSync(path)).digest('hex');
}

function snapshotDirectory(path) {
    /** @type {Map<string, string>} */
    const snapshot = new Map();
    for (const entry of fs.readdirSync(path, { recursive: true, withFileTypes: true })) {
        if (shouldIgnore(entry.name)) continue;
        const file = join(entry.parentPath, entry.name);
        const signature = readSignature(file);
        if (signature !== undefined) snapshot.set(file, signature);
    }
    return snapshot;
}

// 监听入口共用防抖与关闭流程；重建期间的新变化合并到下一轮。
function watchFiles(files, { rebuild, label = 'Watch', delay = 80 }) {
    let timer = null, pending = null, rebuilding = false, closed = false;
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
            console.error(`  ${c.yellow}❌ [${label}] 重新构建失败:${c.reset}`, err.message || err);
        } finally {
            rebuilding = false;
            if (!closed && pending !== null) timer = setTimeout(run, delay);
        }
    };
    const trigger = name => {
        if (closed) return;
        pending = name;
        clearTimeout(timer);
        if (!rebuilding) timer = setTimeout(run, delay);
    };
    const watchers = [];
    const filesByDirectory = new Map();
    const watch = (path, name, recursive, onChange) => {
        try {
            watchers.push(fs.watch(path, { recursive }, onChange));
        } catch (err) {
            console.warn(`  ${c.yellow}⚠ 无法监听 ${name}: ${err.message}${c.reset}`);
        }
    };
    for (const { path, name } of files) {
        try {
            if (fs.statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
                let previous = snapshotDirectory(path);
                watch(path, name, true, (_, filename) => {
                    if (shouldIgnore(filename)) return;
                    const label = filename ? `${name}${filename}` : name;
                    try {
                        const file = filename ? join(path, filename) : null;
                        const signature = file ? readSignature(file) : undefined;
                        if (!file || signature === 'directory' || previous.get(file) === 'directory') {
                            // 目录迁移和缺少文件名的事件可能涉及多个子项。
                            const current = snapshotDirectory(path);
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
                });
            } else {
                const directory = dirname(path);
                if (!filesByDirectory.has(directory)) filesByDirectory.set(directory, new Map());
                filesByDirectory.get(directory).set(basename(path), { path, name, previous: readSignature(path) });
            }
        } catch (err) {
            console.warn(`  ${c.yellow}⚠ 无法监听 ${name}: ${err.message}${c.reset}`);
        }
    }
    // 通过父目录追踪路径名，编辑器原子替换后仍可收到新文件的变化。
    for (const [directory, entries] of filesByDirectory) {
        watch(directory, directory, false, (_, filename) => {
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
        clearTimeout(timer);
        for (const watcher of watchers) {
            try { watcher.close(); } catch {}
        }
    };
}

module.exports = { watchFiles };
