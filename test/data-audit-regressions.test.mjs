import assert from 'node:assert/strict';
import { startServer } from './server.mjs';
import { launchChrome } from './cdp.mjs';
import { getFreePort, waitFor } from './helpers.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
const server = await startServer(0, undefined, {
  '/audit-slow.png': (req, res) => setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.end(png);
  }, 350),
  '/audit-broken.png': (req, res) => setTimeout(() => {
    res.writeHead(404); res.end('missing');
  }, 350)
});
const chrome = await launchChrome({ port: await getFreePort(), url: `http://127.0.0.1:${server.port}/` });
const { send } = chrome;
const evalJS = async expression => {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
  return response.result?.value;
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await waitFor(evalJS, 'typeof openEditModal === "function"');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const empty = await evalJS(`(async () => {
    await openEditModal();
    const originalCount = pageData.bookmarks.length;
    dom.editList.querySelectorAll('.del-btn').forEach(button => button.click());
    dom.saveEditBtn.click();
    const result = { count: collectEditData().length, existing: getExistingUrls().size,
      counter: dom.bookmarkCountBadge.textContent, blocked: state.editOpen && OverlayStack.top()?.id === 'confirmModal',
      unchanged: pageData.bookmarks.length === originalCount };
    dom.confirmOkBtn.click();
    const create = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
    let exported;
    URL.createObjectURL = blob => { exported = blob; return create(blob); };
    HTMLAnchorElement.prototype.click = function() {};
    try { exportBookmarksJSON(); result.exportCount = JSON.parse(await exported.text()).bookmarks.length; }
    finally { URL.createObjectURL = create; HTMLAnchorElement.prototype.click = click; }
    renderEditList();
    result.renderCount = modalState.draftBookmarks.length;
    cancelEditModal();
    return result;
  })()`);
  assert.deepEqual(empty, { count: 0, existing: 0, counter: '已添加 0 项', blocked: true, unchanged: true, exportCount: 0, renderCount: 0 });
  console.log('✅ 空草稿保持为空，保存明确阻止，导出和选择器不恢复旧数据');

  const keyboard = await evalJS(`(async () => {
    await openEditModal();
    renderEditList(['A','B','C'].map(name => ({name, url: 'https://' + name.toLowerCase() + '.example.com'})));
    const handle = dom.editList.querySelector('.drag-handle');
    handle.focus();
    const move = (key, target = handle) => target.dispatchEvent(new KeyboardEvent('keydown', {key, altKey:true, bubbles:true, cancelable:true}));
    move('ArrowDown');
    const order = collectEditData().map(b => b.name);
    const domOrder = [...dom.editList.querySelectorAll('.edit-name')].map(input => input.value);
    const focus = document.activeElement === handle;
    const announcement = dom.editList.querySelector('.bookmark-sort-status').textContent;
    move('ArrowDown', dom.editList.querySelector('.edit-name'));
    const inputUnchanged = collectEditData().map(b => b.name).join() === order.join();
    move('ArrowUp'); move('ArrowUp');
    const boundaryOrder = collectEditData().map(b => b.name);
    cancelEditModal();
    return { order, domOrder, focus, announcement, inputUnchanged, boundaryOrder };
  })()`);
  assert.deepEqual(keyboard.order, ['B','A','C']);
  assert.deepEqual(keyboard.domOrder, keyboard.order);
  assert.equal(keyboard.focus && keyboard.inputUnchanged, true);
  assert.match(keyboard.announcement, /A 已移至第 2 项/);
  assert.deepEqual(keyboard.boundaryOrder, ['A','B','C']);
  console.log('✅ Alt+方向键排序同步草稿与 DOM，保留焦点并公告位置，边界和输入框不误排');

  const jsonp = await evalJS(`(() => {
    const append = document.body.appendChild;
    document.body.appendChild = function(node) { if (node.tagName === 'SCRIPT') node.type = 'application/x-audit'; return append.call(this, node); };
    try {
      fetchSuggestions('bing', 'old');
      const oldKey = '__glassSuggestCb_' + activeSuggestReqId, oldCallback = window[oldKey];
      const oldError = document.querySelector('script[src*="query=old"]').onerror;
      fetchSuggestions('bing', 'new');
      const newKey = '__glassSuggestCb_' + activeSuggestReqId;
      const node = document.querySelector('script[src*="query=new"]');
      oldCallback(['old', ['stale']]); oldError();
      const preserved = node.isConnected && typeof window[newKey] === 'function';
      window[newKey](['new', ['current-result']]);
      const current = dom.suggestionMenu.textContent.includes('current-result');
      fetchSuggestions('bing', 'cancelled');
      const cancelledKey = '__glassSuggestCb_' + activeSuggestReqId;
      hideSuggestions();
      return {preserved, current, released: !window[oldKey] && !window[newKey] && !window[cancelledKey]};
    } finally { document.body.appendChild = append; }
  })()`);
  assert.deepEqual(jsonp, { preserved: true, current: true, released: true });
  console.log('✅ 旧 JSONP 回调/错误不影响新请求，完成和取消均释放回调');

  await evalJS(`previewDraftWallpaper(location.origin + '/audit-slow.png'); previewDraftWallpaper(backgrounds[2]);`);
  await waitFor(evalJS, 'state.bg === 2 && !state.customWallpaper');
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal(await evalJS('state.bg === 2 && !state.customWallpaper && modalState.draftWallpaper === backgrounds[2]'), true);
  await evalJS(`previewDraftWallpaper(location.origin + '/audit-broken.png'); resetDraftWallpaper();`);
  await waitFor(evalJS, 'state.bg === 0 && !state.customWallpaper');
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal(await evalJS("OverlayStack.top()?.id !== 'confirmModal' && !state.customWallpaper"), true);
  console.log('✅ 真实慢图片和旧图片错误不覆盖新选择或重置，不弹过期提示');

  await send('Emulation.setDeviceMetricsOverride', { width: 820, height: 1180, deviceScaleFactor: 1, mobile: true });
  await evalJS('openEditModal()');
  assert.equal(await evalJS("getComputedStyle(dom.editList.querySelector('.edit-name')).fontSize === '16px' && getComputedStyle(dom.urlBgInput).fontSize === '16px'"), true);
  await evalJS('cancelEditModal()');
  console.log('✅ 820px 视口书签和网络壁纸单行输入均为 16px');

  await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__AUDIT_RELOAD__=true;localStorage.setItem('glass_weather_cache',JSON.stringify({timestamp:Date.now(),current:{temp:20},daily:[null]}));" });
  await send('Page.reload');
  await waitFor(evalJS, "window.__AUDIT_RELOAD__ && typeof state !== 'undefined' && document.getElementById('bookmarks').children.length > 0");
  await evalJS('dom.editBookmarksBtn.click()');
  await waitFor(evalJS, 'state.editOpen && dom.editModal.classList.contains("active")');
  assert.equal(await evalJS("__GLASS_DIAG__.dump().every(entry => entry.ev !== 'js-error')"), true);
  console.log('✅ 损坏天气缓存刷新后书签正常渲染、设置可打开，无未捕获异常');
} finally {
  await chrome.close();
  await server.close();
}
