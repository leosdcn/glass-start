/**
 * IndexedDB 壁纸持久化存储
 */
import { CONFIG } from '../config/constants.js';

/** @type {IDBDatabase | null} */
let activeDb = null;
/** @type {Promise<IDBDatabase | null> | null} */
let openingPromise = null;

/** @returns {Promise<IDBDatabase | null>} */
function getDB() {
    if (activeDb) return Promise.resolve(activeDb);
    if (openingPromise) return openingPromise;
    if (typeof window === 'undefined' || !('indexedDB' in window)) return Promise.resolve(null);

    openingPromise = new Promise(resolve => {
        try {
            const req = indexedDB.open(CONFIG.IDB.DB_NAME, CONFIG.IDB.VERSION);
            req.onupgradeneeded = e => {
                const openReq = /** @type {IDBOpenDBRequest} */ (e.target);
                const db = openReq.result;
                if (!db.objectStoreNames.contains(CONFIG.IDB.STORES.WALLPAPERS)) {
                    db.createObjectStore(CONFIG.IDB.STORES.WALLPAPERS);
                }
            };
            req.onsuccess = () => {
                activeDb = req.result;
                activeDb.onversionchange = () => {
                    activeDb?.close();
                    activeDb = null;
                };
                activeDb.onclose = () => { activeDb = null; };
                openingPromise = null;
                resolve(activeDb);
            };
            req.onblocked = e => {
                e?.preventDefault?.();
                openingPromise = null;
                resolve(null);
            };
            req.onerror = e => {
                e?.preventDefault?.();
                openingPromise = null;
                resolve(null);
            };
        } catch {
            openingPromise = null;
            resolve(null);
        }
    });
    return openingPromise;
}

function resetDB() {
    if (activeDb) {
        try { activeDb.close(); } catch {}
        activeDb = null;
    }
}

/** @returns {Promise<{wallpaper: string|null, bg: number}|null>} */
export async function getWallpaperSelectionDB() {
    try {
        const db = await getDB();
        if (!db) return null;
        return await new Promise(resolve => {
            const tx = db.transaction(CONFIG.IDB.STORES.WALLPAPERS, 'readonly');
            const req = tx.objectStore(CONFIG.IDB.STORES.WALLPAPERS).get(CONFIG.IDB.KEYS.SELECTION);
            req.onsuccess = () => {
                const value = req.result;
                resolve(value && Number.isInteger(value.bg) && value.bg >= 0 &&
                    (value.wallpaper === null || typeof value.wallpaper === 'string') ? value : null);
            };
            const handleError = (/** @type {Event} */ e) => {
                e?.preventDefault?.();
                resolve(null);
            };
            req.onerror = handleError;
            tx.onabort = handleError;
        });
    } catch {
        resetDB();
        return null;
    }
}

// 请求成功不等于事务提交成功；全部写入或删除均等待 complete。
/** @param {(store: IDBObjectStore) => void} mutate */
async function mutateWallpaperDB(mutate) {
    try {
        const db = await getDB();
        if (!db) return false;
        return await new Promise(resolve => {
            const tx = db.transaction(CONFIG.IDB.STORES.WALLPAPERS, 'readwrite');
            tx.oncomplete = () => resolve(true);
            const handleFailure = (/** @type {Event} */ e) => {
                e?.preventDefault?.();
                resolve(false);
            };
            tx.onabort = handleFailure;
            tx.onerror = handleFailure;
            try { mutate(tx.objectStore(CONFIG.IDB.STORES.WALLPAPERS)); }
            catch { tx.abort(); resolve(false); }
        });
    } catch {
        resetDB();
        return false;
    }
}

/** 
 * 原子提交壁纸内容及预设索引；失败时两者均保持原值。
 * @param {{ wallpaper: string | null; bg: number }} selection
 */
export function setWallpaperSelectionDB(selection) {
    return mutateWallpaperDB(store => {
        store.put(selection, CONFIG.IDB.KEYS.SELECTION);
    });
}

/** @returns {Promise<boolean>} 删除事务提交成功返回 true。 */
export function removeWallpaperDB() {
    return mutateWallpaperDB(store => {
        store.delete(CONFIG.IDB.KEYS.SELECTION);
    });
}
