import assert from 'node:assert/strict';
import { createEvaluator, launchSession, waitFor, sleep } from './support/helpers.mjs';
import { connectCDP } from './support/cdp.mjs';

let releaseWallpaper;
const { server, chrome, send, evalJS, cdpPort } = await launchSession(0, {
  '/late-wallpaper.png': (_req, res) => {
    releaseWallpaper = () => { res.writeHead(404); res.end(); };
  },
  '/other/sw.js': (req, res) => {
    res.writeHead(200, {'Content-Type': 'application/javascript', 'Cache-Control': 'no-store'});
    res.end("self.addEventListener('install', () => self.skipWaiting());");
  }
});
try {
  await evalJS(`(async () => {
    await openEditModal();
    document.getElementById('tab-btn-appearance').click();
    dom.urlBgBtn.click();
    dom.urlBgInput.value = location.origin + '/late-wallpaper.png';
    dom.urlBgConfirmBtn.click();
    dom.saveEditBtn.click();
    document.getElementById('tab-btn-data').click();
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify([{name:'仍可确认的导入',url:'https://import.test'}])],
      'bookmarks.json', { type:'application/json' }));
    dom.importJsonInput.files = transfer.files;
    dom.importJsonInput.dispatchEvent(new Event('change', { bubbles:true }));
  })()`);
  await waitFor(evalJS, `OverlayStack.top()?.id === 'confirmModal' && dom.confirmTitle.textContent === '导入草稿确认'`);
  await waitFor(() => Boolean(releaseWallpaper), 'wallpaper request held');
  releaseWallpaper();
  releaseWallpaper = null;
  await waitFor(evalJS, `dom.wallpaperError.textContent.includes('无法加载该图片')`);
  assert.equal(await evalJS(`OverlayStack.top()?.id === 'confirmModal' && dom.confirmTitle.textContent === '导入草稿确认'`), true);
  await evalJS('dom.confirmOkBtn.click()');
  assert.deepEqual(await evalJS('modalState.draftBookmarks.map(bookmark => bookmark.name)'), ['仍可确认的导入']);
  await evalJS(`document.getElementById('tab-btn-appearance').click()`);
  assert.equal(await evalJS('dom.wallpaperError.getClientRects().length > 0'), true);
  await evalJS('cancelEditModal()');
  assert.equal(await evalJS('dom.wallpaperError.textContent'), '');

  // 壁纸加载期间取消；也覆盖取消后重新打开并编辑的下一轮窗口。
  for (const reopen of [false, true]) {
    const result = await evalJS(`(async () => {
      await openEditModal();
      const before = JSON.stringify(pageData.bookmarks);
      const stored = localStorage.getItem(CONFIG.KEYS.BOOKMARKS);
      const wallpaperBefore = JSON.stringify(await getWallpaperSelectionDB());
      const NativeImage = window.Image;
      const images = [];
      window.Image = class { constructor() { images.push(this); } };
      const editName = value => {
        const input = dom.editList.querySelector('.edit-name');
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      try {
        editName('本次取消');
        const selection = previewDraftWallpaper(location.origin + '/pending-save-' + (${reopen} ? '2' : '1') + '.png');
        const lateLoad = images[0].onload;
        dom.saveEditBtn.click();
        const waiting = dom.saveEditBtn.disabled;
        dom.cancelEditBtn.click();
        const cancelled = !state.editOpen && !dom.saveEditBtn.disabled;
        if (${reopen}) {
          await openEditModal();
          editName('下一轮草稿');
        }
        await lateLoad();
        const selectionCancelled = await selection === false;
        // 等待已完成的选择唤醒所有保存任务，再检查是否有迟到提交。
        await new Promise(resolve => requestAnimationFrame(resolve));
        return {
          waiting, cancelled,
          unchanged: JSON.stringify(pageData.bookmarks) === before,
          storageUnchanged: localStorage.getItem(CONFIG.KEYS.BOOKMARKS) === stored,
          wallpaperUnchanged: JSON.stringify(await getWallpaperSelectionDB()) === wallpaperBefore,
          selectionCancelled,
          open: state.editOpen,
          top: OverlayStack.top()?.id || null,
          draft: modalState.draftBookmarks[0].name,
          enabled: !dom.saveEditBtn.disabled
        };
      } finally {
        window.Image = NativeImage;
        if (state.editOpen) cancelEditModal();
      }
    })()`);
    assert.ok(result.waiting && result.cancelled && result.unchanged && result.storageUnchanged && result.wallpaperUnchanged && result.selectionCancelled && result.enabled, JSON.stringify(result));
    assert.equal(result.open, reopen);
    assert.equal(result.top, reopen ? 'editModal' : null);
    if (reopen) assert.equal(result.draft, '下一轮草稿');
  }
  console.log('✅ 等待壁纸时取消保存不提交书签；重新打开后的草稿与窗口不受旧任务干扰');

  // 等待壁纸时仍可编辑；等待结束后必须读取并校验最新草稿。
  for (const invalid of [false, true]) {
    const latestDraft = await evalJS(`(async () => {
      await openEditModal();
      const NativeImage = window.Image;
      const images = [];
      window.Image = class { constructor() { images.push(this); } };
      const input = dom.editList.querySelector('.edit-name');
      try {
        input.value = '等待前名称';
        input.dispatchEvent(new Event('input', {bubbles:true}));
        const preview = previewDraftWallpaper(location.origin + '/latest-draft-${invalid}.png');
        const saving = saveEditModal();
        const editable = !input.closest('[inert]') && modalState.phase !== 'committing' && !dom.cancelEditBtn.disabled;
        dom.languageBtn.click();
        const languageLocked = dom.languageBtn.disabled && OverlayStack.top()?.id !== 'languageModal';
        if (OverlayStack.top()?.id === 'languageModal') dom.cancelLanguageBtn.click();
        if (${invalid}) {
          for (const field of dom.editList.querySelectorAll('.edit-url')) {
            field.value = '';
            field.dispatchEvent(new Event('input', {bubbles:true}));
          }
        } else {
          input.value = '等待后的最新名称';
          input.dispatchEvent(new Event('input', {bubbles:true}));
        }
        await images[0].onload();
        await preview;
        await saving;
        const result = {
          editable, languageLocked, open:state.editOpen, name:pageData.bookmarks[0].name,
          unlocked:modalState.phase !== 'committing' && !dom.saveEditBtn.disabled && !dom.cancelEditBtn.disabled && !dom.languageBtn.disabled,
          rejected:OverlayStack.top()?.id === 'confirmModal'
        };
        if (OverlayStack.top()?.id === 'confirmModal') OverlayStack.top().close();
        if (state.editOpen) cancelEditModal();
        return result;
      } finally { window.Image = NativeImage; }
    })()`);
    assert.equal(latestDraft.editable && latestDraft.languageLocked && latestDraft.unlocked, true, JSON.stringify(latestDraft));
    assert.equal(latestDraft.open, invalid);
    assert.equal(latestDraft.rejected, invalid);
    assert.equal(latestDraft.name, '等待后的最新名称');
  }
  console.log('✅ 等待壁纸期间的修改保存最新草稿，全部失效的最新书签不会提交');

  // 读取或真实写事务仍待决时，取消入口均不能恢复旧预览。
  for (const phase of ['read', 'write', 'abort']) {
    const committing = await evalJS(`(async () => {
      await commitWallpaperSelection(backgrounds[1]);
      await openEditModal();
      await previewDraftWallpaper(backgrounds[2]);
      document.getElementById('tab-btn-appearance').click();
      const get = IDBObjectStore.prototype.get;
      const put = IDBObjectStore.prototype.put;
      let release;
      if ('${phase}' === 'read') {
        IDBObjectStore.prototype.get = function(key) {
          const req = get.call(this, key);
          if (key === CONFIG.IDB.KEYS.SELECTION) {
            IDBObjectStore.prototype.get = get;
            Object.defineProperty(req, 'onsuccess', {set(callback) {
              req.addEventListener('success', event => { release = () => callback(event); });
            }});
          }
          return req;
        };
      } else {
        IDBObjectStore.prototype.put = function(value, key) {
          const req = put.call(this, value, key);
          if (key === CONFIG.IDB.KEYS.SELECTION) {
            IDBObjectStore.prototype.put = put;
            const store = this;
            req.addEventListener('success', () => {
              let held = true;
              release = () => { held = false; };
              // 连续排队请求，让原生事务保持活动，直到测试释放或中止它。
              const keepAlive = () => {
                if (!held) {
                  if ('${phase}' === 'abort') store.transaction.abort();
                  return;
                }
                get.call(store, key).onsuccess = keepAlive;
              };
              keepAlive();
            });
          }
          return req;
        };
      }
      try {
        let saving;
        if ('${phase}' === 'abort') {
          const name = dom.editList.querySelector('.edit-name');
          name.value = ' 壁纸失败前已保存的书签 ';
          name.dispatchEvent(new Event('input', {bubbles: true}));
          previewDraftMaskOpacity(47);
          modalState.draftTransitionMode = 'classic';

          const NativeImage = window.Image;
          window.Image = class {};
          try {
            previewDraftWallpaper(location.origin + '/pending-import.png');
            saving = saveEditModal();
            const data = JSON.stringify([{name:'提交期间不得导入', url:'https://late-import.example.test/'}]);
            importBookmarksJSON(new File([data], 'bookmarks.json', {type:'application/json'}));
            while (OverlayStack.top()?.id !== 'confirmModal') await new Promise(resolve => setTimeout(resolve, 5));
          } finally { window.Image = NativeImage; }
          await previewDraftWallpaper(backgrounds[2]);
        } else {
          saving = saveEditModal();
        }
        while (!release) await new Promise(resolve => setTimeout(resolve, 5));
        const importDismissed = OverlayStack.top()?.id === 'editModal';
        const locked = modalState.phase === 'committing' && dom.saveEditBtn.disabled && dom.cancelEditBtn.disabled
          && dom.languageBtn.disabled && [...document.querySelectorAll('.settings-tab-panel')].every(panel => panel.inert);
        // 控件状态不再决定业务提交状态。
        dom.cancelEditBtn.disabled = false;
        dom.presetWallpaperGrid.querySelector('[data-bg="' + backgrounds[3] + '"]').click();
        const selectionBlocked = await previewDraftWallpaper(backgrounds[3]) === false
          && await resetDraftWallpaper() === false
          && uploadWallpaper(new File(['image'], 'blocked.png', {type:'image/png'})) === false
          && modalState.draftWallpaper === backgrounds[2];
        dom.cancelEditBtn.disabled = true;
        const attempts = [
          () => dom.cancelEditBtn.click(),
          () => document.getElementById('editModal').click(),
          () => document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})),
          () => cancelEditModal()
        ].map(cancel => {
          cancel();
          return state.editOpen && OverlayStack.top()?.id === 'editModal'
            && modalState.draftWallpaper === backgrounds[2];
        });
        release(); await saving;
        const persistedBg = (await getWallpaperSelectionDB()).bg;
        const result = {locked, selectionBlocked, attempts, persistedBg, runtimeBg:state.bg,
          enabled:modalState.phase !== 'committing' && !dom.saveEditBtn.disabled && !dom.cancelEditBtn.disabled
            && !dom.languageBtn.disabled && [...document.querySelectorAll('.settings-tab-panel')].every(panel => !panel.inert),
          open:state.editOpen};
        if ('${phase}' === 'abort') {
          result.importDismissed = importDismissed;
          const error = dom.wallpaperError.textContent;
          result.failureShown = OverlayStack.top()?.id === 'editModal' && error.includes('未能保存');
          result.partialSaveShown = ['快捷书签', '背景暗度', '切屏动效', '已保存并生效'].every(label => error.includes(label));
          result.otherChangesSaved = pageData.bookmarks[0].name === '壁纸失败前已保存的书签'
            && storageGet(CONFIG.KEYS.MASK_OPACITY) === 47 && getTransitionMode() === 'classic';
          result.bookmarkDraftSynced = !modalState.bookmarksChanged
            && dom.editList.querySelector('.edit-name').value === pageData.bookmarks[0].name;
          IDBObjectStore.prototype.put = function(...args) {
            const req = put.apply(this, args);
            req.addEventListener('success', () => req.transaction.abort());
            return req;
          };
          await saveEditModal();
          result.retryShowsSavedChanges = dom.wallpaperError.textContent === error;
          dom.cancelEditBtn.click();
          result.cancelledAfterFailure = !state.editOpen && modalState.draftWallpaper === backgrounds[1];
        }
        return result;
      } finally {
        IDBObjectStore.prototype.get = get;
        IDBObjectStore.prototype.put = put;
        release?.();
        if (state.editOpen) cancelEditModal();
      }
    })()`);
    assert.deepEqual(committing, {
      locked:true, selectionBlocked:true, attempts:[true,true,true,true],
      persistedBg:phase === 'abort' ? 1 : 2, runtimeBg:phase === 'abort' ? 1 : 2,
      enabled:true, open:phase === 'abort',
      ...(phase === 'abort' ? {importDismissed:true, failureShown:true, partialSaveShown:true,
        otherChangesSaved:true, bookmarkDraftSynced:true, retryShowsSavedChanges:true, cancelledAfterFailure:true} : {})
    });
  }
  console.log('✅ 壁纸提交期间外观选择、取消按钮、遮罩与 Escape 均被锁定；事务成功或失败后解除锁定');
  console.log('✅ 保存时关闭待确认的导入；壁纸写入失败及重试时列出已生效的设置');

  // 重置的事务完成通知延后时，不能取消或并发保存；失效会话不能触碰新草稿。
  for (const phase of ['stale', 'success', 'abort']) {
    await evalJS(`(async () => {
      await commitWallpaperSelection(backgrounds[1]);
      await openEditModal();
      storageSet(CONFIG.KEYS.MASK_OPACITY, 37);
      if ('${phase}' !== 'stale') {
        const decode = HTMLImageElement.prototype.decode;
        const loading = Promise.withResolvers();
        const decoding = Promise.withResolvers();
        window.__releaseDraftDecode = decoding.resolve;
        window.__resetDraftURL = location.origin + '/wallpapers/bg3.avif?pending-reset-draft';
        HTMLImageElement.prototype.decode = async function() {
          await decode.call(this);
          if (this.src !== __resetDraftURL) return;
          loading.resolve();
          await decoding.promise;
        };
        try {
          window.__resetDraftResult = previewDraftWallpaper(__resetDraftURL);
          await loading.promise;
        } finally { HTMLImageElement.prototype.decode = decode; }
      }
      window.__resetTransaction = IDBDatabase.prototype.transaction;
      window.__releaseReset = null;
      IDBDatabase.prototype.transaction = function(...args) {
        const tx = __resetTransaction.apply(this, args);
        if (args[1] === 'readwrite') {
          IDBDatabase.prototype.transaction = __resetTransaction;
          for (const eventName of ('${phase}' === 'abort' ? ['abort', 'error'] : ['complete'])) {
            Object.defineProperty(tx, 'on' + eventName, {set(callback) {
              tx.addEventListener(eventName, event => { __releaseReset = () => callback(event); });
            }});
          }
          if ('${phase}' === 'abort') {
            tx.objectStore(CONFIG.IDB.STORES.WALLPAPERS).get(CONFIG.IDB.KEYS.SELECTION)
              .onsuccess = () => tx.abort();
          }
        }
        return tx;
      };
      resetBookmarks(); dom.confirmOkBtn.click();
    })()`);
    try {
      await waitFor(evalJS, 'typeof __releaseReset === "function"');
      const result = await evalJS(`(async () => {
        const locked = modalState.phase === 'committing' && dom.saveEditBtn.disabled && dom.cancelEditBtn.disabled
          && dom.languageBtn.disabled && [...document.querySelectorAll('.settings-tab-panel')].every(panel => panel.inert);
        dom.cancelEditBtn.click();
        document.getElementById('editModal').click();
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
        cancelEditModal();
        const stayedOpen = state.editOpen && OverlayStack.top()?.id === 'editModal';
        await saveEditModal(); resetBookmarks();
        const noConcurrentAction = OverlayStack.top()?.id === 'editModal'
          && storageGet(CONFIG.KEYS.MASK_OPACITY) === 37;
        if ('${phase}' === 'stale') {
          // 内部关闭使会话失效，模拟下一轮窗口已被打开。
          closeEditModal();
          const opening = openEditModal();
          __releaseReset();
          await opening;
          const name = dom.editList.querySelector('.edit-name');
          name.value = '新会话草稿'; name.dispatchEvent(new Event('input', {bubbles:true}));
        } else {
          __releaseDraftDecode();
          await new Promise(resolve => requestAnimationFrame(resolve));
          if (modalState.draftWallpaper !== backgrounds[1]) throw new Error('重置期间发布了壁纸预览');
          __releaseReset();
          const expected = '${phase}' === 'abort';
          if (await __resetDraftResult !== expected) throw new Error('重置结果与选图任务的去留不一致');
          if (expected && modalState.draftWallpaper !== __resetDraftURL) throw new Error('失败后未恢复待预览壁纸');
        }
        await new Promise(resolve => requestAnimationFrame(resolve));
        return {locked, stayedOpen, noConcurrentAction};
      })()`);
      const after = await evalJS(`({
        open:state.editOpen, draft:modalState.draftBookmarks[0]?.name,
        opacity:storageGet(CONFIG.KEYS.MASK_OPACITY),
        unlocked:modalState.phase !== 'committing' && !dom.saveEditBtn.disabled && !dom.cancelEditBtn.disabled,
        top:OverlayStack.top()?.id || null
      })`);
      assert.deepEqual(result, {locked:true, stayedOpen:true, noConcurrentAction:true});
      assert.equal(after.unlocked, true, JSON.stringify(after));
      assert.equal(after.open, phase !== 'success');
      assert.equal(after.opacity, phase === 'success' ? null : 37);
      assert.equal(after.top, phase === 'abort' ? 'confirmModal' : phase === 'stale' ? 'editModal' : null);
      if (phase === 'stale') assert.equal(after.draft, '新会话草稿');
    } finally {
      await evalJS(`IDBDatabase.prototype.transaction = __resetTransaction;
        window.__releaseDraftDecode?.();
        __releaseReset?.();
        if (OverlayStack.top()?.id === 'confirmModal') dom.confirmOkBtn.click();
        if (state.editOpen) cancelEditModal();`);
    }
  }
  console.log('✅ 重置期间暂停壁纸预览，成功时丢弃，失败时恢复，旧任务不清空新会话草稿');

  // 书签已重置但其他偏好删除失败时，保留用户改名及其保存意图。
  await evalJS(`(async () => {
    await openEditModal();
    const input = dom.editList.querySelector('.edit-name');
    input.value = '重置失败后仍可保存';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const remove = Storage.prototype.removeItem;
    window.restoreAuditStorage = () => { Storage.prototype.removeItem = remove; };
    Storage.prototype.removeItem = function(key) {
      if (key === CONFIG.KEYS.MASK_OPACITY) throw new DOMException('blocked', 'SecurityError');
      return remove.call(this, key);
    };
    resetBookmarks(); dom.confirmOkBtn.click();
  })()`);
  try {
    await waitFor(evalJS, 'OverlayStack.top()?.id === "confirmModal" && modalState.phase !== "committing"');
    assert.equal(await evalJS('modalState.draftBookmarks[0].name'), '重置失败后仍可保存');
  } finally {
    await evalJS('restoreAuditStorage()');
  }
  await evalJS('dom.confirmOkBtn.click(); saveEditModal()');
  assert.equal(await evalJS('pageData.bookmarks[0].name'), '重置失败后仍可保存');

  await evalJS(`(async () => {
    await commitWallpaperSelection(backgrounds[1]);
    await openEditModal();
    const remove = Storage.prototype.removeItem;
    window.restoreAuditStorage = () => { Storage.prototype.removeItem = remove; };
    Storage.prototype.removeItem = function(key) {
      if (key === CONFIG.KEYS.MASK_OPACITY) throw new DOMException('blocked', 'SecurityError');
      return remove.call(this, key);
    };
    resetBookmarks(); dom.confirmOkBtn.click();
  })()`);
  try {
    await waitFor(evalJS, 'OverlayStack.top()?.id === "confirmModal" && modalState.phase === "editing"');
    assert.equal(await evalJS('getWallpaperSelectionDB().then(selection => selection.bg)'), 0);
  } finally {
    await evalJS('restoreAuditStorage()');
  }
  await evalJS('dom.confirmOkBtn.click(); cancelEditModal()');
  await waitFor(evalJS, 'dom.bgLayer.style.backgroundImage.includes("bg1.avif") && !dom.bgLayerNext.classList.contains("is-crossfading")');
  assert.equal(await evalJS('state.bg'), 0);

  await evalJS('commitWallpaperSelection(backgrounds[1])');
  const resetDraft = await evalJS(`(async () => {
    await openEditModal();
    await resetDraftWallpaper();
    const previewOnly = (await getWallpaperSelectionDB()).bg === 1;
    const resetSelected = dom.presetWallpaperGrid.querySelector('[data-bg="' + backgrounds[0] + '"]')?.getAttribute('aria-pressed') === 'true';
    cancelEditModal();
    const cancelKept = (await getWallpaperSelectionDB()).bg === 1;
    await openEditModal(); await resetDraftWallpaper(); await saveEditModal();
    return {previewOnly,resetSelected,cancelKept,saved:(await getWallpaperSelectionDB()).bg === 0};
  })()`);
  assert.deepEqual(resetDraft,{previewOnly:true,resetSelected:true,cancelKept:true,saved:true});
  console.log('✅ 从非默认预设恢复默认可预览、取消和保存，选中态与持久化一致');

  // 单记录写入失败时，首次保存和更新既有记录都保留原状态。
  for (const existing of [false, true]) {
    await evalJS(`(async () => {
      storageRemove(CONFIG.KEYS.BOOKMARKS);
      loadBookmarks();
      if (${existing}) saveUserBookmarks(pageData.bookmarks);
      await openEditModal();
      window.__saveBefore = {
        bookmarks: JSON.stringify(pageData.bookmarks),
        stored: localStorage.getItem(CONFIG.KEYS.BOOKMARKS)
      };
      const name = dom.editList.querySelector('.edit-name');
      name.value = '失败保留草稿';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      const url = dom.editList.querySelector('.edit-url');
      url.value = 'https://save-regression.example.test/';
      url.dispatchEvent(new Event('input', { bubbles: true }));
      window.__originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === CONFIG.KEYS.BOOKMARKS) throw new DOMException('test quota', 'QuotaExceededError');
        return __originalSetItem.call(this, key, value);
      };
      dom.saveEditBtn.click();
    })()`);
    try {
      await waitFor(evalJS, '!dom.saveEditBtn.disabled && OverlayStack.top()?.id === "confirmModal"');
      const failed = await evalJS(`({
        open: state.editOpen,
        unchanged: JSON.stringify(pageData.bookmarks) === __saveBefore.bookmarks,
        storageUnchanged: localStorage.getItem(CONFIG.KEYS.BOOKMARKS) === __saveBefore.stored,
        draft: modalState.draftBookmarks[0].name,
        message: dom.confirmMsg.textContent
      })`);
      assert.ok(failed.open && failed.unchanged && failed.storageUnchanged, JSON.stringify(failed));
      assert.equal(failed.draft, '失败保留草稿');
      assert.match(failed.message, /书签未能保存/);
    } finally {
      await evalJS('Storage.prototype.setItem = __originalSetItem');
    }
    await evalJS('dom.confirmOkBtn.click(); dom.saveEditBtn.click()');
    await waitFor(evalJS, '!state.editOpen && !dom.saveEditBtn.disabled');
    const retried = await evalJS(`(() => {
      loadBookmarks();
      return { name: pageData.bookmarks[0].name, url: pageData.bookmarks[0].url };
    })()`);
    assert.deepEqual(retried, { name: '失败保留草稿', url: 'https://save-regression.example.test/' });
  }
  console.log('✅ 书签记录写入失败时保留旧配置、视图与草稿，提示失败并支持重试');

  await evalJS(`(async () => {
    dom.searchInput.value = 'git';
    await openEditModal();
    const name = dom.editList.querySelector('.edit-name');
    name.value = '重置失败保留的草稿'; name.dispatchEvent(new Event('input', { bubbles: true }));
    window.__bookmarkBeforeReset = localStorage.getItem(CONFIG.KEYS.BOOKMARKS);
    window.__originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === CONFIG.KEYS.BOOKMARKS) throw new DOMException('test quota', 'QuotaExceededError');
      return __originalSetItem.call(this, key, value);
    };
    resetBookmarks(); dom.confirmOkBtn.click();
  })()`);
  try {
    await waitFor(evalJS, `OverlayStack.top()?.id === 'confirmModal' && /部分设置未能清除/.test(dom.confirmMsg.textContent)`);
    await evalJS("fetchSuggestions(state.engine, 'git'); openWeatherPopover()");
    assert.deepEqual(await evalJS(`({
      unchanged: localStorage.getItem(CONFIG.KEYS.BOOKMARKS) === __bookmarkBeforeReset,
      committed: pageData.bookmarks[0].name, draft: modalState.draftBookmarks[0].name,
      overlays: OverlayStack.stack.map(item => item.id),
      backgroundOpen: dom.suggestionMenu.classList.contains('active') || dom.weatherPopover.classList.contains('active')
    })`), { unchanged: true, committed: '失败保留草稿', draft: '重置失败保留的草稿',
      overlays: ['editModal', 'confirmModal'], backgroundOpen: false });
  } finally {
    await evalJS('Storage.prototype.setItem = __originalSetItem');
  }
  const escape = async () => {
    const key = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 };
    await send('Input.dispatchKeyEvent', { ...key, type: 'keyDown' });
    await send('Input.dispatchKeyEvent', { ...key, type: 'keyUp' });
  };
  await escape();
  assert.equal(await evalJS("OverlayStack.top()?.id"), 'editModal');
  await escape();
  assert.equal(await evalJS("state.editOpen"), false);
  await evalJS("dom.searchInput.value = ''");

  const queryUrl = 'https://save-regression.example.test/?a=1&b=2';
  await evalJS(`(async () => {
    await openEditModal();
    const input = dom.editList.querySelector('.edit-url');
    input.value = ${JSON.stringify(queryUrl)}; input.dispatchEvent(new Event('input',{bubbles:true}));
    await saveEditModal();
    await openEditModal();
    const name = dom.editList.querySelector('.edit-name');
    name.value = '参数书签'; name.dispatchEvent(new Event('input',{bubbles:true}));
    await saveEditModal();
  })()`);
  assert.deepEqual(await evalJS(`({
    name:dom.bookmarks.firstElementChild.querySelector('.bookmark-title')?.textContent,
    href:dom.bookmarks.firstElementChild.getAttribute('href'),
    parameter:new URL(dom.bookmarks.firstElementChild.href).searchParams.get('b'),
    blocked:safeUrl('javascript:alert(1)',false)})`),{name:'参数书签',href:queryUrl,parameter:'2',blocked:'#'});
  console.log('✅ 书签改名保留多参数 URL，原生属性路径仍拦截不安全协议');

  await evalJS(`(async () => {
    await navigator.serviceWorker.ready;
    const other = await navigator.serviceWorker.register('/other/sw.js', {scope:'/other/'});
    const worker = other.installing || other.waiting || other.active;
    if (worker.state !== 'activated') await new Promise(resolve => worker.addEventListener('statechange', () => {if(worker.state === 'activated')resolve();}));
    await Promise.all(['glass-scope-%2F-app-core-vclear-test','glass-scope-%2Fother%2F-app-core-vkeep-test',
      'glass-scope-%2F-audit%2F-app-core-vkeep-test', 'glass-scope-%2F-audit%2F-app-images-app-core-vkeep-test',
      'unrelated-cache',CONFIG.CACHE.FAVICON].map(key => caches.open(key)));
    sessionStorage.setItem('clearCacheBookmarks',localStorage.getItem(CONFIG.KEYS.BOOKMARKS));
    await openEditModal();
    const name = dom.editList.querySelector('.edit-name');
    name.value = '清缓存前未保存'; name.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#tab-btn-data').click(); dom.clearCacheBtn.click();
  })()`);
  await waitFor(evalJS,'OverlayStack.top()?.id === "confirmModal"');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__cacheClearReloaded = true;"});
  assert.equal(await evalJS(`(() => {
    const warned = dom.confirmMsg.textContent.includes('刷新将丢弃未保存的更改');
    const keys = CacheStorage.prototype.keys;
    CacheStorage.prototype.keys = function() {
      return new Promise(resolve => { window.releaseCacheKeys = () => resolve(keys.call(this)); });
    };
    dom.confirmOkBtn.click();
    dom.cancelEditBtn.click();
    return warned && modalState.phase === 'committing' && dom.tabData.inert && state.editOpen;
  })()`), true);
  await evalJS('releaseCacheKeys()');
  await waitFor(evalJS,'window.__cacheClearReloaded === true && typeof state !== "undefined" && !!document.querySelector(".bookmark-item")',10000);
  assert.deepEqual(await evalJS(`(async () => ({
    ownRemoved:!await caches.has('glass-scope-%2F-app-core-vclear-test'),
    otherKept:await caches.has('glass-scope-%2Fother%2F-app-core-vkeep-test'),
    nestedKept:await caches.has('glass-scope-%2F-audit%2F-app-core-vkeep-test') &&
      await caches.has('glass-scope-%2F-audit%2F-app-images-app-core-vkeep-test'),
    unrelatedKept:await caches.has('unrelated-cache'), sharedIconsKept:await caches.has(CONFIG.CACHE.FAVICON),
    otherRegistered:(await navigator.serviceWorker.getRegistrations()).some(r => r.scope === location.origin + '/other/'),
    bookmarksKept:localStorage.getItem(CONFIG.KEYS.BOOKMARKS) === sessionStorage.getItem('clearCacheBookmarks')
  }))()`),{ownRemoved:true,otherKept:true,nestedKept:true,unrelatedKept:true,sharedIconsKept:true,otherRegistered:true,bookmarksKept:true});
  console.log('✅ 清理只删除当前 scope 的离线池，保留其他注册、其他缓存、共享图标和书签');

  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evalJS(`(async () => {
    if (state.currentSection === 'nav') switchToStart();
    await openEditModal(); resetBookmarks(); dom.confirmOkBtn.click();
  })()`);
  await waitFor(evalJS, '!state.editOpen');
  const hint = `getComputedStyle(document.getElementById('scrollDownHint'))`;
  assert.equal(await evalJS(`${hint}.visibility`), 'visible');
  await evalJS(`(async () => {
    switchToNav();
    window.discoveryHidden = ${hint}.visibility === 'hidden' && storageGet(CONFIG.KEYS.NAV_DISCOVERED) === 1;
    switchToStart();
    await openEditModal(); resetBookmarks(); dom.confirmOkBtn.click();
  })()`);
  await waitFor(evalJS, '!state.editOpen && !storageGet(CONFIG.KEYS.NAV_DISCOVERED)');
  assert.equal(await evalJS('discoveryHidden'), true);
  assert.equal(await evalJS(`${hint}.visibility`), 'visible');
  await sleep(700);
  assert.equal(await evalJS(`${hint}.visibility === 'visible' && ${hint}.display !== 'none'`), true);
  console.log('✅ 恢复默认后提示立即恢复，旧淡出时间点经过后仍可见');

  const mixedDraft = await evalJS(`(async () => {
    const before = localStorage.getItem(CONFIG.KEYS.BOOKMARKS);
    await openEditModal();
    const input = dom.editList.querySelector('.edit-url');
    const original = input.value;
    const edit = value => { input.value = value; input.dispatchEvent(new Event('input', {bubbles:true})); };
    edit('https://');
    await saveEditModal();
    const kept = state.editOpen && dom.confirmMsg.textContent.includes('有效的 URL') &&
      modalState.draftBookmarks[0].url === 'https://' &&
      localStorage.getItem(CONFIG.KEYS.BOOKMARKS) === before &&
      pageData.bookmarks.some(bookmark => bookmark.url === original);
    dom.confirmOkBtn.click();
    edit(original);
    dom.addBookmarkBtn.click();
    await saveEditModal();
    return {kept, emptyRowIgnored: !state.editOpen && pageData.bookmarks.some(bookmark => bookmark.url === original)};
  })()`);
  assert.deepEqual(mixedDraft, {kept:true, emptyRowIgnored:true});

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const second = await connectCDP(new WebSocket(targets.find(target => target.id === targetId).webSocketDebuggerUrl));
  try {
    const tab = createEvaluator(second.send);
    await second.send('Page.enable');
    await second.send('Page.addScriptToEvaluateOnNewDocument', { source:
      "window.__GLASS_TEST__=true; Object.defineProperty(navigator,'languages',{get:()=>['zh-CN']});" });
    await second.send('Page.navigate', { url: `http://127.0.0.1:${server.port}/` });
    await waitFor(tab, 'typeof openEditModal === "function" && !!dom.bookmarks?.firstElementChild', 10000);
    const changeName = (index, name) => `(() => {
      const input = dom.editList.querySelectorAll('.edit-name')[${index}];
      input.value = ${JSON.stringify(name)};
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`;
    await evalJS(`(async()=>{await openEditModal(); ${changeName(0, '标签一已保存')}; await saveEditModal()})()`);
    await tab('openEditModal()');
    assert.equal(await tab('modalState.draftBookmarks[0].name'), '标签一已保存');
    await evalJS('openEditModal()');
    await tab(`${changeName(1, '标签二已保存')}; saveEditModal()`);
    await evalJS(`${changeName(0, '旧草稿')}; saveEditModal()`);
    assert.equal(await evalJS(`OverlayStack.top()?.id === 'confirmModal' && dom.confirmMsg.textContent.includes('另一个标签页')`), true);
    assert.equal(await evalJS('modalState.draftBookmarks[0].name'), '旧草稿');
    assert.deepEqual(await tab('pageData.bookmarks.slice(0,2).map(bookmark=>bookmark.name)'), ['标签一已保存', '标签二已保存']);
    await waitFor(evalJS, `pageData.bookmarks[1].name === '标签二已保存'`);
    await evalJS('dom.confirmOkBtn.click(); cancelEditModal()');
    await tab('openEditModal()');
    await send('Page.bringToFront');
    await evalJS(`(async () => {
      await openEditModal(); document.querySelector('#tab-btn-appearance').click();
      dom.presetWallpaperGrid.querySelector('[data-bg="./wallpapers/bg2.avif"]').click();
      await saveEditModal();
    })()`);
    await second.send('Page.bringToFront');
    await tab(`(async () => {
      document.querySelector('#tab-btn-appearance').click();
      dom.maskOpacityInput.value = '42';
      dom.maskOpacityInput.dispatchEvent(new Event('input', {bubbles:true}));
      await saveEditModal();
    })()`);
    assert.deepEqual(await evalJS(`(async()=>({selection:await getWallpaperSelectionDB(),
      hint:storageGet(CONFIG.KEYS.WALLPAPER_META), mask:storageGet(CONFIG.KEYS.MASK_OPACITY)}))()`),
      {selection:{wallpaper:null,bg:1},hint:{custom:false,bg:1},mask:42});
    await send('Page.bringToFront');
    const timeOrigin = await evalJS('performance.timeOrigin');
    await send('Page.reload');
    await waitFor(evalJS, `performance.timeOrigin !== ${timeOrigin} && typeof openEditModal === 'function' &&
      dom.bgLayer?.style.backgroundImage.includes('bg2.avif')`, 10000);
    assert.equal(await evalJS('window.__PRELOADED_BG__'), './wallpapers/bg2.avif');
  } finally {
    second.close();
    await send('Target.closeTarget', { targetId });
  }
  console.log('✅ 两个标签页共享最新书签，保存旧草稿会提示冲突并保留草稿');
} finally {
  releaseWallpaper?.();
  await chrome.close();
  await server.close();
}
