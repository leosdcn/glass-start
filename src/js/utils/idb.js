/**
 * ==============================================================================
 * Glass Start — IndexedDB 4K 壁纸存储工具 (src/js/utils/idb.js)
 * ==============================================================================
 */
import { CONFIG } from '../config/constants.js';

export const dbPromise = new Promise(resolve => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) { resolve(null); return; }
    try {
        const req = indexedDB.open(CONFIG.IDB.DB_NAME, CONFIG.IDB.VERSION);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(CONFIG.IDB.STORES.WALLPAPERS)) {
                db.createObjectStore(CONFIG.IDB.STORES.WALLPAPERS);
            }
        };
        req.onsuccess = e => resolve(e.target.result);
        req.onerror = () => resolve(null);
    } catch { resolve(null); }
});

/**
 * 从 IndexedDB 异步读取用户自定义 4K 壁纸 DataURL
 * @returns {Promise<string|null>} 返回壁纸 DataURL 字符串，不存在或异常时返回 null
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

/**
 * 将用户自定义 4K 壁纸 DataURL 异步持久化写入 IndexedDB
 * @param {string} dataUrl - 4K 分辨率优化后的图片 DataURL 字符串
 * @returns {Promise<boolean>} 成功写入返回 true，失败返回 false
 */
export async function setWallpaperDB(dataUrl) {
    try {
        const db = await dbPromise;
        if (!db) return false;
        return new Promise(resolve => {
            const tx = db.transaction(CONFIG.IDB.STORES.WALLPAPERS, 'readwrite');
            const store = tx.objectStore(CONFIG.IDB.STORES.WALLPAPERS);
            const req = store.put(dataUrl, CONFIG.IDB.KEYS.CUSTOM_WALLPAPER);
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        });
    } catch { return false; }
}

/**
 * 从 IndexedDB 中异步彻底清除用户自定义壁纸
 * @returns {Promise<void>}
 */
export async function removeWallpaperDB() {
    try {
        const db = await dbPromise;
        if (!db) return;
        const tx = db.transaction(CONFIG.IDB.STORES.WALLPAPERS, 'readwrite');
        tx.objectStore(CONFIG.IDB.STORES.WALLPAPERS).delete(CONFIG.IDB.KEYS.CUSTOM_WALLPAPER);
    } catch {}
}
