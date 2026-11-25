/**
 * 壁纸选择、预览、上传与预设列表；持久化队列见 wallpaper-store.js。
 */
import { t } from '../core/i18n.js';
import { CONFIG, backgrounds } from '../config/constants.js';
import { PRESET_WALLPAPERS } from '../config/backgrounds.js';
import { escapeHtml } from '../utils/helpers.js';
import { storageRemove } from '../utils/storage.js';
import { getWallpaperSelectionDB } from '../utils/idb.js';
import { state, modalState } from '../state/store.js';
import { dom } from '../state/dom.js';
import { applyWallpaper, captureWallpaperFrame, getPreparedWallpaperImage, restoreWallpaperFrame } from '../core/wallpaper-renderer.js';
import { showConfirm } from '../core/dialogs.js';
import {
    captureWallpaperDraftBase, clearWallpaperDraftBase, commitWallpaperSelection, enqueueWallpaperSelection,
    findPresetBgIndex, getCommittedWallpaperUrl, getRetainedWallpaperImage, getWallpaperDraftBase,
    renderCommittedWallpaper, syncCommittedWallpaper, syncCommittedWallpaperHints,
    waitForWallpaperCommitQueue, waitForWallpaperRestore
} from './wallpaper-store.js';

/** @typedef {import('../types').WallpaperSelectionTask} WallpaperTask */
/** @type {WallpaperTask | null} */
let liveWallpaperTask = null;

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

export function discardWallpaperDraftSelection() {
    discardWallpaperSelection('draft');
}

export function closeWallpaperDraft() {
    discardWallpaperSelection('draft');
    clearWallpaperDraftBase();
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

/** 取消尚在准备的选择，等待已经开始的提交，再以完整记录建立草稿。 @param {() => boolean} isCurrent */
export async function prepareWallpaperDraft(isCurrent) {
    discardWallpaperSelection('live');
    await waitForWallpaperCommitQueue();
    const previous = getCommittedWallpaperUrl();
    const saved = await getWallpaperSelectionDB();
    if (!isCurrent()) return previous;
    if (saved) syncCommittedWallpaper(saved);
    const current = getCommittedWallpaperUrl();
    if (current !== previous) renderCommittedWallpaper(false);
    return current;
}

/**
 * 恢复默认壁纸和暗度。暗度或提示写入失败时，仍保留已提交的壁纸选择。
 * @param {() => boolean} [isCurrent]
 */
export async function resetWallpaperSettings(isCurrent = () => true) {
    discardWallpaperSelection('live');
    const saved = await enqueueWallpaperSelection({ bg: 0, wallpaper: null }, isCurrent, () => {
        const keys = CONFIG.KEYS;
        const cleared = !isCurrent() || [keys.MASK_OPACITY, keys.THEME_CACHE, keys.TINT_CACHE].map(storageRemove).every(Boolean);
        const hintsSaved = syncCommittedWallpaperHints();
        return cleared && hintsSaved ? true : /** @type {const} */ ('partial');
    });
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
    renderPresetWallpapers(container);
    container.querySelectorAll('.preset-bg-card').forEach(card => {
        const cardEl = card instanceof HTMLElement ? card : null;
        const bg = cardEl?.dataset.bg;
        card.classList.toggle('active', bg === currentBg);
        card.setAttribute('aria-pressed', String(bg === currentBg));
    });
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
        const abort = () => {
            finish(null);
            img.src = '';
        };
        const timeout = /^https?:\/\//i.test(url) ? setTimeout(abort, CONFIG.TIMERS.WALLPAPER_LOAD_TIMEOUT) : null;
        /** @param {HTMLImageElement | null} result */
        const finish = result => {
            if (timeout !== null) clearTimeout(timeout);
            img.onload = img.onerror = null;
            resolve(result);
        };
        task.cancel = timeout === null ? () => finish(null) : abort;
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
    captureWallpaperDraftBase();
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
    const frame = getPreparedWallpaperImage(url) ? captureWallpaperFrame() : getWallpaperDraftBase();
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
        await waitForWallpaperRestore();
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
 * @param {HTMLElement} grid
 * @returns {void}
 */
function renderPresetWallpapers(grid) {
    if (grid.hasChildNodes()) return;
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

const ALLOWED_UPLOAD_IMAGE_TYPES = /^image\/(png|jpeg|jpg|webp|gif|x-icon|avif)$/i;

/**
 * @param {File} file
 */
export function uploadWallpaper(file) {
    if (!canPreviewWallpaper()) return false;
    if (!ALLOWED_UPLOAD_IMAGE_TYPES.test(file.type || '')) {
        discardWallpaperDraftSelection();
        showWallpaperError(t('ui.choose.a.valid.image.file.jpg'));
        return false;
    }
    if (file.size > CONFIG.APPEARANCE.MAX_UPLOAD_BYTES) {
        discardWallpaperDraftSelection();
        showWallpaperError(t('ui.file.too.large', { size: Math.round(CONFIG.APPEARANCE.MAX_UPLOAD_BYTES / (1024 * 1024)) }));
        return false;
    }
    // 从选择文件起跟踪同一个任务，确保迟到的读取／解码结果归属原选择。
    const task = beginWallpaperSelection('draft', null);
    const reader = new FileReader();
    /** @type {Promise<string | null>} */
    const prepared = new Promise(resolve => {
        /** @param {string | null} value */
        const finish = value => {
            reader.onload = reader.onerror = reader.onabort = null;
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
            finish(dataUrl || null);
        };
        try { reader.readAsDataURL(file); } catch { fail(); }
    });
    trackWallpaperSelection(task, prepared.then(url => {
        if (task !== modalState.wallpaperSelection) return false;
        task.cancel = undefined;
        return executeWallpaperSelection(task, url);
    }));
    return true;
}
