import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { parse } from 'acorn';
import { startServer } from './support/server.mjs';
import { launchChrome } from './support/cdp.mjs';
import { getFreePort, createEvaluator, waitFor } from './support/helpers.mjs';

const require = createRequire(import.meta.url);
const { buildAppJavaScript } = require('../scripts/build.cjs');
const built = buildAppJavaScript({ testMode: true });
const productionBuild = buildAppJavaScript();
assert.equal('src/js/testing/bridge.js' in productionBuild.metafile.inputs, false);
assert.equal(Object.keys(productionBuild.metafile.inputs).some(path => path.startsWith('node_modules/')), false);
assert.equal('src/js/testing/bridge.js' in built.metafile.inputs, true);
const graph = new Map(Object.entries(built.metafile.inputs).map(([name, value]) => [name,
  value.imports.filter(edge => !edge.external && edge.kind !== 'dynamic-import').map(edge => edge.path)]));
// Include build-only configuration and currently unused modules, so unreachable files cannot bypass the boundary rules.
const sourceGraph = new Map();
for (const relative of readdirSync(new URL('../src/js/', import.meta.url), { recursive: true })) {
  if (!relative.endsWith('.js')) continue;
  const file = `src/js/${relative.replaceAll('\\', '/')}`;
  const tree = parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  const dependencies = new Set();
  const inspect = node => {
    const source = node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration' || node.type === 'ImportExpression' ? node.source : null;
    if (source) {
      assert.ok(typeof source.value === 'string' && source.value.startsWith('.'), `模块必须显式导入本地源码：${file}`);
      dependencies.add(posix.normalize(posix.join(posix.dirname(file), source.value)));
    }
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child.type === 'string') inspect(child);
      }
    }
  };
  inspect(tree);
  sourceGraph.set(file, [...dependencies]);
  graph.set(file, [...dependencies]);
}
// Check dependency direction as well as cycles. Business features must never flow back into core/utils/state.
const allowedLayers = {
  config: new Set(['config']),
  state: new Set(['state', 'config']),
  utils: new Set(['utils', 'config', 'core']),
  core: new Set(['core', 'utils', 'config', 'state']),
  modules: new Set(['modules', 'core', 'utils', 'config', 'state']),
  testing: new Set(['testing', 'app', 'modules', 'core', 'utils', 'config', 'state']),
  app: new Set(['app', 'modules', 'core', 'utils', 'config', 'state'])
};
const layerOf = file => {
  const relative = file.replaceAll('\\', '/').replace(/^src\/js\//, '');
  return relative.includes('/') ? relative.split('/')[0] : 'app';
};
for (const [file, dependencies] of sourceGraph) {
  const layer = layerOf(file);
  assert.ok(allowedLayers[layer], `未登记的源码层：${file}`);
  for (const dependency of dependencies) {
    if (!dependency.startsWith('src/js/')) {
      assert.equal(file === 'src/js/config/constants.js' && dependency === 'bookmarks.json', true,
        `业务数据只能由配置入口载入：${file} → ${dependency}`);
      continue;
    }
    // Localized config and bookmark normalization share i18n; no other core dependency is needed here.
    const localeDependency = dependency === 'src/js/core/i18n.js';
    // main.js contains the guarded test entry; productionBuild above proves it is removed from production.
    const testEntry = file === 'src/js/main.js' && dependency === 'src/js/testing/bridge.js';
    const allowed = allowedLayers[layer].has(layerOf(dependency)) || (layer === 'config' && localeDependency) || testEntry;
    assert.ok(allowed && (layer !== 'utils' || layerOf(dependency) !== 'core' || localeDependency),
      `模块依赖越界：${file} → ${dependency}`);
  }
}
console.log('✅ 模块依赖方向符合分层约束，通用层不反向依赖业务或应用装配');
const visited = new Set(), active = new Set();
function visit(name, path = []) {
  assert.equal(active.has(name), false, [...path, name].join(' → '));
  if (visited.has(name)) return;
  active.add(name);
  for (const next of graph.get(name) || []) visit(next, [...path, name]);
  active.delete(name); visited.add(name);
}
for (const name of graph.keys()) visit(name);
console.log('✅ 应用及测试适配模块的静态导入图无循环依赖');

const server = await startServer();
const productionServer = await startServer(0, undefined, {}, { testMode: false });
let chrome;
const exceptions = [];
const connect = async testMode => {
  chrome = await launchChrome({port:await getFreePort(), url:`http://127.0.0.1:${testMode ? server.port : productionServer.port}/`, testMode});
  chrome.send('Runtime.exceptionThrown', event => exceptions.push(event.exceptionDetails));
  return createEvaluator(chrome.send);
};
try {
  let evalJS = await connect(false);
  await waitFor(evalJS, '!!document.querySelector(".bookmark-item")');
  const production = await evalJS(`({private:['__GLASS_DIAG__','state','modalState','pageData','CONFIG','dom','collectEditData','bindEditEvents','isFetchingWeather','showConfirm'].every(key => !(key in window)), clock:!!document.getElementById('clock').textContent.trim()})`);
  assert.equal(production.private && production.clock, true, JSON.stringify(production));
  await evalJS("document.getElementById('editBookmarksBtn').click()");
  await waitFor(evalJS, "document.getElementById('editModal').classList.contains('active') && document.getElementById('editModal').contains(document.activeElement)");
  await evalJS("document.getElementById('addBookmarkBtn').click()");
  assert.equal(await evalJS("document.querySelector('#editList .edit-row-card:last-child .edit-name') === document.activeElement"), true);
  await chrome.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await chrome.send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await waitFor(evalJS, "!document.getElementById('editModal').classList.contains('active') && !document.getElementById('startSection').inert");
  await evalJS("document.getElementById('engineBtn').click()");
  await waitFor(evalJS, "document.getElementById('dropdownMenu').classList.contains('active')");
  assert.deepEqual(exceptions, []);
  console.log('✅ 未启用测试接口的生产页面可正常启动、编辑及操作搜索引擎，业务不依赖 window 接口');
  await chrome.send('Page.enable');
  await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__GLASS_TEST__ = true;' });
  await chrome.send('Page.reload');
  await waitFor(evalJS, 'window.__GLASS_TEST__ === true && !!document.querySelector(".bookmark-item")');
  assert.equal(await evalJS("['__GLASS_DIAG__','state','modalState','fetchSuggestions','collectEditData'].every(key => !(key in window))"), true);
  console.log('✅ 生产依赖图不含测试适配层，外部设置测试标记也不挂载接口');
  await chrome.close();
  evalJS = await connect(true);
  await waitFor(evalJS, 'typeof fetchSuggestions === "function"');
  const adapter = await evalJS(`(() => {
    const getters = ['suggestionScriptTag','suggestDebounceTimer','selectedSuggestionIdx','activeSuggestReqId','isFetchingWeather'].every(name => {
      const descriptor = Object.getOwnPropertyDescriptor(window,name);
      return typeof descriptor.get === 'function' && descriptor.set === undefined;
    });
    const append = document.body.appendChild;
    document.body.appendChild = function(node) { if(node.tagName === 'SCRIPT') node.type = 'application/x-test'; return append.call(this,node); };
    try {
      fetchSuggestions('bing', 'boundary-proof');
      const updated = suggestionScriptTag instanceof HTMLScriptElement;
      hideSuggestions();
      dom.date.textContent = 'stale date'; updateClock();
      return {getters, updated, cleared:suggestionScriptTag === null, date:dom.date.textContent !== 'stale date'};
    } finally { document.body.appendChild = append; }
  })()`);
  assert.equal(Object.values(adapter).every(Boolean), true, JSON.stringify(adapter));
  const clockRestored = await evalJS(`(() => {
    const NativeDate = Date;
    let now = new NativeDate(2026, 9, 15, 12, 34).getTime();
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    };
    try {
      updateClock();
      const previous = dom.date.textContent;
      now = new NativeDate(2026, 10, 15, 12, 34).getTime();
      dom.clock.textContent = 'stale time';
      updateClock();
      return dom.date.textContent !== previous && dom.clock.textContent === '12:34'
        && dom.clock.getAttribute('datetime') === '12:34';
    } finally { window.Date = NativeDate; updateClock(); }
  })()`);
  assert.equal(clockRestored, true, '跨月同日及同分钟唤醒应恢复时间和日期，无须修改私有缓存');
  console.log('✅ 测试适配层内部状态通过只读实时访问器读取，搜索完成／取消与日期更新不读取旧快照');
} finally {
  if (chrome) await chrome.close();
  await server.close();
  await productionServer.close();
}
