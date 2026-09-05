/**
 * W3C 官方在线校验器门禁 (scripts/validate-w3c.mjs)
 * 1. 优先校验生产构建产物 dist/index.html (零依赖极简架构)
 * 2. 自动调用 W3C 官方 Nu Html Checker (https://validator.w3.org/nu/?out=json)
 * 3. 剥离 CSS @property (Tailwind v4 前沿标准规范) 与本地 file:// CSP 误报，严格校验所有 HTML/DOM 标签、属性与 WAI-ARIA
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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

console.log(`\n${c.cyan}${HR_DOUBLE}${c.reset}`);
console.log(`${c.bold}${c.cyan}🌐 Glass Start — W3C 官方语法与结构验证器 (W3C Nu Validator)${c.reset}`);
console.log(`${c.cyan}${HR_DOUBLE}${c.reset}\n`);

const distHtmlPath = join(root, 'dist', 'index.html');
const srcHtmlPath = join(root, 'src', 'index.html');
const targetPath = existsSync(distHtmlPath) ? distHtmlPath : srcHtmlPath;
const targetName = existsSync(distHtmlPath) ? 'dist/index.html' : 'src/index.html';

console.log(`  ${c.dim}正在读取待校验文件: ${targetName}...${c.reset}`);
const rawHtml = readFileSync(targetPath, 'utf-8');

console.log(`  ${c.dim}正在连接 W3C 官方在线验证 API (https://validator.w3.org/nu/)...${c.reset}`);

let auditorVersion = '4.4.2';
try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    if (pkg.version) auditorVersion = pkg.version;
} catch {}

try {
    const startTime = Date.now();
    const res = await fetch('https://validator.w3.org/nu/?out=json', {
        method: 'POST',
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'User-Agent': `Glass-Start-W3C-Auditor/${auditorVersion} (Node.js)`
        },
        body: rawHtml
    });

    if (!res.ok) {
        throw new Error(`W3C 校验器响应异常: HTTP ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const elapsed = Date.now() - startTime;
    const messages = data.messages || [];

    // 过滤策略：
    // 1. 过滤 W3C Nu 尚未完全同步 CSS3/CSS4 新特性的误报（Tailwind v4 产出的 @property, margin-trim, line-clamp 等现代规范）
    // 2. 过滤本地验证 context 下因缺少同源 server 导致的 CSP 误警
    const realErrors = messages.filter(m => {
        const msg = m.message || '';
        if (msg.includes('CSS: Unrecognized at-rule “@property”')) return false;
        if (msg.includes('CSS: “margin-trim”')) return false;
        if (msg.includes('CSS: “transition-property”: “--tw-')) return false;
        if (msg.includes('CSS: “line-clamp”')) return false;
        if (m.type === 'info' && m.subType === 'warning' && msg.includes('Content Security Policy')) return false;
        return true;
    });

    console.log(`\n${c.gray}─── 校验结果汇总 (${elapsed}ms) ──────────────────────────────────────────${c.reset}`);

    if (realErrors.length === 0) {
        console.log(`  ${c.green}✔ W3C HTML5 语义化结构与 WAI-ARIA 规范：100% 全量合规（0 语法错误，0 标签与属性违规）${c.reset}`);
        console.log(`  ${c.dim}ℹ Tailwind v4 编译出的现代 CSS 规范 (@property / line-clamp / margin-trim) 已由原生编译器兼容${c.reset}`);
        console.log(`\n${c.green}${c.bold}✨ W3C 官方验证器门禁检验通过！${c.reset}\n`);
        process.exit(0);
    } else {
        console.log(`  ${c.red}❌ 检测到 ${realErrors.length} 处 W3C 结构或属性违规：${c.reset}\n`);
        realErrors.forEach((err, idx) => {
            console.log(`  ${c.red}[${idx + 1}] Line ${err.lastLine || '?'}, Col ${err.firstColumn || '?'}: ${err.message}${c.reset}`);
            if (err.extract) {
                console.log(`      ${c.gray}片段: ${err.extract}${c.reset}`);
            }
        });
        console.log(`\n${c.red}${c.bold}❌ W3C 官方验证器门禁未通过，请修复上述问题后再行发布！${c.reset}\n`);
        process.exit(1);
    }
} catch (err) {
    console.error(`  ${c.yellow}⚠ 连接 W3C 验证服务器失败: ${err.message}${c.reset}`);
    console.error(`  ${c.yellow}  (如果处于无外网连接环境，可稍后重试)${c.reset}\n`);
    process.exit(1);
}
