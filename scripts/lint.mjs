/**
 * 静态语法与格式检查 (scripts/lint.mjs)，DOM/CSS 通过开发依赖 Acorn/PostCSS 解析。
 * 1. 提取 src/index.html 内联脚本并校验语法
 * 2. 使用 node --check 校验核心脚本及 src/js 业务模块
 * 3. 校验 bookmarks.json、public/manifest.json 等 JSON 配置
 * 4. 静态检查输入字号、ARIA、CSS、DOM ID、书签及生命周期等工程约束
 */
import { readFileSync, writeFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { parse as parseJs } from 'acorn';
import { inspectDOMSources } from './lint-dom.mjs';
import { inspectCSSSources } from './lint-css.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isFixMode = process.argv.includes('--fix');

import { c, HR_DOUBLE, logSection, logItem } from './terminal.cjs';

function getLineCol(content, index) {
    const prefix = content.slice(0, index);
    const line = prefix.split('\n').length;
    const lastNewline = prefix.lastIndexOf('\n');
    const col = lastNewline === -1 ? index + 1 : index - lastNewline;
    return { line, col };
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
console.log(`${c.bold}${c.cyan}🔍 Glass Start — 静态语法与格式检查 (Static Lint)${isFixMode ? ' [🔧 FIX MODE]' : ''}${c.reset}`);
console.log(`${c.cyan}${HR_DOUBLE}${c.reset}`);

// 缓存共用核心文件内容，供多项检查复用。
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
const srcJsSources = allSrcJsFiles.map(file => ({ file, content: readFileSync(file, 'utf-8') }));
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
    { name: 'scripts/build.cjs', desc: '打包构建脚本' },
    { name: 'scripts/html-template.cjs', desc: '共享 HTML 模板处理' },
    { name: 'sw.js', desc: 'Service Worker 底座' },
    { name: 'scripts/server.cjs', desc: '本地开发/预览服务' },
    { name: 'scripts/terminal.cjs', desc: '共享终端输出' },
    { name: 'scripts/watch.cjs', desc: '共享文件监听' }
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

// 校验 src/js/ 下全部 ESM 业务模块 (单进程 Acorn 快速 AST 语法分析，并缓存 AST 供后续 DOM 规则复用)
if (srcJsSources.length > 0) {
    const failures = [];
    for (const source of srcJsSources) {
        try {
            source.ast = parseJs(source.content, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
        } catch (err) {
            const loc = err.loc ? `:${err.loc.line}:${err.loc.column}` : '';
            failures.push(`${relative(root, source.file)}${loc}:\n${err.message}`);
        }
    }
    const label = `src/js/            (${srcJsSources.length} 个 ESM 核心业务子模块)`;
    if (failures.length === 0) {
        passCount++;
        logItem(`${label} 语法全部通过`);
    } else {
        failCount++;
        logItem(`${label} 语法错误:\n${failures.join('\n')}`, 'error');
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

// 4.1 版本号一致性检查 (package.json / package-lock.json / index.html)
try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf-8'));

    const expectedVersion = pkg.version;
    const lockVersion = lock.version;
    const lockPkgVersion = lock.packages?.['']?.version;

    // 单一真理源校验：package.json 与 package-lock.json 保持同步
    const isLockSynced = lockVersion === expectedVersion && lockPkgVersion === expectedVersion;

    // 校验 src/index.html 品牌卡片版本号徽章同步状态
    let isHtmlSynced = true;
    const htmlBadgeMatch = indexHtml.match(/<span[^>]*class="[^"]*rounded-full[^"]*"[^>]*>v?([0-9]+\.[0-9]+\.[0-9]+)<\/span>/i);
    if (!htmlBadgeMatch || htmlBadgeMatch[1] !== expectedVersion) {
        isHtmlSynced = false;
    }

    if (expectedVersion && isLockSynced && isHtmlSynced) {
        passCount++;
        logItem(`版本号单一真理源 (v${expectedVersion}) package.json、package-lock.json 与 src/index.html 100% 对齐`);
    } else {
        failCount++;
        logItem(`版本号未对齐: pkg=${expectedVersion}, lock=${lockVersion}, lockPkg=${lockPkgVersion}, htmlSynced=${isHtmlSynced}`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`版本号单一真理源检查异常: ${e.message}`, 'error');
}

// 4.2 移动端 iOS 16px 防放大输入框规范静态扫描
try {
    const inputSources = [{ file: 'src/index.html', content: indexHtml }, ...srcJsSources];
    const inputMatches = inputSources.flatMap(source => [...source.content.matchAll(/<input[^>]*type=["']text["'][^>]*>/gi)].map(match => ({ match, ...source })));
    let allInputsCompliant = true;
    const nonCompliant = [];
    const mainCss = readFileSync(join(root, 'src', 'styles', 'main.css'), 'utf-8');
    const hasMouseDesktopGuard = /@custom-variant\s+mouse-desktop\s*\{\s*@media\s*\(min-width:\s*640px\)\s*and\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{\s*@media\s+not\s+all\s+and\s*\(any-pointer:\s*coarse\)\s*\{\s*@slot;\s*\}\s*\}\s*\}/.test(mainCss);

    for (const { match, file, content } of inputMatches) {
        const tag = match[0];
        const has16pxPlus = /text-(base|lg|xl|2xl|3xl)/.test(tag);
        const classes = tag.match(/class=["']([^"']*)["']/)?.[1] || '';
        const smallerOverrides = [...classes.matchAll(/(?:^|\s)((?:[\w-]+:)*text-(?:xs|sm|2xs))(?=\s|$)/g)].map(match => match[1]);
        // 紧凑输入字号仅放行书签编辑器与壁纸直链，且必须受纯鼠标桌面媒体条件保护。
        const isBookmarkEditorInput = file === join(root, 'src', 'js', 'modules', 'bookmark-editor.js')
            && /(?:^|\s)edit-(?:name|url)(?=\s|$)/.test(classes);
        const isWallpaperUrlInput = file === 'src/index.html' && /\bid=["']urlBgInput["']/.test(tag);
        const hasSmallerOverride = smallerOverrides.some(token =>
            token !== 'mouse-desktop:text-xs' || !(isBookmarkEditorInput || isWallpaperUrlInput) || !hasMouseDesktopGuard);
        if (!has16pxPlus || hasSmallerOverride) {
            allInputsCompliant = false;
            const { line, col } = getLineCol(content, match.index);
            const idMatch = tag.match(/id=["']([^"']+)["']/);
            const idDesc = idMatch ? `#${idMatch[1]}` : tag.slice(0, 30);
            nonCompliant.push(`${file}:${line}:${col} (<input ${idDesc}> 触屏字号必须 >=16px；仅书签编辑器与壁纸直链允许 mouse-desktop:text-xs)`);
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

// 4.5 CSS !important 门禁：按语法树查找减弱动效祖先，保留文件及行列位置。
let cssInspection;
try {
    const cssDir = join(root, 'src', 'styles');
    const cssFiles = ['main.css', 'glass.css', 'animations.css'];
    const sources = cssFiles.map(file => join(cssDir, file)).filter(file => existsSync(file))
        .map(file => ({ file: relative(root, file), content: readFileSync(file, 'utf-8') }));
    const styleBlocks = [...indexHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
    for (const block of styleBlocks) {
        const start = block.index + block[0].indexOf('>') + 1;
        const { line, col } = getLineCol(indexHtml, start);
        sources.push({ file: 'src/index.html', content: block[1], lineOffset: line - 1, columnOffset: col - 1 });
    }
    cssInspection = inspectCSSSources(sources);
    const violations = cssInspection.importantViolations;
    if (violations.length === 0) {
        passCount++;
        logItem('CSS !important 校验通过，仅放行减弱动效媒体查询中的声明');
    } else {
        failCount++;
        logItem(`发现 ${violations.length} 处白名单外 !important:\n    ${violations.slice(0, 5).join('\n    ')}`, 'error');
    }
} catch (e) {
    failCount++;
    logItem(`CSS !important 规范扫描异常: ${e.message}`, 'error');
}

// 4.5.1 同一声明块内，-webkit-backdrop-filter 须在标准属性之前。
try {
    if (!cssInspection) throw new Error('CSS 语法分析未完成');
    const invalidPrefixErrors = cssInspection.prefixViolations;
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
let domInspection;
try {
    domInspection = inspectDOMSources(srcJsSources,
        join(root, 'src', 'js', 'core', 'overlay-stack.js'), readFileSync(join(root, 'src', 'js', 'types.d.ts'), 'utf-8'));
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
    const uncachedIds = [...domInspection.cachedReferences].filter(id => !cachedIds.includes(id));
    const untypedIds = [...domInspection.cachedReferences].filter(id => !domInspection.typedIds.has(id));

    if (duplicateIds.length === 0 && missingCachedIds.length === 0 && uncachedIds.length === 0 && untypedIds.length === 0 && domIdSet.size > 0) {
        passCount++;
        logItem(`全站 ${domIdSet.size} 个 DOM ID 100% 全局唯一，且 cacheDOM() ${cachedIds.length} 个缓存映射健康无死引用`);
    } else {
        failCount++;
        const errors = [];
        if (duplicateIds.length > 0) errors.push(`重复 ID: ${duplicateIds.join(', ')}`);
        if (missingCachedIds.length > 0) errors.push(`cacheDOM 丢失引用 ID: ${missingCachedIds.join(', ')}`);
        if (uncachedIds.length > 0) errors.push(`dom 访问的 ID 未注册缓存: ${uncachedIds.join(', ')}`);
        if (untypedIds.length > 0) errors.push(`dom 访问的 ID 未声明 DOMCache 类型: ${untypedIds.join(', ')}`);
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
                    if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_HEADER)) {
                        errors.push(`${prefix} 本地图标 "public/icons/${iconFileName}" 非有效二进制 PNG 文件 (魔数校验失败)，请运行 "npm run sync:icons" 重新生成！`);
                    } else if (buf.readUInt32BE(16) !== buf.readUInt32BE(20) || buf.readUInt32BE(16) === 0) {
                        errors.push(`${prefix} 本地图标必须为非空 1:1 PNG: ${iconFileName}`);
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

// 切屏恢复、双通道唤醒和动画清理由 lifecycle-behavior.test.mjs 验证实际行为。

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

// 仅检查静态可识别的受管理弹窗；普通元素可独立修改 hidden/display。
try {
    if (!domInspection) throw new Error('DOM 语法分析未完成');
    const violations = domInspection.visibilityViolations;
    if (violations.length) throw new Error(violations.map(file => file.slice(root.length + 1)).join(', '));
    passCount++;
    logItem('受管理弹窗的显示生命周期由 OverlayStack 持有，普通元素可独立使用 hidden/display');
} catch (e) {
    failCount++;
    logItem(`弹窗显示生命周期门禁失败: ${e.message}`, 'error');
}

// 首屏共享配置单一真理源：模块长度/键集合/本地资源/构建插槽必须一致。
try {
    const loadConfig = relativePath => import(pathToFileURL(join(root, relativePath)).href);
    const [
        { PRESET_BACKGROUNDS },
        { PRESET_WALLPAPER_THEMES, PRESET_WALLPAPER_TINTS, PRESET_WALLPAPER_THEME_COLORS },
        { ENGINE_META },
        { ENGINE_SVGS },
        { WEATHER_EMOJI_MAP }
    ] = await Promise.all([
        loadConfig('src/js/config/backgrounds.js'),
        loadConfig('src/js/config/themes.js'),
        loadConfig('src/js/config/engines.js'),
        loadConfig('src/js/config/engine-icons.js'),
        loadConfig('src/js/config/weather-icons.js')
    ]);
    const errors = [];
    if (PRESET_BACKGROUNDS.length !== PRESET_WALLPAPER_THEMES.length) {
        errors.push(`壁纸 ${PRESET_BACKGROUNDS.length} 张 vs 主题 ${PRESET_WALLPAPER_THEMES.length} 个`);
    }
    if (PRESET_BACKGROUNDS.length !== PRESET_WALLPAPER_TINTS.length) {
        errors.push(`壁纸 ${PRESET_BACKGROUNDS.length} 张 vs 色调 ${PRESET_WALLPAPER_TINTS.length} 个`);
    }
    if (PRESET_BACKGROUNDS.length !== PRESET_WALLPAPER_THEME_COLORS.length) {
        errors.push(`壁纸 ${PRESET_BACKGROUNDS.length} 张 vs 外壳色 ${PRESET_WALLPAPER_THEME_COLORS.length} 个`);
    }
    const engineMetaKeys = Object.keys(ENGINE_META).sort();
    const engineSvgKeys = Object.keys(ENGINE_SVGS).sort();
    if (engineMetaKeys.join(',') !== engineSvgKeys.join(',')) {
        errors.push(`引擎元数据键 [${engineMetaKeys.join(',')}] vs 图标键 [${engineSvgKeys.join(',')}]`);
    }
    for (const [key, meta] of Object.entries(ENGINE_META)) {
        if (!meta.name || !/^https:\/\//.test(meta.url || '')) errors.push(`引擎 ${key} 缺少名称或 HTTPS 地址`);
        if (!ENGINE_SVGS[key]?.includes('<svg')) errors.push(`引擎 ${key} 缺少 SVG 图标`);
    }
    for (const [emoji, rel] of Object.entries(WEATHER_EMOJI_MAP)) {
        if (!/^\.\/icons\/emoji\/[a-z0-9_-]+\.svg$/i.test(rel)) {
            errors.push(`天气图标 ${emoji} 路径非法: ${rel}`);
        } else if (!existsSync(join(root, 'public', rel.slice(2)))) {
            errors.push(`天气图标 ${emoji} 文件缺失: ${rel}`);
        }
    }
    for (const bg of PRESET_BACKGROUNDS) {
        if (!/^\.\/wallpapers\/[a-z0-9-]+\.avif$/i.test(bg)) {
            errors.push(`壁纸路径非法: ${bg}`);
        } else if (!existsSync(join(root, 'public', bg.slice(2)))) {
            errors.push(`壁纸文件缺失: ${bg}`);
        }
    }
    for (const marker of ['/* INJECT_BACKGROUNDS */', '/* INJECT_ENGINE_ICONS */', '/* INJECT_WEATHER_ICONS */']) {
        const count = indexHtml.split(marker).length - 1;
        if (count !== 1) errors.push(`构建插槽 ${marker} 出现 ${count} 次`);
    }
    if (/const\s+backgrounds\s*=\s*\[/.test(indexHtml)) errors.push('index.html 仍内联壁纸数组');
    if (/const\s+ENGINE_SVGS\s*=\s*\{/.test(indexHtml)) errors.push('index.html 仍内联引擎图标');
    if (/const\s+m\s*=\s*\{\s*'☀️'/.test(indexHtml)) errors.push('index.html 仍内联天气图标');
    if (errors.length) throw new Error(errors.join(' | '));
    passCount++;
    logItem(`首屏共享配置单一真理源：${PRESET_BACKGROUNDS.length} 张壁纸、${engineMetaKeys.length} 个引擎、${Object.keys(WEATHER_EMOJI_MAP).length} 个天气图标，注入插槽与本地资源一致`);
} catch (e) {
    failCount++;
    logItem(`首屏共享配置一致性检查失败: ${e.message}`, 'error');
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
