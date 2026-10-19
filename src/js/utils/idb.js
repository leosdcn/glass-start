/**
 * IndexedDB 壁纸选择与旧数据迁移
 */
import { CONFIG, backgrounds } from '../config/constants.js';

export const dbPromise = new Promise(resolve => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) { resolve(null); return; }
    try {
        const req = indexedDB.open(CONFIG.IDB.DB_NAME, CONFIG.IDB.VERSION);
        req.onupgradeneeded = e => {
            const openReq = /** @type {IDBOpenDBRequest} */ (e.target);
            const db = openReq.result;
            if (!db.objectStoreNames.contains(CONFIG.IDB.STORES.WALLPAPERS)) {
                db.createObjectStore(CONFIG.IDB.STORES.WALLPAPERS);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    } catch { resolve(null); }
});

/**
 * 读取自定义壁纸兼容键（Data URL 或图片 URL）。
 * @returns {Promise<string|null>} 返回壁纸字符串，不存在或异常时返回 null
 */
export async function getWallpaperDB() {
    try {
        const db = await dbPromise;
        if (!db) return null;
        return new Promise(resolve => {
            const tx = db.transaction(CONFIG.IDB.STORES.WALLPAPERS, 'readonly');
            const store = tx.objectStore(CONFIG.IDB.STORES.WALLPAPERS);
            const req = store.get(CONFIG.IDB.KEYS.CUSTOM_WALLPAPER);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch { return null; }
}

/** @returns {Promise<{wallpaper: string|null, bg: number}|null>} */
export async function getWallpaperSelectionDB() {
    try {
        const db = await dbPromise;
        if (!db) return null;
        return await new Promise(resolve => {
            const tx = db.transaction(CONFIG.IDB.STORES.WALLPAPERS, 'readonly');
            const req = tx.objectStore(CONFIG.IDB.STORES.WALLPAPERS).get(CONFIG.IDB.KEYS.SELECTION);
            req.onsuccess = () => {
                const value = req.result;
                resolve(value && Number.isInteger(value.bg) && value.bg >= 0 &&
                    (value.wallpaper === null || typeof value.wallpaper === 'string') ? value : null);
            };
            req.onerror = tx.onabort = () => resolve(null);
        });
    } catch { return null; }
}

// 请求成功不等于事务提交成功；全部写入或删除均等待 complete。
/** @param {(store: IDBObjectStore) => void} mutate */
async function mutateWallpaperDB(mutate) {
    try {
        const db = await dbPromise;
        if (!db) return false;
        return await new Promise(resolve => {
            const tx = db.transaction(CONFIG.IDB.STORES.WALLPAPERS, 'readwrite');
            tx.oncomplete = () => resolve(true);
            tx.onabort = tx.onerror = () => resolve(false);
            try { mutate(tx.objectStore(CONFIG.IDB.STORES.WALLPAPERS)); }
            catch { tx.abort(); resolve(false); }
        });
    } catch { return false; }
}

/** 
 * 原子提交壁纸内容及预设索引；失败时两者均保持原值。
 * @param {{ wallpaper: string | null; bg: number }} selection
 */
export function setWallpaperSelectionDB(selection) {
    return mutateWallpaperDB(store => {
        store.put(selection, CONFIG.IDB.KEYS.SELECTION);
        if (selection.wallpaper) store.put(selection.wallpaper, CONFIG.IDB.KEYS.CUSTOM_WALLPAPER);
        else store.delete(CONFIG.IDB.KEYS.CUSTOM_WALLPAPER);
    });
}

/** @param {string} dataUrl @returns {Promise<boolean>} */
export function setWallpaperDB(dataUrl) {
    return setWallpaperSelectionDB({ wallpaper: dataUrl, bg: 0 });
}

/** @returns {Promise<boolean>} 删除事务提交成功返回 true。 */
export function removeWallpaperDB() {
    return mutateWallpaperDB(store => {
        store.delete(CONFIG.IDB.KEYS.CUSTOM_WALLPAPER);
        store.delete(CONFIG.IDB.KEYS.SELECTION);
    });
}

/** 
 * 仅在没有现代选择记录时迁移；同一事务读取并写入，保护并发的新选择。
 * @param {string} legacyWallpaper
 * @returns {Promise<{ status: string; selection?: { wallpaper: string | null; bg: number } }>}
 */
export async function migrateLegacyWallpaperDB(legacyWallpaper) {
    try {
        const db = await dbPromise;
        if (!db) return { status: 'failed' };
        return await new Promise(resolve => {
            const tx = db.transaction(CONFIG.IDB.STORES.WALLPAPERS, 'readwrite');
            const store = tx.objectStore(CONFIG.IDB.STORES.WALLPAPERS);
            /** @type {{ status: string; selection?: { wallpaper: string | null; bg: number } }} */
            let result = { status: 'failed' };
            tx.oncomplete = () => resolve(result);
            tx.onerror = tx.onabort = () => resolve({ status: 'failed' });
            const selected = store.get(CONFIG.IDB.KEYS.SELECTION);
            selected.onsuccess = () => {
                if (selected.result !== undefined) {
                    const value = selected.result;
                    if (value && Number.isInteger(value.bg) && value.bg >= 0 && value.bg < backgrounds.length &&
                        (value.wallpaper === null || typeof value.wallpaper === 'string')) {
                        result = { status: 'existing', selection: value };
                    }
                    return;
                }
                const previous = store.get(CONFIG.IDB.KEYS.CUSTOM_WALLPAPER);
                previous.onsuccess = () => {
                    const wallpaper = typeof previous.result === 'string' && previous.result ? previous.result : legacyWallpaper;
                    const preset = backgrounds.indexOf(wallpaper);
                    const selection = { wallpaper: preset >= 0 ? null : wallpaper, bg: Math.max(0, preset) };
                    store.put(selection, CONFIG.IDB.KEYS.SELECTION);
                    if (selection.wallpaper) store.put(selection.wallpaper, CONFIG.IDB.KEYS.CUSTOM_WALLPAPER);
                    else store.delete(CONFIG.IDB.KEYS.CUSTOM_WALLPAPER);
                    result = { status: 'migrated', selection };
                };
            };
        });
    } catch { return { status: 'failed' }; }
}
