import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer } from './server.mjs';
import { launchChrome } from './cdp.mjs';
import { getFreePort, createEvaluator, waitFor } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { buildAppJavaScript } = require('../scripts/build.js');
const built = buildAppJavaScript({ testMode: true });
const productionBuild = buildAppJavaScript();
assert.equal('src/js/testing/bridge.js' in productionBuild.metafile.inputs, false);
assert.equal(Object.keys(productionBuild.metafile.inputs).some(path => /node_modules\/(?:acorn|postcss)\//.test(path)), false);
assert.equal('src/js/testing/bridge.js' in built.metafile.inputs, true);
const graph = new Map(Object.entries(built.metafile.inputs).map(([name, value]) => [name,
  value.imports.filter(edge => !edge.external && edge.kind !== 'dynamic-import').map(edge => edge.path)]));
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
const connect = async testMode => {
  chrome = await launchChrome({port:await getFreePort(), url:`http://127.0.0.1:${testMode ? server.port : productionServer.port}/`, testMode});
  return createEvaluator(chrome.send);
};
try {
  let evalJS = await connect(false);
  await waitFor(evalJS, '!!window.__GLASS_DIAG__ && !!document.querySelector(".bookmark-item")');
  const production = await evalJS(`({private:['state','modalState','pageData','CONFIG','dom','collectEditData','bindEditEvents','isFetchingWeather','lastDateDay','showConfirm'].every(key => !(key in window)), clock:!!document.getElementById('clock').textContent.trim()})`);
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
  assert.equal(await evalJS("__GLASS_DIAG__.dump().every(entry => entry.ev !== 'js-error' && entry.ev !== 'unhandled-rejection')"), true);
  console.log('✅ 未启用测试接口的生产页面可正常启动、编辑及操作搜索引擎，业务不依赖 window 接口');
  await chrome.send('Page.enable');
  await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__GLASS_TEST__ = true;' });
  await chrome.send('Page.reload');
  await waitFor(evalJS, 'window.__GLASS_TEST__ === true && !!document.querySelector(".bookmark-item")');
  assert.equal(await evalJS("['state','modalState','fetchSuggestions','collectEditData'].every(key => !(key in window))"), true);
  console.log('✅ 生产依赖图不含测试适配层，外部设置测试标记也不挂载接口');
  await chrome.close();
  evalJS = await connect(true);
  await waitFor(evalJS, 'typeof fetchSuggestions === "function"');
  const adapter = await evalJS(`(() => {
    const getters = ['suggestionScriptTag','suggestDebounceTimer','isFetchingWeather','lastDateDay'].every(name => typeof Object.getOwnPropertyDescriptor(window,name).get === 'function');
    const append = document.body.appendChild;
    document.body.appendChild = function(node) { if(node.tagName === 'SCRIPT') node.type = 'application/x-test'; return append.call(this,node); };
    try {
      fetchSuggestions('bing', 'boundary-proof');
      const updated = suggestionScriptTag instanceof HTMLScriptElement;
      hideSuggestions();
      lastDateDay = -1; updateClock();
      return {getters, updated, cleared:suggestionScriptTag === null, date:lastDateDay === new Date().getDate()};
    } finally { document.body.appendChild = append; }
  })()`);
  assert.equal(Object.values(adapter).every(Boolean), true, JSON.stringify(adapter));
  console.log('✅ 测试适配层可变状态通过实时访问器读取，搜索完成／取消与日期更新不读取旧快照');
} finally {
  if (chrome) await chrome.close();
  await server.close();
  await productionServer.close();
}
