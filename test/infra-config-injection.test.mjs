/**
 * 验证首屏共享配置确实由构建注入 dist，且没有残留内联副本或未替换插槽。
 * 运行前 test/run.mjs 会先执行完整构建。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildSync } from 'esbuild';

// 与运行时相同的方式打包配置模块，避免 Node 对无 type 字段的 ESM 重新解析告警。
const { outputFiles } = buildSync({
    stdin: {
        contents: `export * from './src/js/config/backgrounds.js';
            export * from './src/js/config/engines.js';
            export * from './src/js/config/engine-icons.js';
            export * from './src/js/config/weather-icons.js';`,
        resolveDir: process.cwd()
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node'
});
const { PRESET_BACKGROUNDS, ENGINE_META, ENGINE_SVGS, WEATHER_EMOJI_MAP } =
    await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));

const distPath = new URL('../dist/index.html', import.meta.url);
assert.ok(existsSync(distPath), 'dist/index.html 不存在，请先执行 npm run build');
const html = readFileSync(distPath, 'utf8');

for (const background of PRESET_BACKGROUNDS) {
    assert.ok(html.includes(background), `构建产物缺少壁纸 ${background}`);
}

const engineToken = svg => svg.match(/\bid="([^"]+)"/)?.[1] || svg.match(/\bd="(M[\d.]+ [\d.]+)/)?.[1];
for (const key of Object.keys(ENGINE_META)) {
    assert.ok(ENGINE_SVGS[key]?.includes('<svg'), `引擎 ${key} 缺少 SVG 源`);
    const token = engineToken(ENGINE_SVGS[key]);
    assert.ok(token && html.includes(token), `构建产物缺少引擎图标 ${key}`);
}

for (const [emoji, iconPath] of Object.entries(WEATHER_EMOJI_MAP)) {
    assert.ok(html.includes(iconPath), `构建产物缺少天气图标 ${emoji} -> ${iconPath}`);
}

for (const marker of ['INJECT_BACKGROUNDS', 'INJECT_ENGINE_ICONS', 'INJECT_WEATHER_ICONS']) {
    assert.equal(html.includes(marker), false, `构建产物仍残留插槽 ${marker}`);
}

const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
for (const [index, match] of scripts.entries()) {
    if (/type=["']application\/ld\+json["']/i.test(match[0])) continue;
    assert.doesNotThrow(() => new vm.Script(match[1], { filename: `dist-inline-${index}.js` }), `内联脚本 #${index} 语法错误`);
}

console.log('✅ 壁纸、引擎图标与天气图标均由构建注入，无内联副本或残留插槽，内联脚本语法通过');
