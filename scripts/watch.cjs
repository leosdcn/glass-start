const fs = require('node:fs');
const { dirname, basename } = require('node:path');
const { c } = require('./terminal.cjs');

const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

function readContent(file) {
    try { return fs.readFileSync(file); } catch { return null; }
}

function shouldIgnore(filename) {
    if (!filename) return false;
    const base = filename.split(/[/\\]/).pop();
    if (!base) return true;
    if (IGNORED_NAMES.has(base)) return true;
    // 忽略 macOS 伴生资源分支、编辑器临时文件与备份文件
    if (base.startsWith('._') || base.endsWith('~') || base.endsWith('.tmp') || base.startsWith('.#')) return true;
    return false;
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
                watch(path, name, true, (_, filename) => {
                    if (!shouldIgnore(filename)) trigger(filename ? `${name}${filename}` : name);
                });
            } else {
                const directory = dirname(path);
                if (!filesByDirectory.has(directory)) filesByDirectory.set(directory, new Map());
                filesByDirectory.get(directory).set(basename(path), { path, name, previous: readContent(path) });
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
                const content = readContent(entry.path);
                if (content === entry.previous || (content && entry.previous && content.equals(entry.previous))) continue;
                entry.previous = content;
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
