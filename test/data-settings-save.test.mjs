import assert from 'node:assert/strict';
import { launchSession, waitFor } from './support/helpers.mjs';

const { server, chrome, evalJS } = await launchSession();
try {
  // 壁纸加载期间取消；也覆盖取消后重新打开并编辑的下一轮窗口。
  for (const reopen of [false, true]) {
    const result = await evalJS(`(async () => {
      await openEditModal();
      const before = JSON.stringify(pageData.bookmarks);
      const stored = localStorage.getItem(CONFIG.KEYS.CUSTOM_META);
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
        dom.saveEditBtn.click();
        const waiting = dom.saveEditBtn.disabled;
        dom.cancelEditBtn.click();
        const cancelled = !state.editOpen && !dom.saveEditBtn.disabled;
        if (${reopen}) {
          await openEditModal();
          editName('下一轮草稿');
        }
        images[0].onload();
        await selection;
        // 等待已完成的选择唤醒所有保存任务，再检查是否有迟到提交。
        await new Promise(resolve => requestAnimationFrame(resolve));
        return {
          waiting, cancelled,
          unchanged: JSON.stringify(pageData.bookmarks) === before,
          storageUnchanged: localStorage.getItem(CONFIG.KEYS.CUSTOM_META) === stored,
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
    assert.ok(result.waiting && result.cancelled && result.unchanged && result.storageUnchanged && result.enabled, JSON.stringify(result));
    assert.equal(result.open, reopen);
    assert.equal(result.top, reopen ? 'editModal' : null);
    if (reopen) assert.equal(result.draft, '下一轮草稿');
  }
  console.log('✅ 等待壁纸时取消保存不提交书签；重新打开后的草稿与窗口不受旧任务干扰');

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
} finally {
  await chrome.close();
  await server.close();
}
