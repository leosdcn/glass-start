import { t } from '../core/i18n.js';
/**
 * 壁纸选择、预览与持久化，以及背景暗度显示；设置模块决定草稿何时提交或取消。
 */
import { CONFIG, backgrounds } from '../config/constants.js';
import { PRESET_WALLPAPERS } from '../config/backgrounds.js';
import { escapeHtml } from '../utils/helpers.js';
import { storageGet, storageSet } from '../utils/storage.js';
import { getWallpaperSelectionDB, setWallpaperSelectionDB } from '../utils/idb.js';
import { state, modalState } from '../state/store.js';
import { dom } from '../state/dom.js';
import { applyWallpaper, captureWallpaperFrame, getPreparedWallpaperImage, restoreWallpaperFrame, setWallpaperDimming } from '../core/wallpaper-renderer.js';
import { sampleCustomWallpaperTheme } from '../core/theme-engine.js';
import { showConfirm } from '../core/dialogs.js';

/** @type {number | null} */
let bgEffectsRafId = null;
/** @type {number | null} */
let pendingBgEffects = null;
/** @type {{ element: HTMLElement, opacity: number } | null} */
let lastBgEffects = null;

/** @param {unknown} value */
function normalizeMaskOpacity(value) {
    const opacity = value == null ? NaN : parseInt(String(value), 10);
    return Number.isFinite(opacity)
        ? Math.max(0, Math.min(CONFIG.APPEARANCE.MAX_MASK_OPACITY, opacity))
        : CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY;
}

export function getSavedMaskOpacity() {
    return normalizeMaskOpacity(storageGet(CONFIG.KEYS.MASK_OPACITY));
}

/** @param {number} op */
function renderBgEffects(op) {
    setWallpaperDimming(op);
    const bgOverlay = dom.bgOverlay;
    if (!bgOverlay) return;
    const sameOverlay = lastBgEffects?.element === bgOverlay;
    if (!sameOverlay) {
        const trSec = `${CONFIG.TIMERS.BG_OVERLAY_TRANSITION / 1000}s`;
        bgOverlay.style.transition = `background-color ${trSec} ease`;
    }
    if (!sameOverlay || lastBgEffects?.opacity !== op) {
        bgOverlay.style.backgroundColor = `rgba(0,0,0,${op / 100})`;
    }
    lastBgEffects = { element: bgOverlay, opacity: op };
}

/**
 * @param {number | string} opacity
 * @param {boolean} [defer]
 */
export function applyBgEffects(opacity, defer = false) {
    const op = normalizeMaskOpacity(opacity);
    if (defer) {
        pendingBgEffects = op;
        if (bgEffectsRafId === null) {
            bgEffectsRafId = requestAnimationFrame(() => {
                bgEffectsRafId = null;
                const effects = pendingBgEffects;
                pendingBgEffects = null;
                if (effects !== null) renderBgEffects(effects);
            });
        }
    } else {
        if (bgEffectsRafId !== null) cancelAnimationFrame(bgEffectsRafId);
        bgEffectsRafId = null;
        pendingBgEffects = null;
        renderBgEffects(op);
    }
    const maskOpacityVal = dom.maskOpacityVal;
    const maskOpacityInput = dom.maskOpacityInput;

    if (maskOpacityVal) maskOpacityVal.textContent = `${op}%`;
    if (maskOpacityInput) {
        if (maskOpacityInput.value !== String(op)) maskOpacityInput.value = String(op);
        maskOpacityInput.setAttribute('aria-valuenow', String(op));
        maskOpacityInput.setAttribute('aria-valuetext', `${op}%`);
    }
}

/** 关闭设置时同步落定尚未绘制的暗度预览。 */
export function flushBgEffects() {
    if (pendingBgEffects !== null) applyBgEffects(pendingBgEffects);
}

/** @typedef {import('../types').WallpaperSelectionTask} WallpaperTask */
/** @type {WallpaperTask | null} */
let liveWallpaperTask = null;
/** @type {ReturnType<typeof captureWallpaperFrame> | null} */
let wallpaperDraftBase = null;
let wallpaperCommitQueue = Promise.resolve(true);
let wallpaperRestore = Promise.resolve();

/** @param {WallpaperTask['mode']} mode */
function currentWallpaperTask(mode) {
    return mode === 'draft' ? modalState.wallpaperSelection : liveWallpaperTask;
}

/** @param {WallpaperTask['mode']} mode */
function discardWallpaperSelection(mode) {
    const discarded = currentWallpaperTask(mode);
    if (mode === 'draft') {
        modalState.wallpaperSelection = null;
        showWallpaperError('');
    } else {
        liveWallpaperTask = null;
    }
    discarded?.cancel?.();
    discarded?.pause?.resume();
}

export function closeWallpaperDraft() {
    discardWallpaperSelection('draft');
    wallpaperDraftBase = null;
}

/** 暂停当前意图的发布。重置失败后可继续准备，关闭会话时由丢弃操作解除暂停。 */
export function pauseWallpaperDraft() {
    const task = modalState.wallpaperSelection;
    if (!task) return;
    let resume = () => {};
    /** @type {Promise<void>} */
    const done = new Promise(resolve => {
        resume = () => {
            task.pause = undefined;
            resolve();
        };
    });
    task.pause = { done, resume };
    return resume;
}

/** @param {WallpaperTask['mode']} mode @param {string | null} url */
function beginWallpaperSelection(mode, url) {
    discardWallpaperSelection(mode);
    /** @type {WallpaperTask} */
    const task = { mode, url, promise: Promise.resolve(false) };
    if (mode === 'draft') modalState.wallpaperSelection = task;
    else liveWallpaperTask = task;
    return task;
}

/** @param {WallpaperTask} task @param {Promise<boolean>} promise */
function trackWallpaperSelection(task, promise) {
    task.promise = promise.finally(() => {
        if (!task.retryImage) task.url = null;
        task.cancel = undefined;
    });
    return task.promise;
}

/** @param {string} url */
function getRetainedWallpaperImage(url) {
    return getPreparedWallpaperImage(url) ?? (wallpaperDraftBase?.url === url ? wallpaperDraftBase.image : null);
}

/** @param {HTMLImageElement | null} [image] */
function syncCommittedWallpaperHints(image = getRetainedWallpaperImage(getCommittedWallpaperUrl())) {
    const { bg, customWallpaper } = state;
    if (storageGet(CONFIG.KEYS.BG) !== bg) storageSet(CONFIG.KEYS.BG, bg);
    const mask = storageGet(CONFIG.KEYS.MASK_OPACITY);
    const sample = customWallpaper && image ? sampleCustomWallpaperTheme(image, normalizeMaskOpacity(mask)) : null;
    const next = {
        custom: !!customWallpaper, bg,
        ...(sample ? { appearance: { mask, isLight: sample.theme.isLight,
            themeColor: 'themeColor' in sample.theme ? sample.theme.themeColor : undefined, tint: sample.tint } } : {})
    };
    const meta = storageGet(CONFIG.KEYS.WALLPAPER_META);
    if (JSON.stringify(meta) !== JSON.stringify(next)) storageSet(CONFIG.KEYS.WALLPAPER_META, next);
}

/** @param {number} opacity */
export function commitWallpaperDimming(opacity) {
    opacity = normalizeMaskOpacity(opacity);
    if (!storageSet(CONFIG.KEYS.MASK_OPACITY, opacity)) return false;
    syncCommittedWallpaperHints();
    applyBgEffects(opacity);
    return true;
}

export function getCommittedWallpaperUrl() {
    return state.customWallpaper || backgrounds[state.bg] || backgrounds[0];
}

/** @param {boolean} animate @param {HTMLImageElement | null} [preparedImage] */
function renderCommittedWallpaper(animate, preparedImage = null) {
    const url = getCommittedWallpaperUrl();
    applyWallpaper(url, animate, preparedImage ?? getRetainedWallpaperImage(url), image => {
        if (url === getCommittedWallpaperUrl()) syncCommittedWallpaperHints(image);
    });
}

/** 取消尚在准备的选择，等待已经开始的提交，再以完整记录建立草稿。 @param {() => boolean} isCurrent */
export async function prepareWallpaperDraft(isCurrent) {
    discardWallpaperSelection('live');
    await wallpaperRestore;
    await wallpaperCommitQueue;
    const previous = getCommittedWallpaperUrl();
    const saved = await getWallpaperSelectionDB();
    if (!isCurrent()) return previous;
    if (saved) syncCommittedWallpaper(saved);
    const current = getCommittedWallpaperUrl();
    if (current !== previous) renderCommittedWallpaper(false);
    return current;
}

/** @param {{ bg: number, wallpaper: string | null }} selection */
function syncCommittedWallpaper(selection) {
    state.bg = backgrounds[selection.bg] ? selection.bg : 0;
    state.customWallpaper = selection.wallpaper;
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
 * @param {() => boolean} [isCurrent]
 * @returns {Promise<boolean>}
 */
export async function clearCustomWallpaper(bg = state.bg, isCurrent) {
    discardWallpaperSelection('live');
    const saved = await commitWallpaperSelection(backgrounds[bg] || backgrounds[0], isCurrent);
    if (saved) renderCommittedWallpaper(false);
    return saved;
}

/** 刷新壁纸来源提示；调用方传入当前预览或已恢复的选择。
 * @param {string|null} wallpaper
 */
export function updateWallpaperStatusUI(wallpaper) {
    const isCustom = !!wallpaper && findPresetBgIndex(wallpaper) === -1;
    if (!dom.wallpaperStatus || !dom.resetBgBtn) return;
    if (isCustom) {
        dom.wallpaperStatus.textContent = t('ui.custom.wallpaper.active');
        dom.wallpaperStatus.className = 'text-2xs text-emerald-400/90 font-medium';
        dom.resetBgBtn.classList.remove('hidden');
    } else {
        dom.wallpaperStatus.textContent = '';
        dom.wallpaperStatus.className = 'hidden';
        dom.resetBgBtn.classList.add('hidden');
    }
}

/** @param {string} message */
export function showWallpaperError(message) {
    if (dom.wallpaperError) dom.wallpaperError.textContent = message;
}

/**
 * 刷新预设壁纸库卡片的激活（Active）高亮选中状态
 * @param {string|null} [customWallpaperOverride]
 * @returns {void}
 */
export function updatePresetBgCardsUI(customWallpaperOverride) {
    const currentBg = customWallpaperOverride !== undefined
        ? (customWallpaperOverride || backgrounds[0])
        : (state.customWallpaper || backgrounds[state.bg] || '');
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
 * 所有写入按序执行。事务已发起时，完成后仍需同步已提交选择。
 * @param {string} targetWallpaper
 * @param {() => boolean} [isCurrent]
 * @param {HTMLImageElement} [preparedImage] - 即时切换成功后发布已准备的图片
 */
export function commitWallpaperSelection(targetWallpaper, isCurrent = () => true, preparedImage) {
    const presetIdx = findPresetBgIndex(targetWallpaper);
    const selection = { wallpaper: presetIdx >= 0 ? null : targetWallpaper, bg: Math.max(0, presetIdx) };
    const result = wallpaperCommitQueue.then(async () => {
        // 用实际记录判定相同选择，其他标签的写入也纳入比较。
        const existing = await getWallpaperSelectionDB();
        if (!isCurrent()) return false;
        if ((!existing || existing.wallpaper !== selection.wallpaper || existing.bg !== selection.bg)
            && !await setWallpaperSelectionDB(selection)) return false;
        syncCommittedWallpaper(selection);
        syncCommittedWallpaperHints(preparedImage);
        if (preparedImage) renderCommittedWallpaper(true, preparedImage);
        return true;
    });
    wallpaperCommitQueue = result;
    return result;
}

/** 保存等待同一会话中最新的草稿选择。 @param {() => boolean} isCurrent */
export async function flushWallpaperSelection(isCurrent = () => true) {
    const mode = state.editOpen ? 'draft' : 'live';
    let task = currentWallpaperTask(mode);
    while (task) {
        const result = await task.promise;
        if (!isCurrent()) return false;
        const current = currentWallpaperTask(mode);
        if (task === current) return result;
        task = current;
    }
    return true;
}

function canPreviewWallpaper() {
    return modalState.phase === 'editing' || modalState.phase === 'preparing-save';
}

/** @param {string} url */
export function previewDraftWallpaper(url) {
    if (!canPreviewWallpaper()) return Promise.resolve(false);
    return selectWallpaperFor('draft', url);
}

/** @param {string | null} url */
export function selectWallpaper(url) {
    if (state.editOpen) return Promise.resolve(false);
    return selectWallpaperFor('live', url || backgrounds[0]);
}

/** @param {WallpaperTask['mode']} mode @param {string} url */
function selectWallpaperFor(mode, url) {
    const previous = currentWallpaperTask(mode);
    const matching = previous?.url === url ? previous : null;
    if (matching && !matching.retryImage) return matching.promise;
    const task = beginWallpaperSelection(mode, url);
    return trackWallpaperSelection(task, executeWallpaperSelection(task, url, matching?.retryImage));
}

/** @param {WallpaperTask} task @param {string | null} url @param {HTMLImageElement} [preparedImage] */
async function executeWallpaperSelection(task, url, preparedImage) {
    task.url = url;
    const image = url && (preparedImage || getRetainedWallpaperImage(url) || await new Promise(resolve => {
        const img = new Image();
        /** @param {HTMLImageElement | null} result */
        const finish = result => {
            img.onload = img.onerror = null;
            resolve(result);
        };
        task.cancel = () => finish(null);
        img.onload = async () => {
            try {
                if (typeof img.decode === 'function') await img.decode();
                finish(img);
            } catch { finish(null); }
        };
        img.onerror = () => finish(null);
        img.src = url;
    }));
    while (task.pause) await task.pause.done;
    if (task !== currentWallpaperTask(task.mode)) return false;
    task.cancel = undefined;
    if (!image || !url) {
        const message = t(url ? 'ui.could.not.load.this.image.check' : 'ui.could.not.read.or.process.this');
        if (task.mode === 'draft') showWallpaperError(message);
        else showConfirm(message, null, t('ui.image.unavailable'));
        return false;
    }
    if (task.mode === 'draft') {
        showWallpaperDraft(url, image);
        return true;
    }

    const saved = await commitWallpaperSelection(url, () => liveWallpaperTask === task, image);
    if (!saved && liveWallpaperTask === task) {
        task.retryImage = image;
        showConfirm(t('ui.could.not.save.the.wallpaper.your'), null, t('ui.wallpaper.not.saved'));
    }
    return saved;
}

/** @param {string} url @param {HTMLImageElement | null} [image] */
export function showWallpaperDraft(url, image = null) {
    if (!wallpaperDraftBase || getPreparedWallpaperImage(getCommittedWallpaperUrl())) {
        wallpaperDraftBase = captureWallpaperFrame();
    }
    modalState.draftWallpaper = url;
    applyWallpaper(url, true, image);
    updateWallpaperStatusUI(url);
    updatePresetBgCardsUI(url);
}

export function resetDraftWallpaper() {
    return previewDraftWallpaper(backgrounds[0]);
}

export function revertDraftWallpaper() {
    discardWallpaperSelection('draft');
    const url = modalState.draftWallpaper = getCommittedWallpaperUrl();
    const frame = getPreparedWallpaperImage(url) ? captureWallpaperFrame() : wallpaperDraftBase;
    if (frame) restoreWallpaperFrame(frame);
    if (frame?.url !== url) renderCommittedWallpaper(false);
}

/** 快捷键轮播也通过同一事务保存，不提前删除自定义壁纸。 */
export async function switchBg() {
    if (state.editOpen) return false;
    const previous = liveWallpaperTask;
    if (previous) await previous.promise;
    if (state.editOpen || liveWallpaperTask !== previous) return false;
    const task = beginWallpaperSelection('live', null);
    const saved = await trackWallpaperSelection(task, (async () => {
        await wallpaperRestore;
        const selection = await getWallpaperSelectionDB();
        if (liveWallpaperTask !== task) return false;
        const custom = selection ? selection.wallpaper : state.customWallpaper;
        const bg = selection?.bg ?? state.bg;
        const nextBg = custom ? backgrounds[0] : backgrounds[(bg + 1) % backgrounds.length];
        const preparedImage = previous?.url === nextBg ? previous.retryImage : undefined;
        return executeWallpaperSelection(task, nextBg, preparedImage);
    })());
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
    grid.innerHTML = PRESET_WALLPAPERS.map(({ url, title: titleKey }, i) => {
        const title = t(titleKey);
        const fullTitle = i === 0 ? t('wallpaper.default', { name: title }) : title;
        return `<button type="button" class="preset-bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" data-bg="${escapeHtml(url)}" title="${escapeHtml(fullTitle)}" aria-pressed="false">
            <span class="preset-bg-image">
                <img width="${CONFIG.UI.WALLPAPER_CARD_WIDTH}" height="${CONFIG.UI.WALLPAPER_CARD_HEIGHT}" alt="" loading="lazy" decoding="async" draggable="false">
                <span class="preset-bg-check" aria-hidden="true"><svg aria-hidden="true"><use href="#icon-check"/></svg></span>
            </span>
            <span class="preset-bg-title">${escapeHtml(title)}</span>
        </button>`;
    }).join('');
    grid.querySelectorAll('img').forEach((img, i) => {
        img.src = PRESET_WALLPAPERS[i].url.replace(/\.avif$/i, '-thumb.avif');
        if (img.complete && img.naturalWidth > 0) img.classList.add('loaded');
        else img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
    });
}

export function restoreWallpaper() {
    applyBgEffects(getSavedMaskOpacity());
    wallpaperRestore = (async () => {
        const selection = await getWallpaperSelectionDB();
        const savedBg = storageGet(CONFIG.KEYS.BG);
        if (selection) syncCommittedWallpaper(selection);
        else if (typeof savedBg === 'number' && backgrounds[savedBg]) state.bg = savedBg;
        renderCommittedWallpaper(false);
    })();
    return wallpaperRestore;
}

/**
 * @param {File} file
 */
export function uploadWallpaper(file) {
    if (!canPreviewWallpaper()) return false;
    if (!file.type.startsWith('image/')) {
        showWallpaperError(t('ui.choose.a.valid.image.file.jpg'));
        return false;
    }
    // 从选择文件起跟踪同一个任务，确保迟到的读取／压缩结果归属原选择。
    const task = beginWallpaperSelection('draft', null);
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
        task.cancel = () => {
            finish(null);
            if (reader.readyState === FileReader.LOADING) reader.abort();
        };
        const fail = () => finish(null);
        reader.onerror = reader.onabort = fail;
        reader.onload = ev => {
            if (task !== modalState.wallpaperSelection) { finish(null); return; }
            const target = /** @type {FileReader|null} */ (ev.target);
            const dataUrl = typeof target?.result === 'string' ? target.result : '';
            if (!dataUrl) { fail(); return; }
            const img = new Image();
            image = img;
            img.onload = () => {
                if (task !== modalState.wallpaperSelection) { finish(null); return; }
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
    trackWallpaperSelection(task, prepared.then(url => {
        if (task !== modalState.wallpaperSelection) return false;
        task.cancel = undefined;
        return executeWallpaperSelection(task, url);
    }));
}
