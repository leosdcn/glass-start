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
logSection('1/4', '📄 校验 index.html 内联脚本语法');
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
logSection('2/4', '⚙️  校验核心 JavaScript 语法 (node --check)');
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
logSection('3/4', '📦 校验 JSON 配置文件格式');
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

// ---- 4. 架构规范守门检查 (版本号全量对齐 & iOS 16px 规范) ----
logSection('4/4', '🛡️  校验版本号全量对齐与移动端输入规范');

// 4.1 版本号一致性检查 (package.json / package-lock.json / index.html / README.md)
try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf-8'));
    const htmlContent = readFileSync(join(root, 'index.html'), 'utf-8');
    const readmeContent = readFileSync(join(root, 'README.md'), 'utf-8');

    const expectedVersion = pkg.version;
    const lockVersion = lock.version;
    const lockPkgVersion = lock.packages?.['']?.version;
    const htmlMatch = htmlContent.match(/<span[^>]*class="[^"]*rounded-full[^"]*"[^>]*>v?([0-9]+\.[0-9]+\.[0-9]+)<\/span>/i);
    const htmlVersion = htmlMatch ? htmlMatch[1] : null;
    const readmeMatch = readmeContent.match(/\|\s*\*\*Glass Start 站点版本\*\*\s*\|\s*项目发布版本\s*\|\s*`v?([0-9]+\.[0-9]+\.[0-9]+)`/i);
    const readmeVersion = readmeMatch ? readmeMatch[1] : null;

    if (expectedVersion && lockVersion === expectedVersion && lockPkgVersion === expectedVersion && htmlVersion === expectedVersion && readmeVersion === expectedVersion) {
        passCount++;
        logItem(`版本号一致性 (v${expectedVersion}) 4 处文件 100% 对齐`);
    } else {
        failCount++;
        logItem(`版本号不一致: pkg=${expectedVersion}, lock=${lockVersion}, html=${htmlVersion}, readme=${readmeVersion}`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`版本号一致性检查异常: ${e.message}`, 'error');
}

// 4.2 移动端 iOS 16px 防放大输入框规范静态扫描
try {
    const htmlContent = readFileSync(join(root, 'index.html'), 'utf-8');
    // 匹配所有单行文本输入框
    const inputMatches = [...htmlContent.matchAll(/<input[^>]*type=["']text["'][^>]*>/gi)];
    let allInputsCompliant = true;
    const nonCompliant = [];

    for (const match of inputMatches) {
        const tag = match[0];
        // 必须含有 text-base 或 text-lg 或 text-xl 或 text-2xl
        const has16pxPlus = /text-(base|lg|xl|2xl|3xl)/.test(tag);
        if (!has16pxPlus) {
            allInputsCompliant = false;
            const idMatch = tag.match(/id=["']([^"']+)["']/);
            nonCompliant.push(idMatch ? idMatch[1] : tag.slice(0, 40));
        }
    }

    if (allInputsCompliant && inputMatches.length > 0) {
        passCount++;
        logItem(`全站 ${inputMatches.length} 处文本输入框均符合 iOS >=16px 防自动放大规范`);
    } else {
        failCount++;
        logItem(`发现未适配 16px 的输入框: ${nonCompliant.join(', ')}`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`输入框规范扫描异常: ${e.message}`, 'error');
}

// 4.3 <button> 标签显式声明 type="button" 规范全量扫描
try {
    const htmlContent = readFileSync(join(root, 'index.html'), 'utf-8');
    const buttonMatches = [...htmlContent.matchAll(/<button\b([^>]*)>/gi)];
    let allButtonsCompliant = true;
    const nonCompliantButtons = [];

    for (const match of buttonMatches) {
        const attrs = match[1];
        if (!/\btype=["'](button|submit|reset)["']/i.test(attrs)) {
            allButtonsCompliant = false;
            const idMatch = attrs.match(/id=["']([^"']+)["']/i);
            nonCompliantButtons.push(idMatch ? idMatch[1] : match[0].slice(0, 40));
        }
    }

    if (allButtonsCompliant && buttonMatches.length > 0) {
        passCount++;
        logItem(`全站 ${buttonMatches.length} 处 <button> 标签均 100% 显式声明 type="button" 规范`);
    } else {
        failCount++;
        logItem(`发现缺少显式 type 属性的按钮: ${nonCompliantButtons.join(', ')}`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`按钮 type 属性规范扫描异常: ${e.message}`, 'error');
}

// 4.4 装饰性 <svg> 矢量图标 W3C WAI-ARIA (aria-hidden="true") 规范扫描
try {
    const htmlContent = readFileSync(join(root, 'index.html'), 'utf-8');
    const svgMatches = [...htmlContent.matchAll(/<svg\b([^>]*)>/gi)];
    let allSvgsCompliant = true;
    const nonCompliantSvgs = [];

    for (const match of svgMatches) {
        const attrs = match[1];
        const hasA11y = /\baria-hidden=["']true["']/i.test(attrs) || /\baria-label=["'][^"']+["']/i.test(attrs) || /\brole=["']img["']/i.test(attrs);
        if (!hasA11y) {
            allSvgsCompliant = false;
            const classMatch = attrs.match(/class=["']([^"']+)["']/i);
            nonCompliantSvgs.push(classMatch ? classMatch[1] : match[0].slice(0, 40));
        }
    }

    if (allSvgsCompliant && svgMatches.length > 0) {
        passCount++;
        logItem(`全站 ${svgMatches.length} 处内嵌 <svg> 矢量图标均 100% 符合 WAI-ARIA 无障碍规范`);
    } else {
        failCount++;
        logItem(`发现缺少无障碍属性的 SVG: ${nonCompliantSvgs.join(', ')}`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`SVG 无障碍规范扫描异常: ${e.message}`, 'error');
}

// 4.5 CSS 样式表 !important 污染静态扫描门禁 (仅放行 prefers-reduced-motion 国际无障碍白名单)
try {
    const htmlContent = readFileSync(join(root, 'index.html'), 'utf-8');
    const styleBlocks = [...htmlContent.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
    let unauthorizedImportantCount = 0;
    const violations = [];

    for (const block of styleBlocks) {
        const css = block[1];
        // 剥离合法的 @media (prefers-reduced-motion: reduce) { ... } 区域
        const sanitizedCss = css.replace(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{[\s\S]*?\}/gi, '/* a11y-reduced-motion-cleared */');
        
        const lines = sanitizedCss.split('\n');
        lines.forEach((line, lineIdx) => {
            if (/!important/i.test(line)) {
                unauthorizedImportantCount++;
                violations.push(`第 ${lineIdx + 1} 行: ${line.trim()}`);
            }
        });
    }

    if (unauthorizedImportantCount === 0) {
        passCount++;
        logItem(`全站 CSS 样式表 100% 纯净（零非标准 !important 污染，仅保留 A11y 减弱动效白名单）`);
    } else {
        failCount++;
        logItem(`发现 ${unauthorizedImportantCount} 处非标准 !important 污染:\n    ${violations.slice(0, 5).join('\n    ')}`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`CSS !important 规范扫描异常: ${e.message}`, 'error');
}

// 4.6 DOM ID 唯一性与 cacheDOM() 引用健康门禁
try {
    const htmlContent = readFileSync(join(root, 'index.html'), 'utf-8');
    const bodyMatch = htmlContent.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[1] : htmlContent;
    const noScriptBody = bodyHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const idMatches = [...noScriptBody.matchAll(/\bid=["']([^"']+)["']/gi)];
    
    const idCounts = new Map();
    const duplicateIds = [];
    const domIdSet = new Set();

    for (const match of idMatches) {
        const id = match[1];
        domIdSet.add(id);
        const count = (idCounts.get(id) || 0) + 1;
        idCounts.set(id, count);
        if (count === 2) {
            duplicateIds.push(id);
        }
    }

    const cacheDomMatch = htmlContent.match(/function\s+cacheDOM\s*\(\)\s*\{[\s\S]*?const\s+ids\s*=\s*['"]([^'"]+)['"]/i);
    const cachedIds = cacheDomMatch ? cacheDomMatch[1].trim().split(/\s+/) : [];
    const missingCachedIds = cachedIds.filter(id => !domIdSet.has(id));

    if (duplicateIds.length === 0 && missingCachedIds.length === 0 && domIdSet.size > 0) {
        passCount++;
        logItem(`全站 ${domIdSet.size} 个 DOM ID 100% 全局唯一，且 cacheDOM() ${cachedIds.length} 个缓存映射健康无死引用`);
    } else {
        failCount++;
        const errors = [];
        if (duplicateIds.length > 0) errors.push(`重复 ID: ${duplicateIds.join(', ')}`);
        if (missingCachedIds.length > 0) errors.push(`cacheDOM 丢失引用 ID: ${missingCachedIds.join(', ')}`);
        logItem(`DOM ID 校验失败: ${errors.join(' | ')}`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`DOM ID 唯一性与引用检查异常: ${e.message}`, 'error');
}

// 4.7 书签 Schema 结构、HTTPS 协议安全与 desc 排版规范门禁
try {
    const rawBookmarks = readFileSync(join(root, 'bookmarks.json'), 'utf-8');
    const data = JSON.parse(rawBookmarks);
    let totalBookmarks = 0;
    const errors = [];

    // 校验常用书签 bookmarks
    if (Array.isArray(data.bookmarks)) {
        data.bookmarks.forEach((bm, i) => {
            totalBookmarks++;
            if (!bm.name || typeof bm.name !== 'string') errors.push(`常用书签 #${i} 缺少有效 name`);
            if (!bm.url || !bm.url.startsWith('https://')) errors.push(`常用书签 [${bm.name || i}] URL 必须以 https:// 开头 (当前: ${bm.url})`);
            if (!bm.icon || typeof bm.icon !== 'string') errors.push(`常用书签 [${bm.name || i}] 缺少有效 icon`);
        });
    } else {
        errors.push('缺少顶层 bookmarks 数组');
    }

    // 校验分类书签 categories
    if (Array.isArray(data.categories)) {
        const catNameSet = new Set();
        data.categories.forEach((cat, catIdx) => {
            if (!cat.name) errors.push(`分类 #${catIdx} 缺少 name`);
            if (catNameSet.has(cat.name)) errors.push(`分类名重复: ${cat.name}`);
            catNameSet.add(cat.name);

            if (Array.isArray(cat.bookmarks)) {
                cat.bookmarks.forEach((bm, bmIdx) => {
                    totalBookmarks++;
                    const prefix = `[${cat.name}] ${bm.name || '#' + bmIdx}`;
                    if (!bm.name || typeof bm.name !== 'string') errors.push(`${prefix} 缺少有效 name`);
                    if (!bm.url || !bm.url.startsWith('https://')) errors.push(`${prefix} URL 必须以 https:// 开头 (当前: ${bm.url})`);
                    if (!bm.icon || typeof bm.icon !== 'string') errors.push(`${prefix} 缺少有效 icon`);
                    if (!bm.desc || typeof bm.desc !== 'string' || bm.desc.trim().length === 0) {
                        errors.push(`${prefix} 缺少有效 desc 简介`);
                    } else if (bm.desc.length > 25) {
                        errors.push(`${prefix} desc 简介过长 (${bm.desc.length}字): "${bm.desc}"`);
                    }
                });
            } else {
                errors.push(`分类 [${cat.name}] 缺少 bookmarks 数组`);
            }
        });
    } else {
        errors.push('缺少顶层 categories 数组');
    }

    if (errors.length === 0) {
        passCount++;
        logItem(`全站 ${totalBookmarks} 个书签数据 Schema 规范、100% HTTPS 安全协议且 desc 简介无溢出`);
    } else {
        failCount++;
        logItem(`书签 Schema 校验失败 (${errors.length} 处):\n    ${errors.slice(0, 5).join('\n    ')}`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`书签 Schema 规范检查异常: ${e.message}`, 'error');
}

const elapsed = Date.now() - startTime;
console.log(`\n${c.gray}${HR_DOUBLE}${c.reset}`);
if (failCount === 0) {
    console.log(`${c.green}${c.bold}✨ 全部 ${passCount} 项静态语法与规范检查通过！${c.reset}${c.dim} (耗时: ${elapsed}ms)${c.reset}`);
} else {
    console.log(`${c.red}${c.bold}❌ 检测到 ${failCount} 项检查失败 (共 ${passCount + failCount} 项)！${c.reset}${c.dim} (耗时: ${elapsed}ms)${c.reset}`);
}
console.log(`${c.gray}${HR_DOUBLE}${c.reset}\n`);

process.exit(failCount ? 1 : 0);

