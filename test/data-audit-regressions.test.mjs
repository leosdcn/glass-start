import assert from 'node:assert/strict';
import { test } from 'node:test';
import { launchSession, waitFor } from './support/helpers.mjs';

test('数据容错、搜索联想与网络降级回归', async () => {
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

  const exceptions = [];
  send('Runtime.exceptionThrown', event => exceptions.push(event.exceptionDetails));

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
      return { missing, external, corrupt };
    })()`);
    assert.deepEqual(storage, { missing: [null, 42], external: 2, corrupt: 7 });
    await assert.rejects(() => evalJS('throw new Error("audit-page-error")'), /audit-page-error/);

    const activation = await evalJS(`(() => {
      const append = document.body.appendChild, open = window.open; let opened = '';
      document.body.appendChild = function(node) {
        if (node.tagName === 'SCRIPT') node.type = 'application/x-audit';
        return append.call(this, node);
      };
      window.open = url => { opened = url; };
      try {
        dom.searchInput.value = 'audit-unmatched-query'; dom.searchInput.focus();
        fetchSuggestions('bing', 'audit-unmatched-query');
        window['__glassSuggestCb_' + activeSuggestReqId](['query', ['first-result', 'second-result']]);
        const item = dom.suggestionMenu.querySelector('[data-idx="1"]');
        item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        const selected = selectedSuggestionIdx;
        item.textContent = 'tampered-result';
        dom.searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
        const keyboardUsesModel = opened.includes('second-result') && !opened.includes('tampered-result');
        fetchSuggestions('bing', 'audit-unmatched-query');
        const clickTarget = dom.suggestionMenu.querySelector('[data-idx="1"] span');
        clickTarget.textContent = 'tampered-click';
        opened = '';
        clickTarget.dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true }));
        return { selected, usesModel: keyboardUsesModel && opened.includes('second-result') && !opened.includes('tampered-click') };
      } finally {
        document.body.appendChild = append; window.open = open; hideSuggestions();
      }
    })()`);
    assert.deepEqual(activation, { selected: 1, usesModel: true });

    await evalJS(`previewDraftWallpaper(location.origin + '/audit-slow.png'); previewDraftWallpaper(backgrounds[2]);`);
    await waitFor(evalJS, 'state.bg === 2 && !state.customWallpaper');
    await new Promise(resolve => setTimeout(resolve, 550));
    assert.equal(await evalJS('state.bg === 2 && !state.customWallpaper && modalState.draftWallpaper === backgrounds[2]'), true);
    await evalJS(`previewDraftWallpaper(location.origin + '/audit-broken.png'); resetDraftWallpaper();`);
    await waitFor(evalJS, 'state.bg === 0 && !state.customWallpaper');
    await new Promise(resolve => setTimeout(resolve, 550));
    assert.equal(await evalJS("OverlayStack.top()?.id !== 'confirmModal' && !state.customWallpaper"), true);

    await send('Emulation.setDeviceMetricsOverride', { width: 820, height: 1180, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await waitFor(evalJS, 'matchMedia("(any-pointer: coarse)").matches');
    await evalJS('openEditModal()');
    await waitFor(evalJS, 'document.getElementById("editModal").classList.contains("active")');
    const inputFonts = await evalJS("({name:getComputedStyle(dom.editList.querySelector('.edit-name')).fontSize, url:getComputedStyle(dom.urlBgInput).fontSize})");
    assert.deepEqual(inputFonts, { name: '16px', url: '16px' });
    await evalJS('cancelEditModal()');

    await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__AUDIT_RELOAD__=true;localStorage.setItem('glass_weather_cache',JSON.stringify({timestamp:Date.now(),current:{temp:20},daily:[null]}));" });
    await send('Page.reload');
    await waitFor(evalJS, "window.__AUDIT_RELOAD__ && typeof state !== 'undefined' && document.getElementById('bookmarks').children.length > 0");
    await evalJS('dom.editBookmarksBtn.click()');
    await waitFor(evalJS, 'state.editOpen && document.getElementById("editModal").classList.contains("active")');
    assert.deepEqual(exceptions, []);
  } finally {
    await chrome.close();
    await server.close();
  }
});

test('历史工单缺陷回归 (GS-01 ~ GS-15 焦点、导入、存储配额与手势中断)', async () => {
  const { server, chrome, send, evalJS } = await launchSession();
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

    await evalJS('resetUserBookmarks(); openEditModal()');
    for (const selector of ['.edit-name', '.edit-url']) {
      assert.equal(await evalJS(`(() => {
        const input = dom.editList.querySelector('${selector}'); input.focus();
        window.dispatchEvent(new Event('blur')); handleAppWakeUp();
        return document.activeElement === input;
      })()`), true);
    }
    await evalJS('cancelEditModal()');
    for (const target of ['nav', 'start']) {
      assert.equal(await evalJS(`(() => {
        reconcileScreenState('${target === 'nav' ? 'start' : 'nav'}', true);
        const native = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (this === sessionStorage) throw Error('blocked');
          return native.call(this, key, value);
        };
        try {
          ${target === 'nav' ? 'switchToNav' : 'switchToStart'}();
          handleAppWakeUp();
          return state.currentSection;
        } finally {
          Storage.prototype.setItem = native;
        }
      })()`), target);
    }

    const imports = await evalJS(`(async () => {
      await openEditModal();
      const Native = window.FileReader, readers = [];
      window.FileReader = class { constructor() { readers.push(this); } readAsText() {} };
      const release = (index, name) => readers[index].onload({ target: { result: JSON.stringify([{ name, url: 'https://import.example.test/' }]) } });
      try {
        importBookmarksJSON({}); cancelEditModal(); await openEditModal();
        release(0, '过期');
        const noPrompt = OverlayStack.top()?.id === 'editModal';
        importBookmarksJSON({}); importBookmarksJSON({}); release(1, '旧文件');
        const latestOnly = OverlayStack.top()?.id === 'editModal';
        release(2, '新文件'); dom.confirmOkBtn.click();
        return { noPrompt, latestOnly, name: modalState.draftBookmarks[0].name };
      } finally {
        window.FileReader = Native; cancelEditModal();
      }
    })()`);
    assert.deepEqual(imports, { noPrompt: true, latestOnly: true, name: '新文件' });

    await evalJS(`(async () => {
      storageSet(CONFIG.KEYS.MASK_OPACITY, 20); await openEditModal(); previewDraftMaskOpacity(45);
      window.__nativeSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === CONFIG.KEYS.MASK_OPACITY) throw Error('quota');
        return __nativeSet.call(this, key, value);
      };
      await saveEditModal();
    })()`);
    assert.equal(await evalJS(`state.editOpen && modalState.draftMaskOpacity === 45 && /背景暗度未能保存/.test(dom.confirmMsg.textContent)`), true);
    await evalJS('Storage.prototype.setItem = __nativeSet; dom.confirmOkBtn.click(); saveEditModal()');
    await waitFor(evalJS, '!state.editOpen');
    assert.equal(await evalJS('storageGet(CONFIG.KEYS.MASK_OPACITY)'), 45);

    await evalJS(`(async () => {
      await openEditModal(); window.__nativeRemove = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function(key) {
        if ([CONFIG.KEYS.BOOKMARK_KEYS, CONFIG.KEYS.CUSTOM_META, CONFIG.KEYS.MASK_OPACITY].includes(key)) throw Error('denied');
        return __nativeRemove.call(this, key);
      };
      resetBookmarks(); dom.confirmOkBtn.click();
    })()`);
    await waitFor(evalJS, `OverlayStack.top()?.id === 'confirmModal' && /部分设置未能清除/.test(dom.confirmMsg.textContent)`);
    assert.equal(await evalJS('state.editOpen && modalState.draftMaskOpacity === 45 && dom.maskOpacityInput.value === "45"'), true);
    await evalJS(`Storage.prototype.removeItem = __nativeRemove; dom.confirmOkBtn.click(); setTransitionMode('classic'); resetBookmarks(); dom.confirmOkBtn.click()`);
    await waitFor(evalJS, '!state.editOpen');
    assert.equal(await evalJS(`getTransitionMode() === 'sheet' && document.documentElement.dataset.transitionMode === 'sheet' && !localStorage.getItem(CONFIG.KEYS.TRANSITION_MODE) && document.querySelector('.settings-transition-btn[data-mode="sheet"]').getAttribute('aria-pressed') === 'true'`), true);

    await evalJS(`(async () => { await openEditModal(); await previewDraftWallpaper(backgrounds[1]); })()`);
    const beforePreset = await evalJS('getWallpaperSelectionDB().then(JSON.stringify)');
    await send('Network.enable');
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    assert.equal(await evalJS('previewDraftWallpaper(backgrounds[7])'), false);
    assert.equal(await evalJS('getWallpaperSelectionDB().then(JSON.stringify)'), beforePreset);
    await evalJS('dom.confirmOkBtn.click()');
    assert.equal(await evalJS('previewDraftWallpaper(backgrounds[1])'), true);
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    assert.equal(await evalJS('previewDraftWallpaper(backgrounds[7])'), true);
    await evalJS('cancelEditModal()');

    const upload = await evalJS(`(async () => {
      await openEditModal(); await previewDraftWallpaper(backgrounds[1]);
      const before = JSON.stringify(await getWallpaperSelectionDB());
      uploadWallpaper(new File(['broken-image'], 'broken.png', { type: 'image/png' }));
      await flushWallpaperSelection();
      return { failed: modalState.wallpaperSaveFailed, same: before === JSON.stringify(await getWallpaperSelectionDB()) };
    })()`);
    assert.deepEqual(upload, { failed: true, same: true });
    await evalJS('dom.confirmOkBtn.click(); cancelEditModal()');

    // 多指手势与拖拽中断
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evalJS(`(async () => {
      await openEditModal();
      replaceBookmarkDraft(Array.from({ length: 16 }, (_, i) => ({ id: 'touch_' + i, name: '书签' + i, url: 'https://touch' + i + '.example.test/' })));
      renderEditList();
      window.__touch = (id, x, y) => new Touch({ identifier: id, target: dom.editList, clientX: x, clientY: y });
      window.__dispatch = (type, touches, changed) => dom.editList.querySelector('.drag-handle').dispatchEvent(new TouchEvent(type, { bubbles: true, touches, changedTouches: changed }));
      const a = dom.editList.querySelectorAll('.edit-row-card')[0].getBoundingClientRect();
      const b = dom.editList.querySelectorAll('.edit-row-card')[1].getBoundingClientRect();
      window.__first = __touch(7, a.x + 15, a.y + 20); window.__moved = __touch(7, b.x + 15, b.bottom - 2); window.__other = __touch(8, a.x + 30, a.y + 20);
      __dispatch('touchstart', [__first], [__first]); __dispatch('touchmove', [__other, __moved], [__moved]);
    })()`);
    await evalJS('new Promise(requestAnimationFrame)');
    assert.equal(await evalJS(`(() => { __dispatch('touchend', [__moved], [__other]); return modalState.draftBookmarks[0].id === 'touch_0' && !dom.editList.querySelector('.dragging'); })()`), false);
    await evalJS(`__dispatch('touchend', [], [__moved])`);
    assert.equal(await evalJS(`modalState.draftBookmarks[0].id === 'touch_1'`), true);
    await evalJS(`__dispatch('touchstart', [__first], [__first]); __dispatch('touchmove', [__moved], [__moved])`);
    await evalJS('new Promise(requestAnimationFrame)');
    assert.equal(await evalJS(`(() => { const before = JSON.stringify(modalState.draftBookmarks); window.dispatchEvent(new Event('blur')); handleAppWakeUp(); __dispatch('touchend', [], [__moved]); return before === JSON.stringify(modalState.draftBookmarks) && !dom.editList.querySelector('.dragging,.drop-target-above,.drop-target-below'); })()`), true);
    await evalJS(`(() => { dom.editList.scrollTop = 0; const rect = dom.editList.getBoundingClientRect(); const edge = __touch(7, rect.x + 20, rect.bottom - 2); __dispatch('touchstart', [__first], [__first]); __dispatch('touchmove', [edge], [edge]); })()`);
    await waitFor(evalJS, 'dom.editList.scrollTop > 30');
    await evalJS("__dispatch('touchcancel', [], [__first]); window.__scrollAfterCancel = dom.editList.scrollTop");
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await evalJS('dom.editList.scrollTop === __scrollAfterCancel'), true);
  } finally {
    await chrome.close();
    await server.close();
  }
});
