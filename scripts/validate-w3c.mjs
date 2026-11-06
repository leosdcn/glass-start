/** HTML 使用 Nu 在线校验，内嵌样式使用 Stylelint；退出码 0 通过，1 页面错误，2 校验未完成。 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { c, HR_DOUBLE } from './terminal.cjs';
import stylelint from 'stylelint';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 只检查语法和属性值，不对构建后的压缩 CSS 增加排版规则。
const cssRules = {
    'at-rule-no-unknown': true,
    'at-rule-prelude-no-invalid': true,
    'at-rule-descriptor-no-unknown': true,
    'at-rule-descriptor-value-no-unknown': true,
    'at-rule-property-required-list': { property: ['syntax', 'inherits'] },
    'property-no-unknown': true,
    'declaration-property-value-no-unknown': true,
    'value-no-invalid': true,
    'color-no-invalid-hex': true,
    'function-no-unknown': true,
    'media-feature-name-no-unknown': true,
    'media-query-no-invalid': true
};

/** Nu 自带 CSS 诊断仅在定位到已独立校验的 style 块时交由 Stylelint 裁定；行内 style 属性仍由 Nu 检查。 */
function isCheckedStyleMessage(message, blocks, lineOffsets) {
    if (!message.message.startsWith('CSS: ') || !Number.isInteger(message.lastLine)) return false;
    const lineStart = lineOffsets[message.lastLine - 1];
    if (lineStart === undefined) return false;
    const column = message.lastColumn || message.firstColumn;
    if (column) {
        const offset = lineStart + column - 1;
        return blocks.some(block => offset >= block.contentStart && offset < block.contentEnd);
    }
    // 缺少列号时，只接管整行都属于该 style 块的消息，避免误归类相邻的 HTML 属性。
    const lineEnd = (lineOffsets[message.lastLine] ?? Infinity) - 1;
    return blocks.some(block => lineStart >= block.start && lineEnd <= block.end);
}

export async function validateW3c({ rootDir = root, fetchImpl = fetch, log = console.log, error = console.error,
    documentUrl = process.env.W3C_DOCUMENT_URL } = {}) {
    log(`\n${c.cyan}${HR_DOUBLE}${c.reset}`);
    log(`${c.bold}${c.cyan}🌐 Glass Start — Nu HTML / Stylelint CSS 校验${c.reset}`);
    log(`${c.cyan}${HR_DOUBLE}${c.reset}\n`);

    try {
        const targetName = existsSync(join(rootDir, 'dist', 'index.html')) ? 'dist/index.html' : 'src/index.html';
        const rawHtml = readFileSync(join(rootDir, targetName), 'utf-8');
        const { version } = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
        const blocks = [...rawHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map(match => {
            const contentStart = match.index + match[0].indexOf('>') + 1;
            return { content: match[1], start: match.index, end: match.index + match[0].length,
                contentStart, contentEnd: contentStart + match[1].length };
        });
        const cssMessages = [];
        for (const [index, block] of blocks.entries()) {
            const result = await stylelint.lint({ code: block.content, codeFilename: `${targetName}.style-${index + 1}.css`,
                config: { rules: cssRules, ignoreDisables: true } });
            for (const file of result.results) {
                if (file.invalidOptionWarnings.length) throw new Error(file.invalidOptionWarnings.map(item => item.text).join('; '));
                cssMessages.push(...file.warnings.map(item => ({ ...item, block: index + 1 })));
            }
        }
        const cssErrors = cssMessages.filter(item => item.severity === 'error');
        log(`  内嵌 CSS（Stylelint，${blocks.length} 个 style 块）：${cssErrors.length} 个错误、${cssMessages.length - cssErrors.length} 个警告`);
        for (const item of cssMessages) log(`  style #${item.block}, Line ${item.line}, Col ${item.column}: ${item.text}`);
        if (cssErrors.length) {
            error('\n❌ CSS 校验存在错误，请修复后再发布。');
            return 1;
        }

        const canonical = [...rawHtml.matchAll(/<link\b[^>]*>/gi)].find(match => /\brel=["']canonical["']/i.test(match[0]));
        const sourceUrl = documentUrl || canonical?.[0].match(/\bhref=["']([^"']+)["']/i)?.[1];
        const headers = { 'Content-Type': 'text/html; charset=utf-8',
            'User-Agent': `Glass-Start-W3C-Auditor/${version} (Node.js)` };
        if (sourceUrl) {
            const parsed = new URL(sourceUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('校验文档来源必须为 HTTP(S) 地址');
            headers['Content-Location'] = parsed.href;
        }
        log(`  正在校验 ${targetName}，连接 W3C 在线验证 API...`);
        const startTime = Date.now();
        const res = await fetchImpl('https://validator.w3.org/nu/?out=json', {
            method: 'POST',
            headers,
            body: rawHtml,
            signal: AbortSignal.timeout(30000)
        });
        if (!res.ok) throw new Error(`W3C 服务响应异常: HTTP ${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!Array.isArray(data?.messages) || data.messages.some(message =>
            !message || typeof message.message !== 'string' || !['error', 'info'].includes(message.type))) {
            throw new Error('W3C 响应缺少有效消息列表，或包含校验器自身异常');
        }

        const lineOffsets = [0, ...[...rawHtml.matchAll(/\n/g)].map(match => match.index + 1)];
        const groups = { errors: [], warnings: [], csp: [], info: [], legacyCss: [] };
        for (const message of data.messages) {
            if (isCheckedStyleMessage(message, blocks, lineOffsets)) groups.legacyCss.push(message);
            else if (message.type === 'error') groups.errors.push(message);
            else if (message.subType === 'warning') {
                (message.message.includes('Content Security Policy') ? groups.csp : groups.warnings).push(message);
            } else groups.info.push(message);
        }

        log(`\n─── HTML 校验结果 (${Date.now() - startTime}ms)：${groups.errors.length} 个错误、${groups.warnings.length + groups.csp.length} 个警告 ───`);
        const printGroup = (title, messages, color) => {
            if (!messages.length) return;
            log(`\n${color}${title} (${messages.length})${c.reset}`);
            for (const [index, message] of messages.entries()) {
                log(`  [${index + 1}] Line ${message.lastLine || '?'}, Col ${message.firstColumn || '?'}: ${message.message}`);
                if (message.extract) log(`      片段: ${message.extract}`);
            }
        };
        printGroup('错误：阻断发布', groups.errors, c.red);
        printGroup('警告：需评估，不自动阻断发布', groups.warnings, c.yellow);
        printGroup('CSP 警告：另行核对托管响应头', groups.csp, c.yellow);
        printGroup('信息', groups.info, c.dim);
        if (groups.legacyCss.length) log(`\n  Nu 自带 CSS 引擎另有 ${groups.legacyCss.length} 条诊断；其所在 style 块已通过 Stylelint，采用现代 CSS 校验结果。`);
        if (groups.errors.length) {
            error('\n❌ W3C 页面校验存在错误，请修复后再发布。');
            return 1;
        }
        log('\n✔ HTML / CSS 校验完成，无阻断错误；本检查不代表完整无障碍、视觉或功能合规。');
        return 0;
    } catch (err) {
        error(`\n⚠ W3C 校验未完成: ${err.message}`);
        error('  请检查待校验文件、网络或服务状态后重试；本次不判定页面错误，也不视为校验通过。');
        return 2;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await validateW3c();
}
