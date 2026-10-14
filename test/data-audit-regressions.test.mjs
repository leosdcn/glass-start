import assert from 'node:assert/strict';
import { launchSession, waitFor } from './helpers.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
const { server, chrome, send, evalJS } = await launchSession(0, {
  '/audit-slow.png': (req, res) => setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.end(png);
  }, 350),
  '/audit-broken.png': (req, res) => setTimeout(() => {
    res.writeHead(404); res.end('missing');
  }, 350)
});

try {
  await waitFor(evalJS, 'typeof openEditModal === "function"');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const storage = await evalJS(`(() => {
    const key = 'audit-storage';
    storageRemove(key);
    const missing = [storageGet(key, null), storageGet(key, 42)];
    storageSet(key, 1); localStorage.setItem(key, '2');
    const external = storageGet(key);
    localStorage.setItem(key, '{broken');
    const corrupt = storageGet(key, 7);
    storageRemove(key);
    return {missing, external, corrupt};
  })()`);
  assert.deepEqual(storage, {missing:[null, 42], external:2, corrupt:7});
  await assert.rejects(() => evalJS('throw new Error("audit-page-error")'), /audit-page-error/);
  console.log('✅ 配置读取使用本次默认值并看到外部写入，损坏 JSON 回退；页面求值异常直接报告');

  const activation = await evalJS(`(() => {
    const append=document.body.appendChild, open=window.open; let opened='';
    document.body.appendChild=function(node){if(node.tagName==='SCRIPT')node.type='application/x-audit';return append.call(this,node)};
    window.open=url=>{opened=url};
    try {
      dom.searchInput.value='audit-unmatched-query'; dom.searchInput.focus();
      fetchSuggestions('bing','audit-unmatched-query');
      window['__glassSuggestCb_'+activeSuggestReqId](['query',['first-result','second-result']]);
      const item=dom.suggestionMenu.querySelector('[data-idx="1"]');
      item.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
      const selected=selectedSuggestionIdx;
      item.dataset.suggestion='tampered-result';
      dom.searchInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));
      return {selected, usesModel:opened.includes('second-result')&&!opened.includes('tampered-result')};
    } finally {document.body.appendChild=append;window.open=open;hideSuggestions()}
  })()`);
  assert.deepEqual(activation,{selected:1,usesModel:true});
  console.log('✅ 鼠标与键盘选中状态一致，Enter 使用内存结果，不反向读取 DOM 文本');


  await evalJS(`(async () => {
    await openEditModal();
    window.auditBookmarks = [
      {name:'长'.repeat(80),url:'example.com:8443/path',icon:'javascript:alert(1)',desc:'述'.repeat(80)},
      {name:'危险',url:'javascript:alert(1)'}, {name:'空',url:''}
    ];
    renderEditList(auditBookmarks);
    window.auditCollected = collectEditData();
    const files = new DataTransfer();
    files.items.add(new File([JSON.stringify(auditBookmarks)], 'bookmarks.json', {type:'application/json'}));
    dom.importJsonInput.files = files.files;
    dom.importJsonInput.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
  await waitFor(evalJS, 'OverlayStack.top()?.id === "confirmModal"');
  const bookmarks = await evalJS(`(() => {
    dom.confirmOkBtn.click();
    const imported = collectEditData();
    const original = pageData.bookmarks;
    saveUserBookmarks(imported);
    const persisted = pageData.bookmarks;
    pageData.bookmarks = original; renderBookmarks(); cancelEditModal();
    const result = {edited:auditCollected, imported, persisted};
    delete window.auditBookmarks; delete window.auditCollected;
    return result;
  })()`);
  const clean = [{name:'长'.repeat(60), url:'https://example.com:8443/path', icon:'https://a.favicon.im/example.com', desc:'述'.repeat(40)}];
  assert.deepEqual(bookmarks, {edited:clean, imported:clean, persisted:clean});
  console.log('✅ 导入、草稿收集和持久化统一截断、URL 与图标过滤，保留裸域名端口');

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

  const wikipedia = await evalJS(`(async () => {
    const originalFetch = window.fetch, requests = [];
    // 即使传输层忽略 abort 并迟到返回，旧结果也不能重开或覆盖建议列表。
    window.fetch = (url, options) => String(url).includes('zh.wikipedia.org/w/api.php')
      ? new Promise(resolve => requests.push({url, options, resolve}))
      : originalFetch(url, options);
    const drain = () => new Promise(resolve => setTimeout(resolve, 0));
    try {
      fetchSuggestions('wikipedia', 'old'); fetchSuggestions('wikipedia', 'new');
      const aborted = requests[0].options.signal.aborted;
      requests[0].resolve({ok:true, json:async () => ['old', ['stale-result']]});
      await drain();
      const staleAbsent = !dom.suggestionMenu.textContent.includes('stale-result');
      requests[1].resolve({ok:true, json:async () => ['new', ['current-result']]});
      await drain();
      const current = dom.suggestionMenu.textContent.includes('current-result');
      fetchSuggestions('wikipedia', 'cancel'); hideSuggestions();
      requests[2].resolve({ok:true, json:async () => ['cancel', ['cancelled-result']]});
      await drain();
      const cancelled = requests[2].options.signal.aborted && !dom.suggestionMenu.classList.contains('active');
      fetchSuggestions('wikipedia', 'GitHub'); requests[3].resolve({ok:false});
      await drain();
      const fallback = dom.suggestionMenu.textContent.includes('GitHub');
      return {aborted, staleAbsent, current, cancelled, fallback,
        cors:requests.every(request => new URL(request.url).searchParams.get('origin') === '*' && request.options.credentials === 'omit'),
        noJsonp:!document.querySelector('script[src*="w/api.php"]')};
    } finally { hideSuggestions(); window.fetch = originalFetch; }
  })()`);
  assert.equal(Object.values(wikipedia).every(Boolean), true, JSON.stringify(wikipedia));
  console.log('✅ Wikipedia CORS 建议正常返回、替换及关闭取消、迟到响应隔离与 HTTP 错误本地回退');

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
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await waitFor(evalJS, 'matchMedia("(any-pointer: coarse)").matches');
  await evalJS('openEditModal()');
  await waitFor(evalJS, 'dom.editModal.classList.contains("active")');
  const inputFonts = await evalJS("({name:getComputedStyle(dom.editList.querySelector('.edit-name')).fontSize, url:getComputedStyle(dom.urlBgInput).fontSize})");
  assert.deepEqual(inputFonts, {name:'16px', url:'16px'});
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
