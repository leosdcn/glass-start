import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { launchSession, waitFor } from './support/helpers.mjs';

// 执行真实产物的天气内联脚本，在应用尚未运行时检查首帧结果。
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .find(match => match[1].includes('glass_weather_cache'))?.[1];
assert.ok(script, '生产页面必须包含天气预渲染脚本');
const { server, chrome, evalJS } = await launchSession();
try {
    await waitFor(evalJS, 'typeof renderWeatherCapsule === "function"');
    const cases = [
        [23, '23°'], ['23.6', '24°'], [-4.6, '-5°'], [0, '0°'],
        [null, '0°'], [undefined, '0°'], ['', '0°'], ['  ', '0°'],
        [true, '0°'], ['NaN', '0°'], ['Infinity', '0°'],
        ['<img src=x onerror=alert(1)>', '0°'], [[], '0°'], [[25], '0°'], [{}, '0°']
    ];
    for (const [value, expected] of cases) {
        const data = { current: { temp: value, icon: '🌤️', weatherText: '晴' }, location: { name: '上海' } };
        const nodes = Object.fromEntries(['weatherWidget', 'weatherIcon', 'weatherTemp', 'weatherCity', 'weatherBtn']
            .map(id => [id, { textContent: '', style: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }]));
        vm.runInNewContext(script, {
            document: { getElementById: id => nodes[id] },
            localStorage: { getItem: key => key === 'glass_weather_cache' ? JSON.stringify(data) : '{}' }
        });
        assert.equal(nodes.weatherTemp.textContent, expected);
        const runtime = await evalJS(`(() => {
            renderWeatherCapsule(${JSON.stringify(data)});
            return {temp:dom.weatherTemp.textContent, label:dom.weatherBtn.getAttribute('aria-label')};
        })()`);
        assert.equal(runtime.temp, expected);
        assert.equal(runtime.label, nodes.weatherBtn.attributes['aria-label']);
    }
    console.log('✅ 天气首帧与运行时统一清洗，数字、数值字符串及损坏温度的文本和无障碍标签一致');
} finally {
    await chrome.close();
    await server.close();
}
