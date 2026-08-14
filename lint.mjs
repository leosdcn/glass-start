/**
 * 根目录零依赖静态语法与格式检查 (lint.mjs)
 * 1. 提取 index.html 内所有内联 <script> 做语法校验
 * 2. 对根目录 JavaScript 核心脚本 (build.js, sw.js, server.js) 用 node --check 校验语法
 * 3. 对根目录 JSON 配置文件 (bookmarks.json, manifest.json, package.json) 做合法性校验
 */
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)));

const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
    reset: isTTY ? '\x1b[0m' : '',
    bold: isTTY ? '\x1b[1m' : '',
    dim: isTTY ? '\x1b[2m' : '',
    cyan: isTTY ? '\x1b[36m' : '',
    green: isTTY ? '\x1b[32m' : '',
    yellow: isTTY ? '\x1b[33m' : '',
    red: isTTY ? '\x1b[31m' : '',
    gray: isTTY ? '\x1b[90m' : '',
};

const LINE_WIDTH = 72;
const HR_DOUBLE = '═'.repeat(LINE_WIDTH);
const HR_SINGLE = '─'.repeat(LINE_WIDTH);

function getVisualWidth(str) {
    const clean = str.replace(/\x1b\[[0-9;]*m/g, '');
    let width = 0;
    for (const ch of clean) {
        const code = ch.codePointAt(0);
        if (code >= 0xFE00 && code <= 0xFE0F) continue;
        if (code === 0x200D) continue;
        if (code > 0x7f) width += 2;
        else width += 1;
    }
    return width;
}

function logSection(step, title) {
    const prefix = `─── [${step}] ${title} `;
    const visualLen = getVisualWidth(prefix);
    const fillLen = Math.max(4, LINE_WIDTH - visualLen);
    const trailingLine = '─'.repeat(fillLen);
    console.log(`\n${c.cyan}─── [${step}] ${title} ${c.gray}${trailingLine}${c.reset}`);
}

function logItem(msg, status = 'ok') {
    const icon = status === 'ok' ? `${c.green}✔${c.reset}`
               : status === 'warn' ? `${c.yellow}⚠${c.reset}`
               : `${c.red}❌${c.reset}`;
    console.log(`  ${icon} ${msg}`);
}

function formatSize(bytes) {
    if (bytes >= 1024) {
        return (bytes / 1024).toFixed(2) + ' KB';
    }
    return bytes + ' chars';
}

const startTime = Date.now();
let passCount = 0;
let failCount = 0;

console.log(`\n${c.cyan}${HR_DOUBLE}${c.reset}`);
console.log(`${c.bold}${c.cyan}🔍 Glass Start — 零依赖静态语法与格式检查 (Static Lint)${c.reset}`);
console.log(`${c.cyan}${HR_DOUBLE}${c.reset}`);

// ---- 1. index.html 内联 <script> 语法校验 ----
logSection('1/3', '📄 校验 index.html 内联脚本语法');
const htmlPath = join(root, 'index.html');
if (statSync(htmlPath).isFile()) {
    const html = readFileSync(htmlPath, 'utf-8');
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    scripts.forEach((m, i) => {
        const fullTag = m[0];
        const code = m[1];
        let tagDesc = '';
        if (fullTag.includes('id="main-script"')) {
            tagDesc = ' (主应用逻辑)';
        } else if (fullTag.includes('application/ld+json')) {
            tagDesc = ' (结构化数据 JSON-LD)';
        }
        const label = `内联 script #${i}${tagDesc} [${formatSize(code.length)}]`;
        try {
            if (fullTag.includes('application/ld+json')) {
                JSON.parse(code);
            } else {
                new vm.Script(code, { filename: `inline-${i}.js` });
            }
            passCount++;
            logItem(`${label} 语法通过`);
        } catch (e) {
            failCount++;
            logItem(`${label} 语法错误: ${e.message}`, 'error');
        }
    });
}

// ---- 2. 根目录 JS 脚本 (build.js, sw.js, server.js) 用 node --check 校验 ----
logSection('2/3', '⚙️  校验核心 JavaScript 语法 (node --check)');
const jsFiles = [
    { name: 'build.js', desc: '打包构建脚本' },
    { name: 'sw.js', desc: 'Service Worker 底座' },
    { name: 'server.js', desc: '本地开发/预览服务' }
].filter(f => {
    try { return statSync(join(root, f.name)).isFile(); } catch { return false; }
});

for (const item of jsFiles) {
    const r = spawnSync(process.execPath, ['--check', item.name], { encoding: 'utf-8' });
    const label = `${item.name.padEnd(10, ' ')} (${item.desc})`;
    if (r.status === 0) {
        passCount++;
        logItem(`${label} 语法通过`);
    } else {
        failCount++;
        logItem(`${label} 语法错误:\n${r.stderr}`, 'error');
    }
}

// ---- 3. 根目录 JSON 配置文件合法性校验 ----
logSection('3/3', '📦 校验 JSON 配置文件格式');
const jsonFiles = [
    { name: 'bookmarks.json', desc: '书签与分类数据源' },
    { name: 'manifest.json', desc: 'PWA Web 应用程序清单' },
    { name: 'package.json', desc: 'NPM 依赖与指令配置' }
].filter(f => {
    try { return statSync(join(root, f.name)).isFile(); } catch { return false; }
});

for (const item of jsonFiles) {
    const label = `${item.name.padEnd(15, ' ')} (${item.desc})`;
    try {
        const content = readFileSync(join(root, item.name), 'utf-8');
        JSON.parse(content);
        passCount++;
        logItem(`${label} 格式合法`);
    } catch (e) {
        failCount++;
        logItem(`${label} 解析错误: ${e.message}`, 'error');
    }
}

const elapsed = Date.now() - startTime;
console.log(`\n${c.gray}${HR_DOUBLE}${c.reset}`);
if (failCount === 0) {
    console.log(`${c.green}${c.bold}✨ 全部 ${passCount} 项静态语法与配置文件检查通过！${c.reset}${c.dim} (耗时: ${elapsed}ms)${c.reset}`);
} else {
    console.log(`${c.red}${c.bold}❌ 检测到 ${failCount} 项检查失败 (共 ${passCount + failCount} 项)！${c.reset}${c.dim} (耗时: ${elapsed}ms)${c.reset}`);
}
console.log(`${c.gray}${HR_DOUBLE}${c.reset}\n`);

process.exit(failCount ? 1 : 0);
