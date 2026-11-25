import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { parse } from 'acorn';
import { startServer } from './support/server.mjs';
import { launchChrome } from './support/cdp.mjs';
import { addNewDocumentScript, createEvaluator, waitFor, withJsonpStub } from './support/helpers.mjs';

test('静态模块边界与依赖无环检查', async t => {
const require = createRequire(import.meta.url);
const { buildAppJavaScript } = require('../scripts/build.cjs');
const built = buildAppJavaScript({ testMode: true });
const productionBuild = buildAppJavaScript();
const graph = new Map(Object.entries(built.metafile.inputs).map(([name, value]) => [name,
  value.imports.filter(edge => !edge.external && edge.kind !== 'dynamic-import').map(edge => edge.path)]));
// Include build-only configuration and currently unused modules, so unreachable files cannot bypass the boundary rules.
const sourceGraph = new Map();
const jsFiles = [
  ...readdirSync(new URL('../src/js/', import.meta.url), { encoding: 'utf8', recursive: true })
    .filter(relative => relative.endsWith('.js'))
    .map(relative => `src/js/${relative.replaceAll('\\', '/')}`),
  'sw.js'
];

await t.test('生产构建剥离测试入口且零第三方运行时依赖', () => {
  assert.equal('src/js/testing/bridge.js' in productionBuild.metafile.inputs, false);
  assert.equal(Object.keys(productionBuild.metafile.inputs).some(path => path.startsWith('node_modules/')), false);
  assert.equal('src/js/testing/bridge.js' in built.metafile.inputs, true);
});

await t.test('AST 扫描：禁止转发存根与 __GLASS_TEST__ 泄漏且依赖分层合规', () => {
  for (const file of jsFiles) {
    const tree = parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
    const dependencies = new Set();
    const allowForwarding = file === 'src/js/config/engine-head.js';
    const allowTestFlag = file === 'src/js/main.js' || file === 'src/js/testing/bridge.js';
    const inspect = node => {
      if (!allowForwarding && ((node.type === 'ExportNamedDeclaration' && node.source) || node.type === 'ExportAllDeclaration')) {
        assert.fail(`禁止保留跨文件转发出口（AGENTS.md）：${file}`);
      }
      if (!allowTestFlag && node.type === 'Identifier' && node.name === '__GLASS_TEST__') {
        assert.fail(`禁止在生产模块中引用 __GLASS_TEST__：${file}`);
      }
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
    if (file === 'sw.js') continue;
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
});

await t.test('静态导入图无循环依赖', () => {
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
});
});

test('生产环境与测试桥接运行时边界检查', async t => {
let server, productionServer, chrome;
t.after(async () => {
  await chrome?.close().catch(() => {});
  await productionServer?.close().catch(() => {});
  await server?.close().catch(() => {});
});
const exceptions = [];
const connect = async testMode => {
  chrome = await launchChrome({url:`http://127.0.0.1:${testMode ? server.port : productionServer.port}/`, testMode});
  chrome.send('Runtime.exceptionThrown', event => exceptions.push(event.exceptionDetails));
  return createEvaluator(chrome.send);
};
server = await startServer();
productionServer = await startServer(0, undefined, {}, { testMode: false });

await t.test('生产页面无测试全局变量且完整编辑与搜索UI可用', async () => {
  const evalJS = await connect(false);
  await waitFor(evalJS, '!!document.querySelector(".bookmark-item")');
  const production = await evalJS(`({private:['__GLASS_DIAG__','state','modalState','pageData','CONFIG','dom','collectEditData','bindEditEvents','isFetchingWeather','showConfirm'].every(key => !(key in window)), clock:!!document.getElementById('clock').textContent.trim()})`);
  assert.equal(production.private && production.clock, true, JSON.stringify(production));
  await evalJS("document.getElementById('editBookmarksBtn').click()");
  await waitFor(evalJS, "document.getElementById('editModal').open && document.getElementById('editModal').contains(document.activeElement)");
  await evalJS("document.getElementById('addBookmarkBtn').click()");
  assert.equal(await evalJS("document.querySelector('#editList .edit-row-card:last-child .edit-name') === document.activeElement"), true);
  await evalJS("document.querySelector('#editList .edit-row-card:last-child .del-btn').focus()");
  await chrome.send('Input.dispatchKeyEvent', {type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32,text:' '});
  await chrome.send('Input.dispatchKeyEvent', {type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await waitFor(evalJS, `(() => {
    const row = document.querySelector('#editList .edit-row-card:last-child');
    return row.querySelector('.edit-name').value && row.querySelector('.del-btn') === document.activeElement;
  })()`);
  await chrome.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await chrome.send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await waitFor(evalJS, "!document.getElementById('editModal').open && !document.getElementById('startSection').inert");
  await evalJS("document.getElementById('engineBtn').click()");
  await waitFor(evalJS, "document.getElementById('dropdownMenu').classList.contains('active')");
  assert.deepEqual(exceptions, []);
  console.log('✅ 未启用测试接口的生产页面可正常启动、编辑及操作搜索引擎，业务不依赖 window 接口');
});

await t.test('生产页面外部强设 __GLASS_TEST__ 也不挂载桥接接口', async () => {
  const evalJS = createEvaluator(chrome.send);
  await chrome.send('Page.enable');
  const removeFlagScript = await addNewDocumentScript(chrome.send, 'window.__GLASS_TEST__ = true;');
  const removeStorageScript = await addNewDocumentScript(chrome.send, `
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage denied', 'SecurityError'); } });
  `);
  try {
    await chrome.send('Page.reload');
    await waitFor(evalJS, 'window.__GLASS_TEST__ === true && !!document.querySelector(".bookmark-item")');
    assert.equal(await evalJS("['__GLASS_DIAG__','state','modalState','fetchSuggestions','collectEditData'].every(key => !(key in window))"), true);
    assert.equal(await evalJS("document.querySelectorAll('#engineIcon svg, #dropdownMenu svg').length"), 4);
    console.log('✅ 生产依赖图不含测试适配层，外部设置测试标记也不挂载接口');
  } finally {
    await removeStorageScript();
    await removeFlagScript();
  }
  await chrome.close();
});

await t.test('测试桥接只读实时访问器与跨月日期唤醒校验', async () => {
  const evalJS = await connect(true);
  await waitFor(evalJS, 'typeof fetchSuggestions === "function"');
  const adapter = await evalJS(withJsonpStub(`
    const getters = ['selectedSuggestionIdx','activeSuggestReqId','isFetchingWeather'].every(name => {
      const descriptor = Object.getOwnPropertyDescriptor(window,name);
      return typeof descriptor.get === 'function' && descriptor.set === undefined;
    });
    fetchSuggestions('bing', 'boundary-proof');
    const updated = document.body.querySelector('script[src*="__glassSuggestCb_"]') instanceof HTMLScriptElement;
    hideSuggestions();
    dom.date.textContent = 'stale date'; updateClock();
    return {getters, updated, cleared:document.body.querySelector('script[src*="__glassSuggestCb_"]') === null, date:dom.date.textContent !== 'stale date'};
  `));
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
});
});
