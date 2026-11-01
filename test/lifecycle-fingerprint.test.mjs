/** 指纹裁决只依赖会话存储，无须启动浏览器。实际升级由 infra-sw-upgrade 覆盖。 */
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import vm from 'node:vm';

const { outputFiles } = buildSync({ entryPoints: ['src/js/core/lifecycle.js'],
  bundle: true, write: false, format: 'cjs', platform: 'node' });
const storage = new Map();
const context = vm.createContext({ module: { exports: {} }, sessionStorage: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value)
} });
vm.runInContext(outputFiles[0].text, context);
const { verifyFingerprint } = context.module.exports;
const verdict = (html, app) => JSON.parse(JSON.stringify(verifyFingerprint(html, app)));

assert.deepEqual(verdict('app-core-v100', 'app-core-v100'), { mismatch: false, mayReload: false });
assert.deepEqual(verdict('app-core-v200', 'app-core-v999'), { mismatch: true, mayReload: true });
assert.ok(Number(storage.get('gs_build_reload_at')) > 0);
assert.deepEqual(verdict('app-core-v200', 'app-core-v999'), { mismatch: true, mayReload: false });
assert.deepEqual(verdict(null, null), { mismatch: false, mayReload: false });
assert.deepEqual(verdict('only-html', null), { mismatch: false, mayReload: false });
console.log('✅ 同版放行、跨版刷新许可、冷却期及缺省指纹跳过，均执行真实指纹函数');
