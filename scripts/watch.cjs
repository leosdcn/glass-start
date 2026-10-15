const fs = require('node:fs');
const { c } = require('./terminal.cjs');

// 监听入口共用防抖与关闭流程；重建期间的新变化合并到下一轮。
function watchFiles(files, { rebuild, onSuccess, label = 'Watch', delay = 80 }) {
    let timer = null, pending = null, rebuilding = false, closed = false;
    const run = async () => {
        timer = null;
        if (closed || rebuilding) return;
        const filename = pending;
        pending = null;
        rebuilding = true;
        console.log(`\n${c.magenta}📝 [${label}] 检测到源码修改: ${filename}，正在增量编译 dist/ ...${c.reset}`);
        const startedAt = Date.now();
        try {
            const result = await rebuild(filename);
            if (!closed) {
                console.log(`  ${c.green}✔ [${label}] 增量编译完成！版本: ${c.cyan}${result?.version || ''}${c.reset}${c.green} (耗时: ${result?.duration ?? Date.now() - startedAt}ms)${c.reset}\n`);
                if (typeof onSuccess === 'function') onSuccess(result);
            }
        } catch (err) {
            console.error(`  ${c.yellow}❌ [${label}] 增量编译失败:${c.reset}`, err.message || err);
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
    for (const { path, name } of files) {
        if (!fs.existsSync(path)) continue;
        try {
            const isDir = fs.statSync(path).isDirectory();
            watchers.push(fs.watch(path, { recursive: isDir }, (_, filename) => {
                trigger(isDir && filename ? `${name}${filename}` : name);
            }));
        } catch (err) {
            console.warn(`  ${c.yellow}⚠ 无法监听 ${name}: ${err.message}${c.reset}`);
        }
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
