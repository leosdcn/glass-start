/**
 * ==============================================================================
 * Glass Start — 设置面板与弹窗管理系统 (src/js/modules/settings.js)
 * ==============================================================================
 */
import { CONFIG, DEFAULT_BOOKMARKS, backgrounds } from '../config/constants.js';
import {
    escapeHtml,
    safeUrl,
    normalizeUrl,
    faviconFromUrl,
    faviconFallbackFromUrl,
    createLetterBadgeHtml,
    evictFaviconCache,
    checkImageReady,
    storageGet,
    storageSet,
    storageRemove
} from '../utils/helpers.js';
import { removeWallpaperDB } from '../utils/idb.js';
import { state, modalState, pageData } from '../state/store.js';
import { dom, $ } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';
import { applyWallpaper } from '../core/theme-engine.js';
import {
    getEffectiveCustomWallpaper,
    updateWallpaperStatusUI,
    updatePresetBgCardsUI,
    commitWallpaperSelection,
    clearCustomWallpaper,
    findPresetBgIndex
} from './wallpaper.js';
import {
    getDerivedBookmarks,
    renderBookmarks,
    getSortedCategories,
    getFaviconHTML,
    initPickerFaviconObserver,
    handleIconError
} from './bookmarks.js';
import { closeDropdown, hideSuggestions, setEngine } from './search.js';
import { renderCreditsModalList } from './clock.js';

let cachedSettingsTabs = null;
let cachedSettingsPanels = null;
let isPresetBgImagesLoaded = false;
let editModalTriggerEl = null;
let shortcutModalTriggerEl = null;
let creditsModalTriggerEl = null;
let activeConfirmCleanup = null;
let bookmarkPickerTriggerEl = null;

export function animateShowModal(modalEl) {
    if (!modalEl) return;
    modalEl.removeAttribute('aria-hidden');
    modalEl.removeAttribute('hidden');
    requestAnimationFrame(() => {
        modalEl.classList.add('active');
    });
}

export function animateHideModal(modalEl) {
    if (!modalEl) return;
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.classList.remove('active');
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        modalEl.setAttribute('hidden', '');
    } else {
        setTimeout(() => {
            if (!modalEl.classList.contains('active')) {
                modalEl.setAttribute('hidden', '');
            }
        }, CONFIG.TIMERS.MODAL_HIDE_DELAY);
    }
}

export function getDraftBookmarkCount() {
    return (modalState.draftBookmarks && modalState.draftBookmarks.length > 0)
        ? modalState.draftBookmarks.length
        : (dom.editList ? dom.editList.querySelectorAll('.edit-row-card').length : pageData.bookmarks.length);
}

export function updateAllBookmarkCounters() {
    const text = `已添加 ${getDraftBookmarkCount()} 项`;
    const badge = dom.bookmarkCountBadge || $('bookmarkCountBadge');
    const pickerCount = dom.pickerCount || $('pickerCount');
    if (badge) badge.textContent = text;
    if (pickerCount) pickerCount.textContent = text;
}

export const updateBookmarkCountBadge = updateAllBookmarkCounters;

export function loadPresetBgCardImages() {
    if (isPresetBgImagesLoaded) return;
    isPresetBgImagesLoaded = true;
    const container = dom.presetWallpaperGrid || $('presetWallpaperGrid');
    if (!container) return;
    container.querySelectorAll('img[data-src]').forEach((img, idx) => {
        const src = img.dataset.src;
        if (!src) return;
        delete img.dataset.src;
        let handled = false;
        const handleLoaded = () => {
            if (handled) return;
            handled = true;
            img.onload = null;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        img.classList.add('loaded');
                    }, idx * CONFIG.TIMERS.PRESET_CARD_STAGGER);
                });
            });
        };
        img.onload = handleLoaded;
        img.src = src;
        if (img.complete && img.naturalWidth > 0) {
            handleLoaded();
        }
    });
}

export function switchSettingsTab(targetTabId) {
    if (!cachedSettingsTabs) cachedSettingsTabs = document.querySelectorAll('.settings-tab-btn');
    if (!cachedSettingsPanels) cachedSettingsPanels = document.querySelectorAll('.settings-tab-panel');
    cachedSettingsTabs.forEach(tab => {
        const isTarget = tab.dataset.tab === targetTabId;
        tab.classList.toggle('active', isTarget);
        tab.setAttribute('aria-selected', isTarget ? 'true' : 'false');
    });
    cachedSettingsPanels.forEach(panel => {
        panel.classList.toggle('hidden', panel.id !== targetTabId);
    });
    if (targetTabId === 'tabAppearance') {
        loadPresetBgCardImages();
    }
}

export function applyBgEffects(opacity, blur, save = false) {
    const op = Math.max(0, Math.min(CONFIG.APPEARANCE.MAX_MASK_OPACITY, parseInt(opacity, 10) || 0));
    const bl = Math.max(0, Math.min(CONFIG.APPEARANCE.MAX_BG_BLUR, parseInt(blur, 10) || 0));
    const bgOverlay = dom.bgOverlay || $('bgOverlay');
    if (bgOverlay) {
        bgOverlay.style.backgroundColor = `rgba(0,0,0,${op / 100})`;
        const blurStyle = bl > 0 ? `blur(${bl}px)` : 'none';
        bgOverlay.style.backdropFilter = blurStyle;
        bgOverlay.style.webkitBackdropFilter = blurStyle;
        if (!save) {
            requestAnimationFrame(() => {
                const trSec = `${CONFIG.TIMERS.BG_OVERLAY_TRANSITION / 1000}s`;
                bgOverlay.style.transition = `background-color ${trSec} ease, opacity ${trSec} ease`;
            });
        }
    }
    const maskOpacityVal = dom.maskOpacityVal || $('maskOpacityVal');
    const bgBlurVal = dom.bgBlurVal || $('bgBlurVal');
    const maskOpacityInput = dom.maskOpacityInput || $('maskOpacityInput');
    const bgBlurInput = dom.bgBlurInput || $('bgBlurInput');

    if (maskOpacityVal) maskOpacityVal.textContent = `${op}%`;
    if (bgBlurVal) bgBlurVal.textContent = `${bl}px`;
    if (maskOpacityInput) {
        if (maskOpacityInput.value != op) maskOpacityInput.value = op;
        maskOpacityInput.setAttribute('aria-valuenow', op);
        maskOpacityInput.setAttribute('aria-valuetext', `${op}%`);
    }
    if (bgBlurInput) {
        if (bgBlurInput.value != bl) bgBlurInput.value = bl;
        bgBlurInput.setAttribute('aria-valuenow', bl);
        bgBlurInput.setAttribute('aria-valuetext', `${bl}px`);
    }
    if (save) {
        storageSet(CONFIG.KEYS.MASK_OPACITY, op);
        storageSet(CONFIG.KEYS.BG_BLUR, bl);
    }
}

export function getEditFaviconInner(name = '', url = '', icon = '') {
    const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
    const faviconUrl = icon || faviconFromUrl(url);
    if (faviconUrl) {
        return `<div class="icon-box icon-box-sm edit-favicon-img-wrapper pointer-events-none select-none"><img src="${escapeHtml(faviconUrl)}" width="${CONFIG.UI.ICON_SIZE_SM}" height="${CONFIG.UI.ICON_SIZE_SM}" data-initial="${escapeHtml(initial)}" data-url="${safeUrl(url)}" class="edit-favicon-img pointer-events-none select-none" alt="" loading="lazy" decoding="async" draggable="false"></div>`;
    }
    return createLetterBadgeHtml(initial, 'icon-box-sm edit-favicon-initial', 'text-2xs font-semibold');
}

export function handleEditIconError(img) {
    if (!img || img.dataset.failed) return;
    const url = img.dataset.url || img.src;
    const fallback = faviconFallbackFromUrl(url, CONFIG.UI.FAVICON_FALLBACK_SIZE);

    if (!img.dataset.fallback && fallback && img.src !== fallback) {
        img.dataset.fallback = '1';
        evictFaviconCache(img.src);
        img.src = fallback;
        return;
    }

    img.dataset.failed = '1';
    evictFaviconCache(img.src);
    const initial = img.dataset.initial || '?';
    const box = img.closest('.edit-favicon-box');
    if (box) {
        box.innerHTML = createLetterBadgeHtml(initial, 'icon-box-sm edit-favicon-initial', 'text-2xs font-semibold');
    }
}
if (typeof window !== 'undefined') {
    window.handleEditIconError = handleEditIconError;
}

export function getEditRowHTML(name = '', url = '', idx = '', icon = '', rowId = '') {
    const id = rowId || (idx !== '' && idx !== undefined ? `bm_${idx}` : `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    return `
        <div role="listitem" class="edit-row-card flex items-center gap-1.5 sm:gap-2 p-1.5 sm:p-2 bg-white/5 border border-white/10 apple-radius hover:border-white/25 glass-interactive group mb-1.5 shadow-xs" data-id="${escapeHtml(id)}" data-idx="${idx}" draggable="false">
            <div class="flex items-center gap-1 shrink-0">
                <button type="button" class="drag-handle touch-none p-1 size-7 flex items-center justify-center shrink-0 text-white/30 group-hover:text-white/70 hover:text-white cursor-grab active:cursor-grabbing rounded-lg glass-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40" title="按住拖拽排序" aria-label="按住拖拽或使用键盘排序">
                    <svg class="size-3.5 pointer-events-none" aria-hidden="true"><use href="#icon-drag"/></svg>
                </button>
                <div class="edit-favicon-box shrink-0 flex items-center justify-center text-white/90 select-none pointer-events-none">
                    ${getEditFaviconInner(name, url, icon)}
                </div>
            </div>
            <div class="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-1 sm:gap-1.5 min-w-0">
                <input type="text" id="bm-name-${id}" name="bookmark_name_${id}" class="edit-name w-full sm:w-1/3 bg-black/25 border border-white/10 rounded-lg px-2.5 py-1 sm:py-1.5 text-base sm:text-xs text-white/90 focus:border-white/40 focus:bg-black/40 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none outline-none transition font-medium" value="${escapeHtml(name)}" placeholder="书签名称" aria-label="书签名称">
                <input type="text" id="bm-url-${id}" name="bookmark_url_${id}" inputmode="url" autocapitalize="off" class="edit-url w-full sm:w-2/3 bg-black/25 border border-white/10 rounded-lg px-2.5 py-1 sm:py-1.5 text-base sm:text-xs text-white/60 focus:border-white/40 focus:bg-black/40 focus:text-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none outline-none transition font-mono" value="${escapeHtml(url)}" placeholder="https://..." aria-label="书签网址">
            </div>
            <button type="button" class="del-btn shrink-0 size-7 sm:size-8 p-1 hover:bg-red-500/20 rounded-full text-white/30 hover:text-red-400 flex items-center justify-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed" title="删除书签" aria-label="删除书签">
                <svg class="size-4 pointer-events-none" aria-hidden="true"><use href="#icon-trash"/></svg>
            </button>
        </div>
    `;
}

/**
 * 创建并追加一条草稿书签行到编辑列表
 * @param {{ name?: string, url?: string, icon?: string, desc?: string, focus?: boolean }} [options]
 * @returns {HTMLElement|null} 创建的 DOM 节点
 */
export function appendDraftBookmarkRow({ name = '', url = '', icon = '', desc = '', focus = false } = {}) {
    const rowId = `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newBm = {
        id: rowId,
        name,
        url,
        icon: icon || '',
        origUrl: url || '',
        desc: desc || ''
    };
    if (!modalState.draftBookmarks) modalState.draftBookmarks = [];
    modalState.draftBookmarks.push(newBm);

    const editList = dom.editList || $('editList');
    if (!editList) return null;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = getEditRowHTML(name, url, modalState.draftBookmarks.length - 1, icon, rowId).trim();
    const div = tempDiv.firstElementChild;
    if (!div) return null;

    div.classList.add('animate-item-in');
    div.addEventListener('animationend', () => div.classList.remove('animate-item-in'), { once: true });
    editList.appendChild(div);

    const newImg = div.querySelector('.edit-favicon-img');
    if (newImg) {
        checkImageReady(newImg, handleEditIconError);
    }

    if (focus) {
        div.querySelector('.edit-name')?.focus();
    }

    modalState.bookmarksChanged = true;
    updateAllBookmarkCounters();
    return div;
}

export function renderEditList(listToRender) {
    if (Array.isArray(listToRender)) {
        modalState.draftBookmarks = listToRender.map((bm, i) => ({
            id: bm.id || `bm_${Date.now()}_${i}`,
            name: bm.name || '',
            url: bm.url || '',
            icon: bm.icon || '',
            origUrl: bm.origUrl || bm.url || '',
            desc: bm.desc || ''
        }));
    } else if (!modalState.draftBookmarks || modalState.draftBookmarks.length === 0) {
        modalState.draftBookmarks = pageData.bookmarks.map((bm, i) => ({
            id: `bm_${i}`,
            name: bm.name || '',
            url: bm.url || '',
            icon: bm.icon || '',
            origUrl: bm.url || '',
            desc: bm.desc || ''
        }));
    }

    const editList = dom.editList || $('editList');
    if (!editList) return;
    editList.innerHTML = '<div id="dragDropIndicator" class="drag-drop-line"></div>' + modalState.draftBookmarks.map((bm, i) => getEditRowHTML(bm.name, bm.url, i, bm.icon, bm.id)).join('');
    dom.dragDropIndicator = editList.querySelector('#dragDropIndicator');
    updateBookmarkCountBadge();

    editList.querySelectorAll('img.edit-favicon-img').forEach(img => {
        checkImageReady(img, handleEditIconError);
    });
}

/**
 * 纯内存收集与清洗草稿书签数据（彻底告别 DOM 遍历反向收割）
 * @returns {Array<{name: string, url: string, icon: string, desc?: string}>}
 */
export function collectEditData() {
    const sourceList = (modalState.draftBookmarks && modalState.draftBookmarks.length > 0)
        ? modalState.draftBookmarks
        : (pageData.bookmarks || []);

    const bookmarks = [];
    for (let i = 0; i < sourceList.length; i++) {
        const item = sourceList[i];
        const name = (item.name || '').trim();
        let url = (item.url || '').trim();
        url = normalizeUrl(url);
        const origIcon = item.icon || '';
        const origUrl = normalizeUrl(item.origUrl || '');
        if (name && url) {
            let icon = '';
            if (origIcon && (url === origUrl || !origUrl)) {
                icon = origIcon;
            } else {
                icon = faviconFromUrl(url);
            }
            const cleanItem = { name, url, icon };
            if (item.desc) cleanItem.desc = item.desc;
            bookmarks.push(cleanItem);
        }
    }
    return bookmarks;
}

export async function openEditModal() {
    closeDropdown();
    hideSuggestions();
    editModalTriggerEl = document.activeElement;
    const editBtn = dom.editBookmarksBtn || $('editBookmarksBtn');
    editBtn?.setAttribute('aria-expanded', 'true');
    state.editOpen = true;
    OverlayStack.push('editModal', cancelEditModal);

    modalState.initialWallpaper = await getEffectiveCustomWallpaper();
    if (!state.editOpen) return;
    modalState.initialMaskOpacity = storageGet(CONFIG.KEYS.MASK_OPACITY, CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY);
    modalState.initialBgBlur = storageGet(CONFIG.KEYS.BG_BLUR, CONFIG.APPEARANCE.DEFAULT_BG_BLUR);

    modalState.draftWallpaper = modalState.initialWallpaper;
    modalState.draftMaskOpacity = modalState.initialMaskOpacity;
    modalState.draftBgBlur = modalState.initialBgBlur;
    modalState.bookmarksChanged = false;

    // 初始化内存草稿真理源
    modalState.draftBookmarks = pageData.bookmarks.map((bm, i) => ({
        id: `bm_${i}`,
        name: bm.name || '',
        url: bm.url || '',
        icon: bm.icon || '',
        origUrl: bm.url || '',
        desc: bm.desc || ''
    }));

    switchSettingsTab('tabBookmarks');
    renderEditList();
    updateWallpaperStatusUI(modalState.draftWallpaper);
    updatePresetBgCardsUI(modalState.draftWallpaper);
    applyBgEffects(modalState.draftMaskOpacity, modalState.draftBgBlur, false);
    animateShowModal(dom.editModal || $('editModal'));
}

export function cancelEditModal() {
    applyBgEffects(modalState.initialMaskOpacity, modalState.initialBgBlur, false);
    closeEditModal();
}

export function closeEditModal() {
    state.editOpen = false;
    OverlayStack.pop('editModal');
    const editBtn = dom.editBookmarksBtn || $('editBookmarksBtn');
    editBtn?.setAttribute('aria-expanded', 'false');
    const editModal = dom.editModal || $('editModal');
    if (document.activeElement && editModal && editModal.contains(document.activeElement)) {
        document.activeElement.blur();
    }
    animateHideModal(editModal);

    const inputRow = dom.urlBgInputRow || $('urlBgInputRow');
    if (inputRow && !inputRow.classList.contains('hidden')) {
        inputRow.classList.add('hidden');
        const btnGroup = dom.urlBgBtnGroup || $('urlBgBtnGroup');
        btnGroup?.classList.remove('hidden');
        const urlInput = dom.urlBgInput || $('urlBgInput');
        if (urlInput) urlInput.value = '';
    }

    if (editModalTriggerEl && typeof editModalTriggerEl.focus === 'function') {
        const opener = editModalTriggerEl;
        editModalTriggerEl = null;
        requestAnimationFrame(() => opener.focus());
    }
}

export function openShortcutModal() {
    const modal = dom.shortcutModal || $('shortcutModal');
    if (!modal) return;
    closeDropdown();
    hideSuggestions();
    shortcutModalTriggerEl = document.activeElement;
    dom.openShortcutFromSettingsBtn?.setAttribute('aria-expanded', 'true');
    OverlayStack.push('shortcutModal', closeShortcutModal);
    animateShowModal(modal);
}

export function closeShortcutModal() {
    const modal = dom.shortcutModal || $('shortcutModal');
    if (!modal) return;
    OverlayStack.pop('shortcutModal');
    dom.openShortcutFromSettingsBtn?.setAttribute('aria-expanded', 'false');
    if (document.activeElement && modal.contains(document.activeElement)) {
        document.activeElement.blur();
    }
    animateHideModal(modal);
    if (shortcutModalTriggerEl && typeof shortcutModalTriggerEl.focus === 'function') {
        const opener = shortcutModalTriggerEl;
        shortcutModalTriggerEl = null;
        requestAnimationFrame(() => opener.focus());
    }
}

export function openCreditsModal() {
    const modal = dom.creditsModal || $('creditsModal');
    if (!modal) return;
    renderCreditsModalList();
    creditsModalTriggerEl = document.activeElement;
    dom.openCreditsFromSettingsBtn?.setAttribute('aria-expanded', 'true');
    OverlayStack.push('creditsModal', closeCreditsModal);
    animateShowModal(modal);
}

export function closeCreditsModal() {
    const modal = dom.creditsModal || $('creditsModal');
    if (!modal) return;
    OverlayStack.pop('creditsModal');
    dom.openCreditsFromSettingsBtn?.setAttribute('aria-expanded', 'false');
    if (document.activeElement && modal.contains(document.activeElement)) {
        document.activeElement.blur();
    }
    animateHideModal(modal);
    if (creditsModalTriggerEl && typeof creditsModalTriggerEl.focus === 'function') {
        const opener = creditsModalTriggerEl;
        creditsModalTriggerEl = null;
        requestAnimationFrame(() => opener.focus());
    }
}

export function showConfirm(message, onConfirm, title = '重置确认', triggerEl = null, okText = '') {
    const modal = dom.confirmModal || $('confirmModal');
    const titleEl = dom.confirmTitle || $('confirmTitle');
    const msgEl = dom.confirmMsg || $('confirmMsg');
    const okBtn = dom.confirmOkBtn || $('confirmOkBtn');
    const cancelBtn = dom.confirmCancelBtn || $('confirmCancelBtn');

    if (!modal || !okBtn || !cancelBtn || !msgEl) {
        if (typeof window !== 'undefined' && window.confirm(message)) onConfirm?.();
        return;
    }

    if (activeConfirmCleanup) {
        activeConfirmCleanup();
        activeConfirmCleanup = null;
    }

    const isNotify = onConfirm == null;
    okBtn.textContent = isNotify ? '知道了' : (okText || '确认');
    cancelBtn.style.display = isNotify ? 'none' : '';

    if (titleEl) titleEl.textContent = title;
    msgEl.textContent = message;
    animateShowModal(modal);
    OverlayStack.push('confirmModal', cleanup);

    let confirmTriggerEl = triggerEl || document.activeElement || dom.resetEditBtn;
    if (confirmTriggerEl && typeof confirmTriggerEl.setAttribute === 'function') {
        confirmTriggerEl.setAttribute('aria-expanded', 'true');
    }

    function cleanup() {
        activeConfirmCleanup = null;
        OverlayStack.pop('confirmModal');
        if (document.activeElement && modal.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        animateHideModal(modal);
        cancelBtn.style.display = '';
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', handleCancel);
        modal.removeEventListener('click', handleBackdropClick);
        if (confirmTriggerEl && typeof confirmTriggerEl.focus === 'function') {
            const opener = confirmTriggerEl;
            confirmTriggerEl = null;
            opener.setAttribute('aria-expanded', 'false');
            requestAnimationFrame(() => opener.focus());
        }
    }

    function handleOk() { cleanup(); onConfirm?.(); }
    function handleCancel() { cleanup(); }
    function handleBackdropClick(e) {
        if (e.target === modal) cleanup();
    }

    okBtn.addEventListener('click', handleOk);
    if (!isNotify) cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackdropClick);
    activeConfirmCleanup = cleanup;
}
if (typeof window !== 'undefined') {
    window.showConfirm = showConfirm;
}

export function openBookmarkPicker(triggerEl = null) {
    bookmarkPickerTriggerEl = triggerEl || document.activeElement || dom.togglePickerBtn;
    dom.togglePickerBtn?.setAttribute('aria-expanded', 'true');
    OverlayStack.push('bookmarkPicker', closeBookmarkPicker);
    animateShowModal(dom.bookmarkPicker || $('bookmarkPicker'));
    renderPickerCategories();
}

export function closeBookmarkPicker() {
    OverlayStack.pop('bookmarkPicker');
    dom.togglePickerBtn?.setAttribute('aria-expanded', 'false');
    const picker = dom.bookmarkPicker || $('bookmarkPicker');
    if (document.activeElement && picker && picker.contains(document.activeElement)) {
        document.activeElement.blur();
    }
    animateHideModal(picker);
    if (bookmarkPickerTriggerEl && typeof bookmarkPickerTriggerEl.focus === 'function') {
        const opener = bookmarkPickerTriggerEl;
        bookmarkPickerTriggerEl = null;
        requestAnimationFrame(() => opener.focus());
    }
}

/**
 * 导出当前快捷书签为 JSON 格式备份文件
 * @returns {void}
 */
export function exportBookmarksJSON() {
    const data = collectEditData();
    const bookmarksToExport = data.length ? data : pageData.bookmarks;
    const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        bookmarks: bookmarksToExport
    };
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    a.href = url;
    a.download = `startpage_bookmarks_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), CONFIG.TIMERS.OBJECT_REVOKE);
}

/**
 * 读取并解析用户选择/拖入的 JSON 备份文件
 * @param {File} file
 * @returns {void}
 */
export function importBookmarksJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            let importedList = [];
            if (Array.isArray(parsed)) {
                importedList = parsed;
            } else if (parsed && Array.isArray(parsed.bookmarks)) {
                importedList = parsed.bookmarks;
            } else if (parsed && Array.isArray(parsed.categories)) {
                parsed.categories.forEach(cat => {
                    if (cat && Array.isArray(cat.bookmarks)) importedList.push(...cat.bookmarks);
                });
            } else {
                showConfirm('上传的配置文件结构不匹配，未包含有效的书签数组。', null, '格式错误');
                return;
            }

            const validBookmarks = [];
            importedList.forEach(item => {
                if (item && typeof item === 'object' && (item.name || item.url)) {
                    const name = String(item.name || '未命名').trim().slice(0, CONFIG.SECURITY.MAX_NAME_CHARS);
                    const rawUrl = String(item.url || '').trim();
                    const url = normalizeUrl(rawUrl);
                    if (name && url && (/^https?:\/\//i.test(url) || /^data:image\//i.test(url))) {
                        const rawIcon = typeof item.icon === 'string' && item.icon.trim() ? item.icon.trim() : faviconFromUrl(url);
                        const icon = safeUrl(rawIcon) !== '#' ? rawIcon : faviconFromUrl(url);
                        const desc = typeof item.desc === 'string' ? item.desc.trim().slice(0, CONFIG.SECURITY.MAX_DESC_CHARS) : '';
                        validBookmarks.push({ name, url, icon, desc });
                    }
                }
            });

            if (validBookmarks.length === 0) {
                showConfirm('配置文件中没有提取到有效的书签条目。', null, '导入失败');
                return;
            }

            showConfirm(`检测到合规书签 ${validBookmarks.length} 项，确定导入并填入草稿列表中吗？需点击『完成』后生效。`, () => {
                modalState.bookmarksChanged = true;
                renderEditList(validBookmarks);
                closeBookmarkPicker();
            }, '导入草稿确认');
        } catch (err) {
            showConfirm('解析 JSON 配置文件失败，请检查文件格式。', null, '解析错误');
        } finally {
            reader.onload = null;
        }
    };
    reader.readAsText(file, 'UTF-8');
}

/**
 * 恢复系统初始默认状态
 * @returns {void}
 */
export function resetBookmarks() {
    showConfirm('确定要恢复系统初始默认状态吗？此操作将立即清除您自定义的所有快捷书签、背景壁纸与偏好设置。', () => {
        storageRemove(CONFIG.KEYS.LEGACY_BOOKMARKS);
        storageRemove(CONFIG.KEYS.BOOKMARK_KEYS);
        storageRemove(CONFIG.KEYS.CUSTOM_META);
        storageRemove(CONFIG.KEYS.PREFERRED_ENGINE);
        storageRemove(CONFIG.KEYS.USER_WALLPAPER);
        storageRemove(CONFIG.KEYS.MASK_OPACITY);
        storageRemove(CONFIG.KEYS.BG_BLUR);
        storageRemove(CONFIG.KEYS.BG);
        storageRemove(CONFIG.KEYS.NAV_DISCOVERED);
        storageRemove(CONFIG.KEYS.WEATHER_CACHE);
        storageRemove(CONFIG.KEYS.WEATHER_LOC);
        storageRemove(CONFIG.KEYS.WEATHER_SETTINGS);

        if (dom.scrollDownHint) {
            dom.scrollDownHint.style.display = '';
            dom.scrollDownHint.style.opacity = '';
        }

        removeWallpaperDB();
        state.customWallpaper = null;

        modalState.draftWallpaper = undefined;
        modalState.draftMaskOpacity = null;
        modalState.draftBgBlur = null;
        modalState.draftBookmarks = [];
        modalState.bookmarksChanged = false;

        setEngine('bing', false);
        state.bg = 0;
        applyWallpaper(backgrounds[0], false);
        applyBgEffects(CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY, CONFIG.APPEARANCE.DEFAULT_BG_BLUR, false);
        pageData.bookmarks = getDerivedBookmarks(DEFAULT_BOOKMARKS.map(b => b.url), pageData.categories);
        renderBookmarks();
        closeBookmarkPicker();
        closeEditModal();
    }, '重置所有系统设置');
}

export const updatePickerCount = updateAllBookmarkCounters;

/**
 * 获取当前已存在于编辑列表或已添加的 URL 集合
 * @returns {Set<string>}
 */
export function getExistingUrls() {
    const urls = new Set();
    const sourceList = (modalState.draftBookmarks && modalState.draftBookmarks.length > 0)
        ? modalState.draftBookmarks
        : pageData.bookmarks;

    sourceList.forEach(bm => {
        const norm = normalizeUrl(bm.url);
        if (norm) urls.add(norm);
    });
    return urls;
}

/**
 * 渲染导航页所有分类及其包含的书签列表至挑选弹窗中
 * @returns {void}
 */
export function renderPickerCategories() {
    const pickerContent = dom.pickerContent || $('pickerContent');
    if (!pickerContent) return;
    const urls = getExistingUrls();
    const sortedCats = getSortedCategories();

    pickerContent.innerHTML = sortedCats.map(cat => {
        const sortedBookmarks = cat.sortedBookmarks || [];
        return `
        <div>
            <div class="flex items-center gap-1.5 mb-1.5 pb-1 border-b border-white/5">
                <span class="text-sm">${escapeHtml(cat.icon)}</span>
                <h4 class="text-xs font-medium text-white/70">${escapeHtml(cat.name)}</h4>
                <span class="ml-auto text-2xs text-white/20">${cat.bookmarks.length}</span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-1">
                ${sortedBookmarks.map(bm => {
                    const exists = urls.has(bm.url);
                    const faviconHtml = getFaviconHTML(bm, 'sm');
                    return `
                        <button type="button" class="w-full flex items-center gap-2 px-2 py-1.5 apple-radius picker-item text-left select-none ${exists ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/10 cursor-pointer'}" ${exists ? 'disabled aria-disabled="true"' : ''} aria-label="${exists ? `${escapeHtml(bm.name)}（已添加）` : `添加快捷书签：${escapeHtml(bm.name)}`}" ${!exists ? `data-name="${escapeHtml(bm.name)}" data-url="${escapeHtml(bm.url)}"` : ''}>
                            ${faviconHtml}
                            <span class="text-xs text-white/70 truncate flex-1 min-w-0">${escapeHtml(bm.name)}</span>
                            ${exists
                                ? '<span class="text-2xs text-white/20 shrink-0">已存在</span>'
                                : '<span class="text-white/40 shrink-0 text-sm">+</span>'
                            }
                        </button>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    }).join('');
    updatePickerCount();
    initPickerFaviconObserver();
}
