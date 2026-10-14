import assert from 'node:assert/strict';
import { launchSession, waitFor } from './helpers.mjs';

const { server, chrome, evalJS } = await launchSession();
try {
  await waitFor(evalJS, 'typeof getEffectiveCustomWallpaper === "function"');
  const checks = await evalJS(`(async () => {
    const legacy = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=';
    const next = legacy.replace('image/png;', 'image/png;charset=utf-8;');
    const prepare = async () => {
      await removeWallpaperDB(); state.customWallpaper = null;
      storageRemove(CONFIG.KEYS.WALLPAPER_META); storageRemove(CONFIG.KEYS.USER_WALLPAPER);
      localStorage.setItem(CONFIG.KEYS.USER_WALLPAPER, JSON.stringify(legacy));
    };
    await prepare();
    const migrated = await getEffectiveCustomWallpaper() === legacy && await getWallpaperDB() === legacy &&
      localStorage.getItem(CONFIG.KEYS.USER_WALLPAPER) === null && JSON.parse(localStorage.getItem(CONFIG.KEYS.WALLPAPER_META)).custom;
    await prepare();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      const request = put.apply(this,args); request.addEventListener('success', () => request.transaction.abort()); return request;
    };
    let preserved;
    try { preserved = await getEffectiveCustomWallpaper() === legacy && await getWallpaperDB() === null &&
      localStorage.getItem(CONFIG.KEYS.USER_WALLPAPER) === JSON.stringify(legacy); }
    finally { IDBObjectStore.prototype.put = put; }
    const retried = await getEffectiveCustomWallpaper() === legacy && await getWallpaperDB() === legacy &&
      localStorage.getItem(CONFIG.KEYS.USER_WALLPAPER) === null;
    await commitWallpaperSelection(backgrounds[4]);
    localStorage.setItem(CONFIG.KEYS.USER_WALLPAPER, JSON.stringify(legacy));
    const modernWins = await getEffectiveCustomWallpaper() === null && state.bg === 4 &&
      localStorage.getItem(CONFIG.KEYS.USER_WALLPAPER) === null;
    await prepare(); localStorage.setItem(CONFIG.KEYS.USER_WALLPAPER, JSON.stringify('https://example.com/legacy.png'));
    const remote = await getEffectiveCustomWallpaper() === 'https://example.com/legacy.png' && localStorage.getItem(CONFIG.KEYS.USER_WALLPAPER) === null;
    await prepare(); localStorage.setItem(CONFIG.KEYS.USER_WALLPAPER, JSON.stringify(backgrounds[2]));
    await restoreWallpaper();
    const preset = state.bg === 2 && await getEffectiveCustomWallpaper() === null && localStorage.getItem(CONFIG.KEYS.USER_WALLPAPER) === null;
    await prepare();
    const migrating = getEffectiveCustomWallpaper();
    await previewDraftWallpaper(backgrounds[5]); await migrating;
    const concurrent = await getEffectiveCustomWallpaper() === null && state.bg === 5 &&
      JSON.parse(localStorage.getItem(CONFIG.KEYS.WALLPAPER_META)).bg === 5;
    await prepare();
    const changedJob = getEffectiveCustomWallpaper();
    localStorage.setItem(CONFIG.KEYS.USER_WALLPAPER, JSON.stringify(next));
    await changedJob;
    const changedKey = localStorage.getItem(CONFIG.KEYS.USER_WALLPAPER) === JSON.stringify(next);
    await removeWallpaperDB(); state.customWallpaper = null; storageRemove(CONFIG.KEYS.USER_WALLPAPER);
    localStorage.setItem(CONFIG.KEYS.USER_WALLPAPER, '{broken');
    await getEffectiveCustomWallpaper();
    const malformed = localStorage.getItem(CONFIG.KEYS.USER_WALLPAPER) === '{broken' && await getWallpaperDB() === null;
    storageRemove(CONFIG.KEYS.USER_WALLPAPER);
    return {migrated, preserved, retried, modernWins, remote, preset, concurrent, changedKey, malformed};
  })()`);
  assert.equal(Object.values(checks).every(Boolean), true, JSON.stringify(checks));
  console.log('✅ 历史图片成功迁移后删旧键，事务中止保留旧数据，可再次迁移');
  console.log('✅ 现代选择及并发新选择优先，其他标签改写和损坏记录均保留');
} finally {
  await chrome.close();
  await server.close();
}
