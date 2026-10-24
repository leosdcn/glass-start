/**
 * 壁纸状态管理与即选即存持久化
 */
import { CONFIG, backgrounds } from '../config/constants.js';
import { storageGet, storageSet, storageRemove } from '../utils/helpers.js';
import { getWallpaperDB, getWallpaperSelectionDB, setWallpaperSelectionDB, migrateLegacyWallpaperDB } from '../utils/idb.js';
import { state, modalState } from '../state/store.js';
import { dom } from '../state/dom.js';
import { applyWallpaper, getPreparedWallpaperImage } from '../core/wallpaper-renderer.js';
import { showConfirm } from '../core/dialogs.js';

let wallpaperSelectionId = 0;
/** @type {HTMLImageElement | null} */
let pendingPreviewImage = null;
let wallpaperCommitQueue = Promise.resolve();
let latestSelectionPromise = Promise.resolve(true);
/** @type {(() => void) | null} */
let cancelPendingPreview = null;
/** @type {{ url: string | null, id: number, promise: Promise<boolean> } | null} */
let pendingSelection = null;

function beginWallpaperSelection() {
    wallpaperSelectionId++;
    cancelPendingPreview?.();
    cancelPendingPreview = null;
    if (pendingPreviewImage) {
        pendingPreviewImage.onload = pendingPreviewImage.onerror = null;
        pendingPreviewImage = null;
    }
    return wallpaperSelectionId;
}

/**
 * @param {string | null} targetWallpaper
 * @param {number} selectionId
 * @returns {Promise<boolean>}
 */
function commitCurrentSelection(targetWallpaper, selectionId) {
    let result = false;
    wallpaperCommitQueue = wallpaperCommitQueue.catch(() => {}).then(async () => {
        if (selectionId === wallpaperSelectionId) {
            result = await commitWallpaperSelection(targetWallpaper);
        }
    });
    return wallpaperCommitQueue.then(() => result);
}

/** @type {Promise<unknown> | null} */
let migrationPromise = null;
/** @param {{ bg: number, wallpaper?: string | null }} selection */
function saveWallpaperHints(selection) {
    if (storageGet(CONFIG.KEYS.BG) !== selection.bg) storageSet(CONFIG.KEYS.BG, selection.bg);
    const meta = storageGet(CONFIG.KEYS.WALLPAPER_META);
    if (!meta || meta.custom !== !!selection.wallpaper || meta.bg !== selection.bg) {
        storageSet(CONFIG.KEYS.WALLPAPER_META, { custom: !!selection.wallpaper, bg: selection.bg });
    }
}

/** 迁移失败保留原键；只删除本次读取的版本，不删除其他标签的新写入。 */
function migrateLegacyWallpaper() {
    if (migrationPromise) return migrationPromise;
    const startedAt = wallpaperSelectionId;
    migrationPromise = (async () => {
        let raw, legacy;
        try {
            raw = localStorage.getItem(CONFIG.KEYS.USER_WALLPAPER);
            legacy = raw ? JSON.parse(raw) : null;
        } catch { return false; }
        if (typeof legacy !== 'string') return false;
        const dataImage = /^data:image\//i.test(legacy) && legacy.includes(',');
        let remoteImage = false;
        try { remoteImage = ['http:', 'https:'].includes(new URL(legacy).protocol); } catch {}
        if (!dataImage && !remoteImage && !backgrounds.includes(legacy)) return false;
        const result = await migrateLegacyWallpaperDB(legacy);
        if (result.status === 'failed') return false;
        if (localStorage.getItem(CONFIG.KEYS.USER_WALLPAPER) === raw) storageRemove(CONFIG.KEYS.USER_WALLPAPER);
        if (startedAt === wallpaperSelectionId && result.selection) saveWallpaperHints(result.selection);
        return true;
    })().catch(() => false).finally(() => { migrationPromise = null; });
    return migrationPromise;
}

/**
 * 迁移旧数据后优先读取 IDB 选择记录，缺失时兼容内存与旧存储键。
 * @returns {Promise<string|null>}
 */
export async function getEffectiveCustomWallpaper() {
    await migrateLegacyWallpaper();
    const selection = await getWallpaperSelectionDB();
    if (selection) return selection.wallpaper;
    return getLegacyCustomWallpaper();
}

async function getLegacyCustomWallpaper() {
    return state.customWallpaper || await getWallpaperDB() || storageGet(CONFIG.KEYS.USER_WALLPAPER, null);
}

/**
 * 判断给定 URL 是否命中预设壁纸 backgrounds[] 数组；返回索引，未命中返回 -1。
 * @param {string|null|undefined} url
 * @returns {number}
 */
function findPresetBgIndex(url) {
    if (!url || typeof url !== 'string') return -1;
    if (/^(data:|https?:)/i.test(url)) return -1;
    return backgrounds.indexOf(url);
}

/**
 * 原子保存无自定义图片的选择，成功后同步内存与首帧提示。
 * @param {number} [bg=state.bg] - 保留或切换到的预设索引
 * @returns {Promise<boolean>}
 */
export async function clearCustomWallpaper(bg = state.bg) {
    beginWallpaperSelection();
    await wallpaperCommitQueue.catch(() => {});
    const selection = { wallpaper: null, bg };
    if (!await setWallpaperSelectionDB(selection)) return false;
    state.customWallpaper = null;
    state.bg = bg;
    storageRemove(CONFIG.KEYS.USER_WALLPAPER);
    saveWallpaperHints(selection);
    return true;
}

/**
 * 刷新外观壁纸 Tab 中的壁纸来源文字提示与「恢复默认」按钮显隐状态
 * @param {string|null} [customWallpaperOverride]
 * @returns {Promise<void>}
 */
export async function updateWallpaperStatusUI(customWallpaperOverride) {
    const resolveBg = customWallpaperOverride !== undefined
        ? customWallpaperOverride
        : (modalState.draftWallpaper !== undefined
            ? modalState.draftWallpaper
            : (await getEffectiveCustomWallpaper()));
    const isCustom = !!resolveBg && findPresetBgIndex(resolveBg) === -1;
    if (!dom.wallpaperStatus || !dom.resetBgBtn) return;
    if (isCustom) {
        dom.wallpaperStatus.textContent = '已使用自定义壁纸';
        dom.wallpaperStatus.className = 'text-2xs text-emerald-400/90 font-medium';
        dom.resetBgBtn.classList.remove('hidden');
    } else {
        dom.wallpaperStatus.textContent = '';
        dom.wallpaperStatus.className = 'hidden';
        dom.resetBgBtn.classList.add('hidden');
    }
}

/**
 * 刷新预设壁纸库卡片的激活（Active）高亮选中状态
 * @param {string|null} [customWallpaperOverride]
 * @returns {void}
 */
export function updatePresetBgCardsUI(customWallpaperOverride) {
    const currentBg = customWallpaperOverride !== undefined
        ? (customWallpaperOverride || backgrounds[state.bg] || '')
        : (storageGet(CONFIG.KEYS.USER_WALLPAPER) || backgrounds[state.bg] || '');
    const container = dom.presetWallpaperGrid;
    if (!container) return;
    renderPresetWallpapers();
    container.querySelectorAll('.preset-bg-card').forEach(card => {
        const cardEl = card instanceof HTMLElement ? card : null;
        const bg = cardEl?.dataset.bg;
        card.classList.toggle('active', bg === currentBg);
        card.setAttribute('aria-pressed', String(bg === currentBg));
    });
}

/**
 * 提交壁纸与预设索引，等待 IDB 事务完成后更新已保存状态。
 * @param {string|null} targetWallpaper
 * @returns {Promise<boolean>}
 */
export async function commitWallpaperSelection(targetWallpaper) {
    const presetIdx = findPresetBgIndex(targetWallpaper);
    const selection = { wallpaper: presetIdx >= 0 ? null : (targetWallpaper || null), bg: Math.max(0, presetIdx) };
    // 以实际持久化记录判定相同选择，避免内存默认值或其他标签的写入造成误判。
    const existing = await getWallpaperSelectionDB();
    if ((!existing || existing.wallpaper !== selection.wallpaper || existing.bg !== selection.bg)
        && !await setWallpaperSelectionDB(selection)) return false;
    // IDB 是选择结果的持久化真理源；LocalStorage 仅保留轻量首屏提示。
    try {
        if (localStorage.getItem(CONFIG.KEYS.USER_WALLPAPER) !== null) storageRemove(CONFIG.KEYS.USER_WALLPAPER);
    } catch {}
    saveWallpaperHints(selection);
    state.customWallpaper = selection.wallpaper;
    state.bg = selection.bg;
    modalState.initialWallpaper = targetWallpaper;
    return true;
}

/** 等待当前选择及落盘，用于保存按钮阻止未完成或失败的保存。 */
export async function flushWallpaperSelection() {
    let current;
    do {
        current = latestSelectionPromise;
        await current;
    } while (current !== latestSelectionPromise);
    return !modalState.wallpaperSaveFailed;
}

/** 
 * 即选即存；失败恢复此前已提交的壁纸，草稿可重新选择重试。
 * @param {string | null} urlStr
 */
export function previewDraftWallpaper(urlStr) {
    if (pendingSelection?.id === wallpaperSelectionId && pendingSelection.url === urlStr) {
        return pendingSelection.promise;
    }
    const selectionId = beginWallpaperSelection();
    return previewWallpaperSelection(urlStr, selectionId);
}

/** @param {string | null} urlStr @param {number} selectionId */
function previewWallpaperSelection(urlStr, selectionId) {
    modalState.draftWallpaper = urlStr;
    modalState.wallpaperSaveFailed = false;
    const selection = { url: urlStr, id: selectionId, promise: Promise.resolve(false) };
    pendingSelection = selection;
    latestSelectionPromise = selection.promise = (async () => {
        let preparedImage = urlStr ? getPreparedWallpaperImage(urlStr) : null;
        if (urlStr || !getPreparedWallpaperImage(backgrounds[0])) {
            preparedImage = preparedImage || await new Promise(resolve => {
                const img = new Image();
                pendingPreviewImage = img;
                cancelPendingPreview = () => resolve(null);
                img.onload = async () => {
                    try {
                        if (typeof img.decode === 'function') await img.decode();
                        resolve(img);
                    } catch { resolve(null); }
                };
                img.onerror = () => resolve(null);
                img.src = urlStr || backgrounds[0];
            });
            if (selectionId !== wallpaperSelectionId) return false;
            if (pendingPreviewImage) {
                pendingPreviewImage.onload = pendingPreviewImage.onerror = null;
                pendingPreviewImage = null;
            }
            cancelPendingPreview = null;
            if (!preparedImage) {
                modalState.wallpaperSaveFailed = true;
                modalState.draftWallpaper = state.customWallpaper || backgrounds[state.bg];
                showConfirm('无法加载该图片，请检查图片是否有效或恢复网络后重试。', null, '图片无法加载');
                return false;
            }
        }
        if (selectionId !== wallpaperSelectionId) return false;
        applyWallpaper(urlStr || backgrounds[0], true, preparedImage);
        updateWallpaperStatusUI(urlStr);
        updatePresetBgCardsUI(urlStr);
        const saved = await commitCurrentSelection(urlStr, selectionId);
        if (selectionId !== wallpaperSelectionId) return false;
        modalState.wallpaperSaveFailed = !saved;
        if (!saved) {
            const previous = state.customWallpaper || backgrounds[state.bg];
            modalState.draftWallpaper = previous;
            applyWallpaper(previous, true);
            updateWallpaperStatusUI(previous);
            updatePresetBgCardsUI(previous);
            showConfirm('壁纸未能保存，原有壁纸已保留。请检查浏览器存储空间或权限后重新选择。', null, '壁纸保存失败');
        }
        return saved;
    })().finally(() => {
        if (pendingSelection === selection) pendingSelection = null;
    });
    return latestSelectionPromise;
}

/** 重置为默认系统壁纸，等待持久化结果。 */
export function resetDraftWallpaper() {
    return previewDraftWallpaper(null);
}

/** 快捷键轮播也通过同一事务保存，不提前删除自定义壁纸。 */
export async function switchBg() {
    const selectionId = wallpaperSelectionId;
    await flushWallpaperSelection();
    const custom = await getEffectiveCustomWallpaper();
    if (selectionId !== wallpaperSelectionId) return false;
    const saved = await previewDraftWallpaper(custom ? backgrounds[0] : backgrounds[(state.bg + 1) % backgrounds.length]);
    if (saved) preloadNextBg();
    return saved;
}

/**
 * 预加载下一张预设壁纸，减少切换时等待。
 * @returns {void}
 */
export function preloadNextBg() {
    if (state.customWallpaper) return;
    if (typeof navigator !== 'undefined' && (navigator.connection?.saveData || navigator.connection?.effectiveType === '2g')) {
        return;
    }
    if (typeof window !== 'undefined' && window.innerWidth <= CONFIG.NAV.TABLET_BREAKPOINT) {
        return;
    }
    const nextIdx = (state.bg + 1) % backgrounds.length;
    const nextBgUrl = backgrounds[nextIdx];
    if (nextBgUrl) {
        const img = new Image();
        img.src = nextBgUrl;
    }
}

/**
 * 渲染设置面板中预设高清壁纸缩略图网格卡片
 * @returns {void}
 */
export function renderPresetWallpapers() {
    const grid = dom.presetWallpaperGrid;
    if (!grid || grid.hasChildNodes()) return;
    const titles = ['暮色山峦', '溪谷晨曦', '星空雪山', '峰峦破晓', '天际立面', '极简回廊', '紫韵流光', '梦幻流彩'];
    grid.innerHTML = titles.map((title, i) => {
        const bg = `./wallpapers/bg${i + 1}.avif`;
        const thumb = `./wallpapers/bg${i + 1}-thumb.avif`;
        const fullTitle = i === 0 ? `${title}（系统默认）` : title;
        return `<button type="button" class="preset-bg-card group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-bg="${bg}" data-title="${title}" title="${fullTitle}" aria-pressed="false">
            <span class="preset-bg-image">
                <img data-src="${thumb}" src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2010'%3E%3C/svg%3E" width="${CONFIG.UI.WALLPAPER_CARD_WIDTH}" height="${CONFIG.UI.WALLPAPER_CARD_HEIGHT}" alt="" loading="lazy" decoding="async" draggable="false">
                <span class="preset-bg-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg></span>
            </span>
            <span class="preset-bg-title">${title}</span>
        </button>`;
    }).join('');
}

export async function restoreWallpaper() {
    await migrateLegacyWallpaper();
    const selection = await getWallpaperSelectionDB();
    const savedBg = selection ? selection.bg : storageGet(CONFIG.KEYS.BG);
    if (savedBg !== null && typeof savedBg === 'number' && savedBg >= 0 && savedBg < backgrounds.length) {
        state.bg = savedBg;
    }

    let customBg = selection ? selection.wallpaper : await getLegacyCustomWallpaper();
    const legacyPresetIdx = findPresetBgIndex(customBg);
    if (legacyPresetIdx >= 0) {
        state.bg = legacyPresetIdx;
        storageSet(CONFIG.KEYS.BG, legacyPresetIdx);
        await clearCustomWallpaper();
        customBg = null;
    }
    if (customBg) {
        state.customWallpaper = customBg;
        applyWallpaper(customBg, false);
    } else {
        applyWallpaper(backgrounds[state.bg] || backgrounds[0], false);
    }
}

/**
 * @param {File} file
 */
export function uploadWallpaper(file) {
    if (!file.type.startsWith('image/')) {
        showConfirm('请选择有效的图片文件（JPG / PNG / WebP 等）。', null, '格式错误');
        return false;
    }
    // 选择文件时就占用版本，不能等读取／压缩完成后再把旧上传当成新选择。
    const selectionId = beginWallpaperSelection();
    modalState.wallpaperSaveFailed = false;
    const reader = new FileReader();
    /** @type {HTMLImageElement | null} */
    let image = null;
    /** @type {Promise<string | null>} */
    const prepared = new Promise(resolve => {
        /** @param {string | null} value */
        const finish = value => {
            reader.onload = reader.onerror = reader.onabort = null;
            if (image) {
                image.onload = image.onerror = null;
                image.src = '';
                image = null;
            }
            resolve(value);
        };
        cancelPendingPreview = () => {
            finish(null);
            if (reader.readyState === FileReader.LOADING) reader.abort();
        };
        const fail = () => {
            if (selectionId === wallpaperSelectionId) {
                modalState.wallpaperSaveFailed = true;
                showConfirm('无法读取或处理该图片，请重新选择。', null, '图片处理失败');
            }
            finish(null);
        };
        reader.onerror = reader.onabort = fail;
        reader.onload = ev => {
            if (selectionId !== wallpaperSelectionId) { finish(null); return; }
            const target = /** @type {FileReader|null} */ (ev.target);
            const dataUrl = typeof target?.result === 'string' ? target.result : '';
            if (!dataUrl) { fail(); return; }
            const img = new Image();
            image = img;
            img.onload = () => {
                if (selectionId !== wallpaperSelectionId) { finish(null); return; }
                let canvas;
                try {
                    const MAX_WIDTH = CONFIG.APPEARANCE.MAX_UPLOAD_WIDTH;
                    const MAX_HEIGHT = CONFIG.APPEARANCE.MAX_UPLOAD_HEIGHT;
                    let width = img.width;
                    let height = img.height;

                    if (width > MAX_WIDTH || height > MAX_HEIGHT) {
                        if (width / height > MAX_WIDTH / MAX_HEIGHT) {
                            height = Math.round((height * MAX_WIDTH) / width);
                            width = MAX_WIDTH;
                        } else {
                            width = Math.round((width * MAX_HEIGHT) / height);
                            height = MAX_HEIGHT;
                        }
                    }

                    canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(img, 0, 0, width, height);
                        const compressedDataUrl = canvas.toDataURL('image/jpeg', CONFIG.APPEARANCE.JPEG_QUALITY);
                        finish(compressedDataUrl);
                    } else fail();
                } catch { fail(); }
                finally {
                    if (canvas) canvas.width = canvas.height = 0;
                }
            };
            img.onerror = fail;
            img.src = dataUrl;
        };
        try { reader.readAsDataURL(file); } catch { fail(); }
    });
    latestSelectionPromise = prepared.then(url => {
        if (selectionId !== wallpaperSelectionId) return false;
        cancelPendingPreview = null;
        return url ? previewWallpaperSelection(url, selectionId) : false;
    });
}
