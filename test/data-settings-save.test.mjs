import assert from 'node:assert/strict';
import { launchSession, waitFor } from './support/helpers.mjs';

const { server, chrome, send, evalJS } = await launchSession(0, {
  '/other/sw.js': (req, res) => {
    res.writeHead(200, {'Content-Type': 'application/javascript', 'Cache-Control': 'no-store'});
    res.end("self.addEventListener('install', () => self.skipWaiting());");
  }
});
try {
  // 壁纸加载期间取消；也覆盖取消后重新打开并编辑的下一轮窗口。
  for (const reopen of [false, true]) {
    const result = await evalJS(`(async () => {
      await openEditModal();
      const before = JSON.stringify(pageData.bookmarks);
      const stored = localStorage.getItem(CONFIG.KEYS.CUSTOM_META);
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
          storageUnchanged: localStorage.getItem(CONFIG.KEYS.CUSTOM_META) === stored,
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

  const cancelledCommit = await evalJS(`(async () => {
    await commitWallpaperSelection(backgrounds[1]);
    await openEditModal();
    await previewDraftWallpaper(backgrounds[2]);
    const get = IDBObjectStore.prototype.get;
    let release;
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
    try {
      const saving = saveEditModal();
      while (!release) await new Promise(resolve => setTimeout(resolve, 5));
      cancelEditModal();
      await openEditModal();
      const initial = modalState.initialWallpaper;
      const name = dom.editList.querySelector('.edit-name');
      name.value = '新窗口草稿'; name.dispatchEvent(new Event('input', {bubbles:true}));
      release(); await saving;
      return {open:state.editOpen, draft:modalState.draftBookmarks[0].name,
        initialUnchanged:modalState.initialWallpaper === initial,
        persistedBg:(await getWallpaperSelectionDB()).bg, enabled:!dom.saveEditBtn.disabled};
    } finally {
      IDBObjectStore.prototype.get = get;
      if (state.editOpen) cancelEditModal();
    }
  })()`);
  assert.deepEqual(cancelledCommit, {open:true,draft:'新窗口草稿',initialUnchanged:true,persistedBg:1,enabled:true});
  console.log('✅ 壁纸提交读取期间取消不写入；旧保存不修改或关闭新窗口');

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

  // 两个存储键分别失败；同时检查已有配置回滚与首次保存的键删除回滚。
  for (const existing of [false, true]) {
    for (const failure of ['BOOKMARK_KEYS', 'CUSTOM_META']) {
      await evalJS(`(async () => {
        storageRemove(CONFIG.KEYS.BOOKMARK_KEYS);
        storageRemove(CONFIG.KEYS.CUSTOM_META);
        loadBookmarks();
        if (${existing}) saveUserBookmarks(pageData.bookmarks);
        await openEditModal();
        window.__saveBefore = {
          bookmarks: JSON.stringify(pageData.bookmarks),
          keys: localStorage.getItem(CONFIG.KEYS.BOOKMARK_KEYS),
          meta: localStorage.getItem(CONFIG.KEYS.CUSTOM_META)
        };
        const name = dom.editList.querySelector('.edit-name');
        name.value = '失败保留草稿';
        name.dispatchEvent(new Event('input', { bubbles: true }));
        const url = dom.editList.querySelector('.edit-url');
        url.value = 'https://save-regression.example.test/';
        url.dispatchEvent(new Event('input', { bubbles: true }));
        window.__originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key === CONFIG.KEYS.${failure}) throw new DOMException('test quota', 'QuotaExceededError');
          return __originalSetItem.call(this, key, value);
        };
        dom.saveEditBtn.click();
      })()`);
      try {
        await waitFor(evalJS, '!dom.saveEditBtn.disabled && OverlayStack.top()?.id === "confirmModal"');
        const failed = await evalJS(`({
          open: state.editOpen,
          unchanged: JSON.stringify(pageData.bookmarks) === __saveBefore.bookmarks,
          keysRestored: localStorage.getItem(CONFIG.KEYS.BOOKMARK_KEYS) === __saveBefore.keys,
          metaRestored: localStorage.getItem(CONFIG.KEYS.CUSTOM_META) === __saveBefore.meta,
          draft: modalState.draftBookmarks[0].name,
          message: dom.confirmMsg.textContent
        })`);
        assert.ok(failed.open && failed.unchanged && failed.keysRestored && failed.metaRestored, JSON.stringify(failed));
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
  }
  console.log('✅ 书签任一存储键写入失败均保留旧配置、视图与草稿，提示失败并支持重试');

  const queryUrl = 'https://save-regression.example.test/?a=1&b=2';
  await evalJS(`(async () => {
    await openEditModal();
    const input = dom.editList.querySelector('.edit-url');
    input.value = ${JSON.stringify(queryUrl)}; input.dispatchEvent(new Event('input',{bubbles:true}));
    await saveEditModal();
    window.reusedBookmarkNode = dom.bookmarks.firstElementChild;
    await openEditModal();
    const name = dom.editList.querySelector('.edit-name');
    name.value = '参数书签'; name.dispatchEvent(new Event('input',{bubbles:true}));
    await saveEditModal();
  })()`);
  assert.deepEqual(await evalJS(`({same:reusedBookmarkNode === dom.bookmarks.firstElementChild,
    href:dom.bookmarks.firstElementChild.getAttribute('href'),
    parameter:new URL(dom.bookmarks.firstElementChild.href).searchParams.get('b'),
    blocked:safeUrl('javascript:alert(1)',false)})`),{same:true,href:queryUrl,parameter:'2',blocked:'#'});
  console.log('✅ 书签改名复用节点保留多参数 URL，原生属性路径仍拦截不安全协议');

  await evalJS(`(async () => {
    await navigator.serviceWorker.ready;
    const other = await navigator.serviceWorker.register('/other/sw.js', {scope:'/other/'});
    const worker = other.installing || other.waiting || other.active;
    if (worker.state !== 'activated') await new Promise(resolve => worker.addEventListener('statechange', () => {if(worker.state === 'activated')resolve();}));
    await Promise.all(['glass-scope-%2F-app-core-vclear-test','glass-scope-%2Fother%2F-app-core-vkeep-test',
      'unrelated-cache',CONFIG.CACHE.FAVICON].map(key => caches.open(key)));
    sessionStorage.setItem('clearCacheBookmarkKeys',localStorage.getItem(CONFIG.KEYS.BOOKMARK_KEYS));
    await openEditModal(); document.querySelector('#tab-btn-data').click(); dom.clearCacheBtn.click();
  })()`);
  await waitFor(evalJS,'OverlayStack.top()?.id === "confirmModal"');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__cacheClearReloaded = true;"});
  await evalJS('dom.confirmOkBtn.click()');
  await waitFor(evalJS,'window.__cacheClearReloaded === true && typeof state !== "undefined" && !!document.querySelector(".bookmark-item")',10000);
  assert.deepEqual(await evalJS(`(async () => ({
    ownRemoved:!await caches.has('glass-scope-%2F-app-core-vclear-test'),
    otherKept:await caches.has('glass-scope-%2Fother%2F-app-core-vkeep-test'),
    unrelatedKept:await caches.has('unrelated-cache'), sharedIconsKept:await caches.has(CONFIG.CACHE.FAVICON),
    otherRegistered:(await navigator.serviceWorker.getRegistrations()).some(r => r.scope === location.origin + '/other/'),
    bookmarksKept:localStorage.getItem(CONFIG.KEYS.BOOKMARK_KEYS) === sessionStorage.getItem('clearCacheBookmarkKeys')
  }))()`),{ownRemoved:true,otherKept:true,unrelatedKept:true,sharedIconsKept:true,otherRegistered:true,bookmarksKept:true});
  console.log('✅ 清理只删除当前 scope 的离线池，保留其他注册、其他缓存、共享图标和书签');
} finally {
  await chrome.close();
  await server.close();
}
