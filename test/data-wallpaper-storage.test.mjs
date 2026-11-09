import assert from 'node:assert/strict';
import { launchSession, waitFor, navigateAndWait } from './support/helpers.mjs';
import { test } from 'node:test';

await test("选择提交、事务失败与会话隔离", async () => {
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
    let writeFalse, commitFalse, unchanged, previewOnly, blocked;
    try {
      writeFalse = await setWallpaperSelectionDB({ wallpaper: next, bg: 0 }) === false;
      commitFalse = await commitWallpaperSelection(next) === false;
      unchanged = ((await getWallpaperSelectionDB())?.wallpaper ?? null) === old && state.customWallpaper === old && modalState.draftWallpaper === old;
      previewOnly = await previewDraftWallpaper(next) === true && ((await getWallpaperSelectionDB())?.wallpaper ?? null) === old;
      await saveEditModal();
      blocked = state.editOpen && OverlayStack.top()?.id === 'editModal' && !!dom.wallpaperError.textContent
        && ((await getWallpaperSelectionDB())?.wallpaper ?? null) === old;
    } finally { IDBObjectStore.prototype.put = put; }
    IDBObjectStore.prototype.delete = function(...args) {
      const request = remove.apply(this, args);
      request.addEventListener('success', () => request.transaction.abort());
      return request;
    };
    let deleteFalse;
    try { deleteFalse = await removeWallpaperDB() === false && ((await getWallpaperSelectionDB())?.wallpaper ?? null) === old; }
    finally { IDBObjectStore.prototype.delete = remove; }
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function() { throw new DOMException('quota', 'QuotaExceededError'); };
    let saved, restored;
    try {
      // 测试 IDB 不受 LocalStorage 配额错误影响；设置保存的其他字段仍可能独立失败。
      saved = await commitWallpaperSelection(next) === true && ((await getWallpaperSelectionDB())?.wallpaper ?? null) === next;
      await commitWallpaperSelection(backgrounds[3]);
      state.bg = 0; state.customWallpaper = null;
      await restoreWallpaper();
      restored = state.bg === 3 && ((await getWallpaperSelectionDB())?.wallpaper ?? null) === null;
    } finally { Storage.prototype.setItem = setItem; }
    const NativeImage = window.Image;
    let pending;
    window.Image = class { constructor() { pending = this; } };
    let resetCancelsPending;
    try {
      const stopped = previewDraftWallpaper('https://pending.example.com/image.png');
      const stoppedImage = pending;
      resetBookmarks();
      dom.confirmOkBtn.click();
      resetCancelsPending = await stopped === false && !state.editOpen && stoppedImage.onload === null &&
        ((await getWallpaperSelectionDB())?.wallpaper ?? null) === null && state.customWallpaper === null;
    } finally { window.Image = NativeImage; }
    await commitWallpaperSelection(next);
    const savedSelection = (await getWallpaperSelectionDB())?.wallpaper === next;
    cancelEditModal();
    return {writeFalse, commitFalse, unchanged, previewOnly, blocked, deleteFalse, saved, restored, resetCancelsPending, savedSelection};
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
      assert.equal(await evalJS('(async () => (((await getWallpaperSelectionDB())?.wallpaper ?? null)) === state.customWallpaper)()'), true);
      console.log('✅ IDB 不可用明确失败，恢复权限并重载后原壁纸仍可读取');

      await send('Network.enable');
      const requestedPresets = [];
      const stopRequests = send('Network.requestWillBeSent', ({ request }) => {
        if (/\/wallpapers\/bg\d+\.avif(?:\?|$)/.test(request.url)) requestedPresets.push(request.url);
      });
      const { identifier: delayedOpen } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function(...args) {
      const request = open.apply(this, args);
      Object.defineProperty(request, 'onsuccess', { set(callback) {
        request.addEventListener('success', event => setTimeout(() => callback(event), 350));
      } });
      return request;
    };
  ` });
      try {
        await navigateAndWait(send, evalJS, `http://127.0.0.1:${server.port}/?preload=custom`,
          'typeof commitWallpaperSelection === "function" && !!state.customWallpaper');
        await evalJS('new Promise(resolve => setTimeout(resolve, 300))');
        assert.equal(requestedPresets.some(url => /\/bg2\.avif(?:\?|$)/.test(url)), false);

        await evalJS('commitWallpaperSelection(backgrounds[3])');
        requestedPresets.length = 0;
        await navigateAndWait(send, evalJS, `http://127.0.0.1:${server.port}/?preload=preset`,
          'typeof commitWallpaperSelection === "function" && state.bg === 3 && !state.customWallpaper');
        await waitFor(async () => requestedPresets.some(url => /\/bg5\.avif(?:\?|$)/.test(url)), 'true');
        assert.equal(requestedPresets.some(url => /\/bg2\.avif(?:\?|$)/.test(url)), false);
        console.log('✅ IDB 延迟恢复时自定义壁纸跳过下一张预设，预设选择按恢复后的索引预加载');
      } finally {
        stopRequests();
        await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: delayedOpen });
      }
    } finally {
      await chrome.close();
      await server.close();
    }
});

await test("现代壁纸选择持久化与优先级", async () => {
    const { server, chrome, evalJS } = await launchSession();
    try {
      await waitFor(evalJS, 'typeof getCommittedWallpaperUrl === "function"');
      const checks = await evalJS(`(async () => {
    const testImg = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=';
    await removeWallpaperDB(); state.customWallpaper = null;
    storageRemove(CONFIG.KEYS.WALLPAPER_META);
    // 初始状态下无 IDB 记录，使用当前预设。
    const initialPreset = getCommittedWallpaperUrl() === backgrounds[state.bg];
    // 提交自定义壁纸，成功落盘并更新元数据
    await commitWallpaperSelection(testImg);
    const saved = getCommittedWallpaperUrl() === testImg &&
      ((await getWallpaperSelectionDB())?.wallpaper ?? null) === testImg &&
      JSON.parse(localStorage.getItem(CONFIG.KEYS.WALLPAPER_META)).custom === true;
    // 切换到预设壁纸，清除自定义壁纸记录
    await commitWallpaperSelection(backgrounds[2]);
    const presetSaved = getCommittedWallpaperUrl() === backgrounds[2] && state.bg === 2 &&
      ((await getWallpaperSelectionDB())?.wallpaper ?? null) === null &&
      JSON.parse(localStorage.getItem(CONFIG.KEYS.WALLPAPER_META)).custom === false;
    // 恢复壁纸
    await restoreWallpaper();
    const restored = state.bg === 2 && state.customWallpaper === null;
    return { initialPreset, saved, presetSaved, restored };
  })()`);
      assert.equal(Object.values(checks).every(Boolean), true, JSON.stringify(checks));
      console.log('✅ 现代壁纸选择在 IDB 中正确原子落盘与恢复，预设与自定义切换正常');
    } finally {
      await chrome.close();
      await server.close();
    }
});
