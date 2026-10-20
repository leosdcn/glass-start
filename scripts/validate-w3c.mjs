/** W3C 在线校验：退出码 0 无阻断错误，1 页面错误，2 校验未完成。 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { c, HR_DOUBLE } from './terminal.cjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 保留现有、明确列举的现代 CSS 兼容性例外，单列展示，不扩展为忽略全部 CSS 错误。
const cssCompatibilityMessages = [
    'CSS: Unrecognized at-rule “@property”',
    'CSS: “margin-trim”',
    'CSS: “transition-property”: “--tw-',
    'CSS: “line-clamp”'
];

export async function validateW3c({ rootDir = root, fetchImpl = fetch, log = console.log, error = console.error } = {}) {
    log(`\n${c.cyan}${HR_DOUBLE}${c.reset}`);
    log(`${c.bold}${c.cyan}🌐 Glass Start — W3C Nu HTML 校验${c.reset}`);
    log(`${c.cyan}${HR_DOUBLE}${c.reset}\n`);

    try {
        const targetName = existsSync(join(rootDir, 'dist', 'index.html')) ? 'dist/index.html' : 'src/index.html';
        const rawHtml = readFileSync(join(rootDir, targetName), 'utf-8');
        const { version } = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
        log(`  正在校验 ${targetName}，连接 W3C 在线验证 API...`);
        const startTime = Date.now();
        const res = await fetchImpl('https://validator.w3.org/nu/?out=json', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'User-Agent': `Glass-Start-W3C-Auditor/${version} (Node.js)`
            },
            body: rawHtml,
            signal: AbortSignal.timeout(30000)
        });
        if (!res.ok) throw new Error(`W3C 服务响应异常: HTTP ${res.status} ${res.statusText}`);
        const data = await res.json();
        if (!Array.isArray(data?.messages) || data.messages.some(message =>
            !message || typeof message.message !== 'string' || !['error', 'info'].includes(message.type))) {
            throw new Error('W3C 响应缺少有效消息列表，或包含校验器自身异常');
        }

        const groups = { errors: [], warnings: [], csp: [], info: [], compatibility: [] };
        for (const message of data.messages) {
            if (cssCompatibilityMessages.some(text => message.message.includes(text))) groups.compatibility.push(message);
            else if (message.type === 'error') groups.errors.push(message);
            else if (message.subType === 'warning') {
                (message.message.includes('Content Security Policy') ? groups.csp : groups.warnings).push(message);
            } else groups.info.push(message);
        }

        log(`\n─── 校验结果 (${Date.now() - startTime}ms)：${groups.errors.length} 个错误、${groups.warnings.length + groups.csp.length} 个警告 ───`);
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
        printGroup('已知现代 CSS 兼容性例外：不阻断发布', groups.compatibility, c.dim);
        if (groups.errors.length) {
            error('\n❌ W3C 页面校验存在错误，请修复后再发布。');
            return 1;
        }
        log('\n✔ W3C 校验完成，无阻断错误；本检查不代表完整无障碍、视觉或功能合规。');
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
