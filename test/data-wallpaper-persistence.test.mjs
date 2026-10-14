import assert from 'node:assert/strict';
import { launchSession, waitFor } from './helpers.mjs';

const { server, chrome, send, evalJS } = await launchSession();
try {
  await waitFor(evalJS, 'typeof commitWallpaperSelection === "function"');
  const result = await evalJS(`(async () => {
    const old = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=';
    const next = old.replace('image/png;', 'image/png;charset=utf-8;');
    await commitWallpaperSelection(old);
    await openEditModal();
    const put = IDBObjectStore.prototype.put;
    const remove = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.put = function(...args) {
      const request = put.apply(this, args);
      request.addEventListener('success', () => request.transaction.abort());
      return request;
    };
    let writeFalse, commitFalse, unchanged, previewFalse, blocked;
    try {
      writeFalse = await setWallpaperDB(next) === false;
      commitFalse = await commitWallpaperSelection(next) === false;
      unchanged = await getWallpaperDB() === old && state.customWallpaper === old && modalState.initialWallpaper === old;
      previewFalse = await previewDraftWallpaper(next) === false;
      dom.confirmOkBtn.click();
      dom.saveEditBtn.click();
      await new Promise(resolve => setTimeout(resolve, 30));
      blocked = state.editOpen && OverlayStack.top()?.id === 'confirmModal' && modalState.wallpaperSaveFailed;
      dom.confirmOkBtn.click();
    } finally { IDBObjectStore.prototype.put = put; }
    IDBObjectStore.prototype.delete = function(...args) {
      const request = remove.apply(this, args);
      request.addEventListener('success', () => request.transaction.abort());
      return request;
    };
    let deleteFalse;
    try { deleteFalse = await removeWallpaperDB() === false && await getWallpaperDB() === old; }
    finally { IDBObjectStore.prototype.delete = remove; }
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function() { throw new DOMException('quota', 'QuotaExceededError'); };
    let saved, restored;
    try {
      saved = await previewDraftWallpaper(next) === true && !modalState.wallpaperSaveFailed && await getWallpaperDB() === next;
      await commitWallpaperSelection(backgrounds[3]);
      state.bg = 0; state.customWallpaper = null;
      await restoreWallpaper();
      restored = state.bg === 3 && await getWallpaperDB() === null;
    } finally { Storage.prototype.setItem = setItem; }
    const NativeImage = window.Image;
    let pending;
    window.Image = class { constructor() { pending = this; } };
    let resetCancelsPending;
    try {
      const stopped = previewDraftWallpaper('https://pending.example.com/image.png');
      const cleared = await clearCustomWallpaper();
      resetCancelsPending = cleared && await stopped === false && pending.onload === null &&
        await getWallpaperDB() === null && state.customWallpaper === null;
    } finally { window.Image = NativeImage; }
    await commitWallpaperSelection(next);
    const noBase64InLS = localStorage.getItem(CONFIG.KEYS.USER_WALLPAPER) === null;
    cancelEditModal();
    return {writeFalse, commitFalse, unchanged, previewFalse, blocked, deleteFalse, saved, restored, resetCancelsPending, noBase64InLS};
  })()`);
  assert.equal(Object.values(result).every(Boolean), true, JSON.stringify(result));
  console.log('✅ 写请求成功后事务中止仍判失败，删除中止保留旧数据，保存按钮阻止失败关闭');
  console.log('✅ LocalStorage 配额错误不破坏 IDB 保存，预设索引和图片共同恢复，不新增 Base64 镜像');

  await send('Page.enable');
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__blockedIDBProbe = true;
    indexedDB.open = () => { const request = {}; queueMicrotask(() => request.onerror?.()); return request; };
  ` });
  await send('Page.reload');
  await waitFor(evalJS, 'window.__blockedIDBProbe && typeof commitWallpaperSelection === "function"');
  assert.equal(await evalJS('(async () => await commitWallpaperSelection(backgrounds[1]) === false)()'), true);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await send('Page.reload');
  await waitFor(evalJS, '!window.__blockedIDBProbe && typeof commitWallpaperSelection === "function" && !!state.customWallpaper');
  assert.equal(await evalJS('(async () => (await getWallpaperDB()) === state.customWallpaper)()'), true);
  console.log('✅ IDB 不可用明确失败，恢复权限并重载后原壁纸仍可读取');
} finally {
  await chrome.close();
  await server.close();
}
