/**
 * 根目录零依赖静态语法与格式检查 (scripts/lint.mjs)
 * 1. 提取 index.html 内所有内联 <script> 做纯内存 AST 语法校验
 * 2. 对核心 JavaScript 脚本 (scripts/build.js, sw.js, scripts/server.js) 做纯内存语法校验
 * 3. 对根目录 JSON 配置文件 (bookmarks.json, manifest.json, package.json) 做合法性校验
 * 4. 全站 12 项工程宪法规范静态门禁扫描 (iOS 16px, WAI-ARIA, !important, DOM ID, BFCache 等)
 */
import { readFileSync, writeFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isFixMode = process.argv.includes('--fix');

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

function getLineCol(content, index) {
    const prefix = content.slice(0, index);
    const line = prefix.split('\n').length;
    const lastNewline = prefix.lastIndexOf('\n');
    const col = lastNewline === -1 ? index + 1 : index - lastNewline;
    return { line, col };
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
console.log(`${c.bold}${c.cyan}🔍 Glass Start — 零依赖静态语法与格式检查 (Static Lint)${isFixMode ? ' [🔧 FIX MODE]' : ''}${c.reset}`);
console.log(`${c.cyan}${HR_DOUBLE}${c.reset}`);

// 全局单次读取核心文件，彻底消除多次读盘 I/O
const htmlPath = join(root, 'src', 'index.html');
let indexHtml = readFileSync(htmlPath, 'utf-8');

// 🔧 --fix 自动修复模式：针对机械性规则就地自愈
if (isFixMode) {
    let fixedHtml = indexHtml;
    let fixCount = 0;

    // 1. 自动为缺少 type 的 <button> 补齐 type="button"
    fixedHtml = fixedHtml.replace(/<button\b(?![^>]*\btype=)/gi, () => {
        fixCount++;
        return '<button type="button"';
    });

    // 2. 自动为缺少 ARIA 属性的 <svg> 补齐 aria-hidden="true"
    fixedHtml = fixedHtml.replace(/<svg\b(?![^>]*\b(aria-hidden|aria-label|role)=)/gi, () => {
        fixCount++;
        return '<svg aria-hidden="true"';
    });

    // 3. 自动同步 src/index.html 品牌卡片版本号徽章 (对齐 package.json)
    try {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
        if (pkg.version) {
            const nextFixedHtml = fixedHtml.replace(
                /(<span[^>]*class="[^"]*rounded-full[^"]*"[^>]*>)v?[0-9]+\.[0-9]+\.[0-9]+(<\/span>)/i,
                `$1v${pkg.version}$2`
            );
            if (nextFixedHtml !== fixedHtml) {
                fixCount++;
                fixedHtml = nextFixedHtml;
            }
        }
    } catch {}

    if (fixCount > 0) {
        writeFileSync(htmlPath, fixedHtml, 'utf-8');
        indexHtml = fixedHtml;
        console.log(`  ${c.green}⚡ [Auto-Fix] 已自动修复 src/index.html 中 ${fixCount} 处机械性无障碍属性与版本徽章规范！${c.reset}`);
    }
}

function getAllJsInDir(dir) {
    let results = [];
    if (!existsSync(dir)) return results;
    readdirSync(dir, { withFileTypes: true }).forEach(entry => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) results.push(...getAllJsInDir(full));
        else if (entry.name.endsWith('.js')) results.push(full);
    });
    return results;
}
const allSrcJsFiles = getAllJsInDir(join(root, 'src', 'js'));
const allSrcJsContent = allSrcJsFiles.map(f => readFileSync(f, 'utf-8')).join('\n');
const screenStateFile = join(root, 'src', 'js', 'core', 'screen-state.js');
const screenStateContent = existsSync(screenStateFile) ? readFileSync(screenStateFile, 'utf-8') : '';

// ---- 1. src/index.html 内联 <script> 语法校验 ----
logSection('1/4', '📄 校验 src/index.html 内联脚本语法');
const scripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
scripts.forEach((m, i) => {
    const fullTag = m[0];
    const code = m[1];
    let tagDesc = '';
    if (fullTag.includes('application/ld+json')) {
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

// ---- 2. 核心 JS 脚本与 src/js 业务模块语法校验 (node --check) ----
logSection('2/4', '⚙️  校验核心 JavaScript 语法 (node --check)');
const jsFiles = [
    { name: 'scripts/build.js', desc: '打包构建脚本' },
    { name: 'sw.js', desc: 'Service Worker 底座' },
    { name: 'scripts/server.js', desc: '本地开发/预览服务' }
].filter(f => {
    try { return statSync(join(root, f.name)).isFile(); } catch { return false; }
});

for (const item of jsFiles) {
    const fullPath = join(root, item.name);
    const label = `${item.name.padEnd(18, ' ')} (${item.desc})`;
    try {
        const code = readFileSync(fullPath, 'utf-8');
        new vm.Script(code, { filename: item.name });
        passCount++;
        logItem(`${label} 语法通过`);
    } catch (e) {
        failCount++;
        logItem(`${label} 语法错误:\n${e.message}`, 'error');
    }
}

// 校验 src/js/ 下全部 ESM 业务模块
if (allSrcJsFiles.length > 0) {
    const checkRes = spawnSync(process.execPath, ['--check', ...allSrcJsFiles], { encoding: 'utf-8' });
    const label = `src/js/            (${allSrcJsFiles.length} 个 ESM 核心业务子模块)`;
    if (checkRes.status === 0) {
        passCount++;
        logItem(`${label} 语法全部通过`);
    } else {
        failCount++;
        logItem(`${label} 语法错误:\n${checkRes.stderr}`, 'error');
    }
}

// ---- 3. 根目录 JSON 配置文件合法性校验 ----
logSection('3/4', '📦 校验 JSON 配置文件格式');
const jsonFiles = [
    { name: 'bookmarks.json', path: join(root, 'bookmarks.json'), desc: '书签与分类数据源' },
    { name: 'manifest.json', path: join(root, 'public', 'manifest.json'), desc: 'PWA Web 应用程序清单' },
    { name: 'package.json', path: join(root, 'package.json'), desc: 'NPM 依赖与指令配置' }
].filter(f => {
    try { return statSync(f.path).isFile(); } catch { return false; }
});

for (const item of jsonFiles) {
    const label = `${item.name.padEnd(15, ' ')} (${item.desc})`;
    try {
        const content = readFileSync(item.path, 'utf-8');
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

    const expectedVersion = pkg.version;
    const lockVersion = lock.version;
    const lockPkgVersion = lock.packages?.['']?.version;

    // 单一真理源校验：package.json 与 package-lock.json 保持同步
    const isLockSynced = lockVersion === expectedVersion && lockPkgVersion === expectedVersion;

    // 校验 README.md 顶部版本号徽章同步状态
    let isReadmeSynced = true;
    try {
        const readme = readFileSync(join(root, 'README.md'), 'utf-8');
        const readmeMatch = readme.match(/badge\/version-v([0-9]+\.[0-9]+\.[0-9]+)-blue\.svg/i);
        if (readmeMatch && readmeMatch[1] !== expectedVersion) {
            isReadmeSynced = false;
        }
    } catch {}

    // 校验 src/index.html 品牌卡片版本号徽章同步状态
    let isHtmlSynced = true;
    const htmlBadgeMatch = indexHtml.match(/<span[^>]*class="[^"]*rounded-full[^"]*"[^>]*>v?([0-9]+\.[0-9]+\.[0-9]+)<\/span>/i);
    if (!htmlBadgeMatch || htmlBadgeMatch[1] !== expectedVersion) {
        isHtmlSynced = false;
    }

    if (expectedVersion && isLockSynced && isReadmeSynced && isHtmlSynced) {
        passCount++;
        logItem(`版本号单一真理源 (v${expectedVersion}) package.json、package-lock.json、README.md 与 src/index.html 100% 对齐`);
    } else {
        failCount++;
        logItem(`版本号未对齐: pkg=${expectedVersion}, lock=${lockVersion}, lockPkg=${lockPkgVersion}, readmeSynced=${isReadmeSynced}, htmlSynced=${isHtmlSynced}`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`版本号单一真理源检查异常: ${e.message}`, 'error');
}

// 4.2 移动端 iOS 16px 防放大输入框规范静态扫描
try {
    const inputMatches = [...indexHtml.matchAll(/<input[^>]*type=["']text["'][^>]*>/gi)];
    let allInputsCompliant = true;
    const nonCompliant = [];

    for (const match of inputMatches) {
        const tag = match[0];
        const has16pxPlus = /text-(base|lg|xl|2xl|3xl)/.test(tag);
        if (!has16pxPlus) {
            allInputsCompliant = false;
            const { line, col } = getLineCol(indexHtml, match.index);
            const idMatch = tag.match(/id=["']([^"']+)["']/);
            const idDesc = idMatch ? `#${idMatch[1]}` : tag.slice(0, 30);
            nonCompliant.push(`src/index.html:${line}:${col} (<input ${idDesc}> 缺少 text-base)`);
        }
    }

    if (allInputsCompliant && inputMatches.length > 0) {
        passCount++;
        logItem(`全站 ${inputMatches.length} 处文本输入框均符合 iOS >=16px 防自动放大规范`);
    } else {
        failCount++;
        logItem(`发现未适配 16px 的输入框:\n    ${nonCompliant.join('\n    ')}`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`输入框规范扫描异常: ${e.message}`, 'error');
}

// 4.3 <button> 标签显式声明 type="button" 规范全量扫描
try {
    const buttonMatches = [...indexHtml.matchAll(/<button\b([^>]*)>/gi)];
    let allButtonsCompliant = true;
    const nonCompliantButtons = [];

    for (const match of buttonMatches) {
        const attrs = match[1];
        if (!/\btype=["'](button|submit|reset)["']/i.test(attrs)) {
            allButtonsCompliant = false;
            const { line, col } = getLineCol(indexHtml, match.index);
            const idMatch = attrs.match(/id=["']([^"']+)["']/i);
            const idDesc = idMatch ? `#${idMatch[1]}` : match[0].slice(0, 30);
            nonCompliantButtons.push(`src/index.html:${line}:${col} (<button ${idDesc}>)`);
        }
    }

    if (allButtonsCompliant && buttonMatches.length > 0) {
        passCount++;
        logItem(`全站 ${buttonMatches.length} 处 <button> 标签均 100% 显式声明 type="button" 规范`);
    } else {
        failCount++;
        logItem(`发现缺少显式 type 属性的按钮 (可运行 npm run lint:fix 自动修复):\n    ${nonCompliantButtons.join('\n    ')}`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`按钮 type 属性规范扫描异常: ${e.message}`, 'error');
}

// 4.4 装饰性 <svg> 矢量图标 W3C WAI-ARIA (aria-hidden="true") 规范扫描
try {
    const svgMatches = [...indexHtml.matchAll(/<svg\b([^>]*)>/gi)];
    let allSvgsCompliant = true;
    const nonCompliantSvgs = [];

    for (const match of svgMatches) {
        const attrs = match[1];
        const hasA11y = /\baria-hidden=["']true["']/i.test(attrs) || /\baria-label=["'][^"']+["']/i.test(attrs) || /\brole=["']img["']/i.test(attrs);
        if (!hasA11y) {
            allSvgsCompliant = false;
            const { line, col } = getLineCol(indexHtml, match.index);
            const classMatch = attrs.match(/class=["']([^"']+)["']/i);
            const clsDesc = classMatch ? `.${classMatch[1].split(' ')[0]}` : match[0].slice(0, 30);
            nonCompliantSvgs.push(`src/index.html:${line}:${col} (<svg ${clsDesc}>)`);
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
    const cssDir = join(root, 'src', 'styles');
    const cssFiles = ['main.css', 'glass.css', 'animations.css'];
    let allCssContent = '';
    for (const f of cssFiles) {
        const p = join(cssDir, f);
        if (existsSync(p)) allCssContent += '\n' + readFileSync(p, 'utf-8');
    }
    const styleBlocks = [...indexHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
    for (const block of styleBlocks) allCssContent += '\n' + block[1];

    let unauthorizedImportantCount = 0;
    const violations = [];

    const sanitizedCss = allCssContent.replace(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{[\s\S]*?\}/gi, '/* a11y-reduced-motion-cleared */');
    const lines = sanitizedCss.split('\n');
    lines.forEach((line, lineIdx) => {
        if (/!important/i.test(line)) {
            unauthorizedImportantCount++;
            violations.push(`第 ${lineIdx + 1} 行: ${line.trim()}`);
        }
    });

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

// 4.5.1 CSS 前缀层叠顺序门禁（-webkit-backdrop-filter 必须置于标准 backdrop-filter 之前，防止 Tailwind/Lightning CSS 编译器优化时剔除标准属性导致 Chrome 毛玻璃失效）
try {
    const cssDir = join(root, 'src', 'styles');
    const cssFiles = ['main.css', 'glass.css', 'animations.css'];
    const invalidPrefixErrors = [];
    for (const f of cssFiles) {
        const p = join(cssDir, f);
        if (existsSync(p)) {
            const content = readFileSync(p, 'utf-8');
            const lines = content.split('\n');
            let currentSelector = '';
            let inBlock = false;
            let seenStandardBackdrop = false;
            let standardLine = 0;
            lines.forEach((line, idx) => {
                if (line.includes('{')) {
                    inBlock = true;
                    currentSelector = line.split('{')[0].trim();
                    seenStandardBackdrop = false;
                }
                if (inBlock) {
                    if (/backdrop-filter\s*:/i.test(line) && !/-webkit-backdrop-filter/i.test(line)) {
                        seenStandardBackdrop = true;
                        standardLine = idx + 1;
                    }
                    if (/-webkit-backdrop-filter\s*:/i.test(line) && seenStandardBackdrop) {
                        invalidPrefixErrors.push(`${f}:${idx + 1} (${currentSelector}): -webkit-backdrop-filter 位于标准 backdrop-filter (第 ${standardLine} 行) 之后，会导致编译器误杀标准属性致使 Chrome 毛玻璃失效`);
                    }
                }
                if (line.includes('}')) {
                    inBlock = false;
                    seenStandardBackdrop = false;
                }
            });
        }
    }
    if (invalidPrefixErrors.length === 0) {
        passCount++;
        logItem(`CSS 厂商前缀层叠顺序 100% 规范（-webkit- 前缀均先于标准属性声明，确保跨浏览器编译不丢属性）`);
    } else {
        failCount++;
        logItem(`CSS 前缀层叠顺序异常 (${invalidPrefixErrors.length} 处):\n    ${invalidPrefixErrors.join('\n    ')}`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`CSS 前缀层叠顺序扫描异常: ${e.message}`, 'error');
}

// 4.6 DOM ID 唯一性与 cacheDOM() 引用健康门禁
try {
    const bodyMatch = indexHtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[1] : indexHtml;
    const noScriptBody = bodyHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const spriteSvgPath = join(root, 'src', 'svg', 'sprite.svg');
    const spriteSvg = existsSync(spriteSvgPath) ? readFileSync(spriteSvgPath, 'utf-8') : '';
    const idMatches = [...(noScriptBody + '\n' + spriteSvg).matchAll(/\bid=["']([^"']+)["']/gi)];
    
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

    const domJsPath = join(root, 'src', 'js', 'state', 'dom.js');
    const domJsContent = existsSync(domJsPath) ? readFileSync(domJsPath, 'utf-8') : '';
    const cacheDomMatch = domJsContent.match(/const\s+ids\s*=\s*['"]([^'"]+)['"]/i);
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

// 4.7 书签 Schema 结构、本地图标物理就绪、HTTPS 协议安全与 desc 排版规范门禁
try {
    const rawBookmarks = readFileSync(join(root, 'bookmarks.json'), 'utf-8');
    const data = JSON.parse(rawBookmarks);
    let totalBookmarks = 0;
    const errors = [];
    const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    function checkBookmarkItem(bm, prefix) {
        totalBookmarks++;
        if (!bm.name || typeof bm.name !== 'string') errors.push(`${prefix} 缺少有效 name`);
        if (!bm.url || !bm.url.startsWith('https://')) errors.push(`${prefix} URL 必须以 https:// 开头 (当前: ${bm.url})`);
        
        // 本地图标格式与物理磁盘存在性硬性门禁
        if (!bm.icon || typeof bm.icon !== 'string') {
            errors.push(`${prefix} 缺少有效 icon`);
        } else if (!bm.icon.startsWith('./icons/') || !bm.icon.endsWith('.png')) {
            errors.push(`${prefix} 图标路径必须采用规范的本地相对路径 "./icons/{domain}.png" (当前: "${bm.icon}")，请运行 "npm run sync:icons" 自动同步！`);
        } else {
            const iconFileName = bm.icon.replace(/^\.\/icons\//, '');
            const iconPath = join(root, 'public', 'icons', iconFileName);
            if (!existsSync(iconPath)) {
                errors.push(`${prefix} 本地图标物理文件缺失: "public/icons/${iconFileName}"，请运行 "npm run sync:icons" 自动下载转写！`);
            } else {
                try {
                    const buf = readFileSync(iconPath);
                    if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_HEADER)) {
                        errors.push(`${prefix} 本地图标 "public/icons/${iconFileName}" 非有效二进制 PNG 文件 (魔数校验失败)，请运行 "npm run sync:icons" 重新生成！`);
                    }
                } catch (readErr) {
                    errors.push(`${prefix} 本地图标读取失败: ${readErr.message}`);
                }
            }
        }
    }

    if (Array.isArray(data.bookmarks)) {
        data.bookmarks.forEach((bm, i) => {
            checkBookmarkItem(bm, `常用书签 [${bm.name || '#' + i}]`);
        });
    } else {
        errors.push('缺少顶层 bookmarks 数组');
    }

    if (Array.isArray(data.categories)) {
        const catNameSet = new Set();
        data.categories.forEach((cat, catIdx) => {
            if (!cat.name) errors.push(`分类 #${catIdx} 缺少 name`);
            if (catNameSet.has(cat.name)) errors.push(`分类名重复: ${cat.name}`);
            catNameSet.add(cat.name);

            if (Array.isArray(cat.bookmarks)) {
                cat.bookmarks.forEach((bm, bmIdx) => {
                    const prefix = `[${cat.name}] ${bm.name || '#' + bmIdx}`;
                    checkBookmarkItem(bm, prefix);
                    if (!bm.desc || typeof bm.desc !== 'string' || bm.desc.trim().length === 0) {
                        errors.push(`${prefix} 缺少有效 desc 简介`);
                    } else {
                        const hasAlpha = /[a-zA-Z0-9]/.test(bm.desc);
                        const maxLen = hasAlpha ? 13 : 9;
                        if (bm.desc.length > maxLen) {
                            const typeDesc = hasAlpha ? '中英混排上限13字符' : '纯中文上限9字符';
                            const excess = bm.desc.length - maxLen;
                            errors.push(`bookmarks.json [${cat.name} ➔ ${bm.name}]: desc 溢出 ${excess} 字符 (当前 ${bm.desc.length}/${maxLen} 字符, ${typeDesc}): "${bm.desc}"`);
                        }
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
        logItem(`全站 ${totalBookmarks} 个书签数据 Schema 规范、100% 本地图标就绪、HTTPS 安全协议且 desc 简介无溢出`);
    } else {
        failCount++;
        logItem(`书签 Schema 与本地图标校验失败 (${errors.length} 处):\n    ${errors.slice(0, 5).join('\n    ')}`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`书签 Schema 规范检查异常: ${e.message}`, 'error');
}

// 4.8 🚫 严禁主应用脚本在运行期滥加 .nr 类名（防止首屏被推飞）
try {
    const hasNrAdd = /\.classList\.add\([^)]*['"]nr['"][^)]*\)/.test(allSrcJsContent);
    if (!hasNrAdd) {
        passCount++;
        logItem(`运行期 .nr 布局类名零污染（仅保留 HEAD 脚本刷新预水合通道）`);
    } else {
        failCount++;
        logItem(`主脚本发现运行期滥加 .nr 类名（会导致首屏在唤醒时被推飞），必须立即移除`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`运行期 .nr 规范扫描异常: ${e.message}`, 'error');
}

// 4.9 🚫 严禁 reconcileScreenState 注入内联 transition:none（防止后台冻结 rAF 导致卡死）
try {
    const reconcileMatch = screenStateContent.match(/function\s+reconcileScreenState\s*\([^)]*\)\s*\{([\s\S]*?)\nexport/i) ||
                          screenStateContent.match(/function\s+reconcileScreenState\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/i);
    const reconcileBody = reconcileMatch ? reconcileMatch[1] : '';
    const hasInlineTransitionNone = /\.style\.transition\s*=\s*['"]none['"]/i.test(reconcileBody);
    if (!hasInlineTransitionNone && reconcileBody.length > 0) {
        passCount++;
        logItem(`reconcileScreenState 双屏状态自愈 100% 声明式（零内联 transition:none 竞态隐患）`);
    } else {
        failCount++;
        logItem(`reconcileScreenState 中发现内联 style.transition='none'（在后台挂起时会导致切屏过渡失效），必须改为纯 CSS 类名控制`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`reconcileScreenState 样式纯净度扫描异常: ${e.message}`, 'error');
}

// 4.10 🛡️ 全局多标签与 BFCache 双通道唤醒自愈闭环门禁
try {
    const hasVisibilityListener = /addEventListener\(\s*['"]visibilitychange['"][\s\S]*?handleAppWakeUp/i.test(screenStateContent) ||
                                  /addEventListener\(\s*['"]visibilitychange['"][\s\S]*?reconcileScreenState/i.test(screenStateContent);
    const hasPageshowListener = /addEventListener\(\s*['"]pageshow['"][\s\S]*?handleAppWakeUp/i.test(screenStateContent) ||
                                /addEventListener\(\s*['"]pageshow['"][\s\S]*?reconcileScreenState/i.test(screenStateContent);

    if (hasVisibilityListener && hasPageshowListener) {
        passCount++;
        logItem(`页面唤醒自愈机制 100% 覆盖 visibilitychange（多标签切回）与 pageshow（BFCache后退）双通道`);
    } else {
        failCount++;
        logItem(`页面唤醒自愈通道缺失: visibilitychange=${hasVisibilityListener}, pageshow=${hasPageshowListener}`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`唤醒自愈双通道扫描异常: ${e.message}`, 'error');
}

// 4.11 🛡️ fade-in 入场动效自动脱壳卸载门禁
try {
    const hasFadeInUnload = /\.classList\.remove\([^)]*['"]fade-in['"][^)]*\)/.test(allSrcJsContent);
    if (hasFadeInUnload) {
        passCount++;
        logItem(`入场动画包含自动脱壳机制（fade-in 播完即卸载，根绝 Safari BFCache 回退 opacity:0）`);
    } else {
        failCount++;
        logItem(`未检测到 fade-in 自动脱壳卸载逻辑（会导致 Safari 从快照恢复时动画重置回滚至透明）`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`fade-in 脱壳机制扫描异常: ${e.message}`, 'error');
}

// 4.12 🚫 严禁滥加全局字体抗锯齿属性（-webkit-font-smoothing / -moz-osx-font-smoothing）
try {
    const cssDir = join(root, 'src', 'styles');
    const cssFiles = ['main.css', 'glass.css', 'animations.css'];
    let allCss = '';
    for (const f of cssFiles) {
        const p = join(cssDir, f);
        if (existsSync(p)) allCss += '\n' + readFileSync(p, 'utf-8');
    }
    const hasFontSmoothing = /font-smoothing\s*:\s*antialiased/i.test(allCss + '\n' + indexHtml) ||
                             /-moz-osx-font-smoothing\s*:\s*grayscale/i.test(allCss + '\n' + indexHtml);
    if (!hasFontSmoothing) {
        passCount++;
        logItem(`全站字体排版纯净合规（严禁人为添加 -webkit-font-smoothing 降级抗锯齿）`);
    } else {
        failCount++;
        logItem(`检测到非法 font-smoothing 属性，严禁滥用该属性导致字体发虚和单薄`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`字体抗锯齿门禁扫描异常: ${e.message}`, 'error');
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
