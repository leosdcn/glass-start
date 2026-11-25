/** 共享单元测试打包与 VM 上下文执行辅助。 */
import vm from 'node:vm';
import { build } from 'esbuild';

/**
 * 将一组源码入口打包为可在 node:vm 中执行的 CJS 产物文本。
 * @param {string} contents
 * @param {(builder: import('esbuild').PluginBuild) => void} [setupPlugins]
 * @returns {Promise<string>}
 */
export async function buildUnitBundle(contents, setupPlugins) {
    const plugins = setupPlugins ? [{ name: 'unit-test-boundaries', setup: setupPlugins }] : [];
    const { outputFiles } = await build({
        stdin: { contents, resolveDir: process.cwd() },
        bundle: true,
        write: false,
        format: 'cjs',
        platform: 'node',
        plugins
    });
    return outputFiles[0].text;
}

/**
 * 在隔离 VM 上下文中执行已打包单元代码并返回其 module.exports。
 * @param {string} bundleText
 * @param {Record<string, any>} globals
 */
export function runUnitBundle(bundleText, globals) {
    const context = vm.createContext({ module: { exports: {} }, ...globals });
    vm.runInContext(bundleText, context);
    return { context, app: context.module.exports };
}
