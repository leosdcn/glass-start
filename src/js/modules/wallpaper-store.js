/** 壁纸选择持久化队列、主题提示同步与启动恢复。 */
import { CONFIG, backgrounds } from '../config/constants.js';
import { normalizeMaskOpacity } from '../config/backgrounds.js';
import { storageGet, storageSet } from '../utils/storage.js';
import { getWallpaperSelectionDB, setWallpaperSelectionDB } from '../utils/idb.js';
import { state, modalState } from '../state/store.js';
import { applyBgEffects, applyWallpaper, captureWallpaperFrame, getPreparedWallpaperImage } from '../core/wallpaper-renderer.js';
import { sampleCustomWallpaperTheme } from '../core/theme-engine.js';

export function getSavedMaskOpacity() {
    return normalizeMaskOpacity(storageGet(CONFIG.KEYS.MASK_OPACITY));
}

/** @type {ReturnType<typeof captureWallpaperFrame> | null} */
let wallpaperDraftBase = null;
/** @type {Promise<unknown>} */
let wallpaperCommitQueue = Promise.resolve();
let wallpaperRestore = Promise.resolve();

export function getWallpaperDraftBase() {
    return wallpaperDraftBase;
}

export function captureWallpaperDraftBase() {
    if (!wallpaperDraftBase || getPreparedWallpaperImage(getCommittedWallpaperUrl())) {
        wallpaperDraftBase = captureWallpaperFrame();
    }
}

export function clearWallpaperDraftBase() {
    wallpaperDraftBase = null;
}

export async function waitForWallpaperCommitQueue() {
    await wallpaperRestore;
    await wallpaperCommitQueue;
}

export async function waitForWallpaperRestore() {
    await wallpaperRestore;
}

/** @param {string} url */
export function getRetainedWallpaperImage(url) {
    return getPreparedWallpaperImage(url) ?? (wallpaperDraftBase?.url === url ? wallpaperDraftBase.image : null);
}

/** @param {HTMLImageElement | null} [image] */
export function syncCommittedWallpaperHints(image) {
    const { bg, customWallpaper } = state;
    const indexSaved = storageGet(CONFIG.KEYS.BG) === bg || storageSet(CONFIG.KEYS.BG, bg);
    const sampleImage = customWallpaper ? image ?? getRetainedWallpaperImage(customWallpaper) : null;
    const mask = sampleImage ? storageGet(CONFIG.KEYS.MASK_OPACITY) : null;
    const sample = sampleImage ? sampleCustomWallpaperTheme(sampleImage, normalizeMaskOpacity(mask)) : null;
    const next = {
        custom: !!customWallpaper, bg,
        ...(sample ? { appearance: { mask, aspect: sample.aspect, isLight: sample.theme.isLight,
            themeColor: 'themeColor' in sample.theme ? sample.theme.themeColor : undefined, tint: sample.tint } } : {})
    };
    const meta = storageGet(CONFIG.KEYS.WALLPAPER_META);
    const metadataSaved = JSON.stringify(meta) === JSON.stringify(next) || storageSet(CONFIG.KEYS.WALLPAPER_META, next);
    return indexSaved && metadataSaved;
}

/** @template T @param {() => Promise<T>} task */
function withWallpaperLock(task) {
    const locks = globalThis.navigator?.locks;
    return locks ? locks.request(CONFIG.KEYS.WALLPAPER_META, task) : task();
}

/** @param {number} opacity @param {() => boolean} isCurrent */
export async function commitWallpaperDimming(opacity, isCurrent) {
    const mask = normalizeMaskOpacity(opacity);
    return withWallpaperLock(async () => {
        const saved = await getWallpaperSelectionDB();
        if (!isCurrent() || !storageSet(CONFIG.KEYS.MASK_OPACITY, mask)) return false;
        const previous = getCommittedWallpaperUrl();
        if (saved) {
            syncCommittedWallpaper(saved);
            syncCommittedWallpaperHints();
        }
        applyBgEffects(mask);
        if (modalState.draftWallpaper === previous && previous !== getCommittedWallpaperUrl()) {
            renderCommittedWallpaper(false);
        }
        return true;
    }).catch(() => false);
}

export function getCommittedWallpaperUrl() {
    return state.customWallpaper || backgrounds[state.bg] || backgrounds[0];
}

/** @param {boolean} animate */
export function renderCommittedWallpaper(animate) {
    const url = getCommittedWallpaperUrl();
    applyWallpaper(url, animate, getRetainedWallpaperImage(url), image => {
        withWallpaperLock(async () => {
            const saved = await getWallpaperSelectionDB();
            if (saved?.wallpaper === url && url === getCommittedWallpaperUrl()) syncCommittedWallpaperHints(image);
        }).catch(() => {});
    });
}

/** @param {{ bg: number, wallpaper: string | null }} selection */
export function syncCommittedWallpaper(selection) {
    state.bg = backgrounds[selection.bg] ? selection.bg : 0;
    state.customWallpaper = selection.wallpaper;
}

/**
 * 判断给定 URL 是否命中预设壁纸 backgrounds[] 数组；返回索引，未命中返回 -1。
 * @param {string|null|undefined} url
 * @returns {number}
 */
export function findPresetBgIndex(url) {
    if (!url || typeof url !== 'string') return -1;
    if (/^(data:|https?:)/i.test(url)) return -1;
    return backgrounds.indexOf(url);
}

/**
 * 所有写入按序执行。事务已发起时，完成后仍需同步已提交选择。
 * @param {string} targetWallpaper
 * @param {() => boolean} [isCurrent]
 * @param {HTMLImageElement} [preparedImage] - 即时切换成功后发布已准备的图片
 */
export function commitWallpaperSelection(targetWallpaper, isCurrent = () => true, preparedImage) {
    const presetIdx = findPresetBgIndex(targetWallpaper);
    const selection = { wallpaper: presetIdx >= 0 ? null : targetWallpaper, bg: Math.max(0, presetIdx) };
    return enqueueWallpaperSelection(selection, isCurrent, () => {
        syncCommittedWallpaperHints(preparedImage);
        // 已在锁内完成首帧提示，现成图片可以直接发布，无需在取色后再读一次记录。
        if (preparedImage) applyWallpaper(targetWallpaper, true, preparedImage);
        return true;
    });
}

/**
 * @template T
 * @param {{ wallpaper: string | null, bg: number }} selection
 * @param {() => boolean} isCurrent
 * @param {() => T} onCommitted
 * @returns {Promise<T | false>}
 */
export function enqueueWallpaperSelection(selection, isCurrent, onCommitted) {
    const result = wallpaperCommitQueue.then(() => withWallpaperLock(async () => {
        // 用实际记录判定相同选择，其他标签的写入也纳入比较。
        const existing = await getWallpaperSelectionDB();
        if (!isCurrent()) return false;
        if ((!existing || existing.wallpaper !== selection.wallpaper || existing.bg !== selection.bg)
            && !await setWallpaperSelectionDB(selection)) return false;
        syncCommittedWallpaper(selection);
        return onCommitted();
    })).catch(() => /** @type {const} */ (false));
    wallpaperCommitQueue = result;
    return result;
}

export function restoreWallpaper() {
    applyBgEffects(getSavedMaskOpacity());
    wallpaperRestore = (async () => {
        const selection = await getWallpaperSelectionDB();
        if (selection) {
            syncCommittedWallpaper(selection);
        } else {
            const savedBg = storageGet(CONFIG.KEYS.BG);
            if (typeof savedBg === 'number' && backgrounds[savedBg]) state.bg = savedBg;
        }
        renderCommittedWallpaper(false);
    })();
    return wallpaperRestore;
}
