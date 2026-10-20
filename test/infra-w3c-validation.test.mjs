import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateW3c } from '../scripts/validate-w3c.mjs';

async function check(messages, options = {}) {
    const output = [];
    const code = await validateW3c({
        fetchImpl: async (url, request) => {
            assert.equal(url, 'https://validator.w3.org/nu/?out=json');
            assert.equal(request.method, 'POST');
            assert.match(request.body, /<!doctype html>/i);
            assert.ok(request.signal instanceof AbortSignal);
            return { ok: true, json: async () => ({ messages }) };
        },
        ...options,
        log: message => output.push(message), error: message => output.push(message)
    });
    return { code, text: output.join('\n') };
}
assert.equal((await check([])).code, 0);
const warnings = await check([
    { type: 'info', subType: 'warning', message: 'Heading warning' },
    { type: 'info', subType: 'warning', message: 'Content Security Policy warning' },
    { type: 'info', message: 'Informational message' },
    { type: 'error', message: 'CSS: Unrecognized at-rule “@property”' }
]);
assert.equal(warnings.code, 0, warnings.text);
for (const text of ['警告：需评估', 'CSP 警告', '信息', '现代 CSS 兼容性例外']) assert.ok(warnings.text.includes(text));
const errors = await check([
    { type: 'error', message: 'Invalid HTML attribute', lastLine: 12, firstColumn: 3, extract: '<bad>' },
    { type: 'error', message: 'CSS: Invalid color value' },
    { type: 'info', subType: 'warning', message: 'Heading warning' }
]);
assert.equal(errors.code, 1);
assert.match(errors.text, /2 个错误、1 个警告/);
assert.match(errors.text, /Line 12, Col 3/);

for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async () => { throw new DOMException('timeout', 'TimeoutError'); },
    async () => ({ ok: false, status: 503, statusText: 'Unavailable' }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } }),
    async () => ({ ok: true, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => ({ messages: [{ type: 'non-document-error', message: 'Validator failed' }] }) })
]) {
    const failed = await check([], { fetchImpl });
    assert.equal(failed.code, 2, failed.text);
    assert.match(failed.text, /校验未完成/);
    assert.equal(failed.text.includes('W3C 页面校验存在错误'), false);
    assert.equal(failed.text.includes('无阻断错误；'), false);
}
// CLI 必须传递独立退出码，避免自动化把服务故障当作通过或页面错误。
const mock = 'globalThis.fetch = async () => { throw new Error("offline"); };';
const cli = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(mock)}`,
    fileURLToPath(new URL('../scripts/validate-w3c.mjs', import.meta.url))], { encoding: 'utf8' });
assert.equal(cli.status, 2, cli.stdout + cli.stderr);
assert.match(cli.stderr, /校验未完成/);
console.log('✅ W3C 错误阻断、警告分类展示；网络、超时及无效响应均报告校验未完成并返回独立退出码');
