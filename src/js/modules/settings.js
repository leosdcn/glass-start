import { t, getLanguagePreference } from '../core/i18n.js';
import { updateAllBookmarkCounters, renderEditList, collectEditData } from './bookmark-editor.js';
import { showConfirm } from '../core/dialogs.js';
/**
 * 设置面板与弹窗管理系统
 */
import { CONFIG, backgrounds } from '../config/constants.js';
import { DEFAULT_ENGINE } from '../config/engines.js';
import { escapeHtml, normalizeUrl, normalizeBookmark, storageGet, storageSet, storageRemove } from '../utils/helpers.js';
import { state, modalState, pageData } from '../state/store.js';
import { replaceBookmarkDraft } from '../state/bookmark-draft.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';
import { applyWallpaper } from '../core/wallpaper-renderer.js';
import { flushWallpaperSelection, getEffectiveCustomWallpaper, updateWallpaperStatusUI, updatePresetBgCardsUI, clearCustomWallpaper, renderPresetWallpapers, commitWallpaperSelection, revertDraftWallpaper } from './wallpaper.js';
import { saveUserBookmarks, resetUserBookmarks } from './bookmarks.js';
import { closeDropdown, hideSuggestions, setEngine } from './search.js';
import { renderCreditsModalList, renderShortcutModalList } from './clock.js';
import { getTransitionMode, syncTransitionSwitcherActive, setTransitionMode } from '../core/screen-state.js';
import { cancelDragSort } from '../core/drag-sort.js';
import { openBookmarkPicker, closeBookmarkPicker, updatePickerAvailability } from './bookmark-picker.js';

export { openBookmarkPicker, closeBookmarkPicker, updatePickerAvailability };

let editOpenRequestId = 0;
let importRequestId = 0;
/** @type {NodeListOf<HTMLElement> | null} */
let cachedSettingsTabs = null;
/** @type {NodeListOf<HTMLElement> | null} */
let cachedSettingsPanels = null;

function loadPresetBgCardImages() {
    const container = dom.presetWallpaperGrid;
    if (!container) return;
    container.querySelectorAll('img[data-src]').forEach((el, idx) => {
        const img = /** @type {HTMLImageElement} */ (el);
        const src = img.dataset.src;
        if (!src) return;
        delete img.dataset.src;
        let handled = false;
        const handleLoaded = () => {
            if (handled) return;
            handled = true;
            img.onload = null;
            requestAnimationFrame(() => {
                setTimeout(() => {
                    img.classList.add('loaded');
                }, idx * CONFIG.TIMERS.PRESET_CARD_STAGGER);
            });
        };
        img.onload = handleLoaded;
        img.src = src;
        if (img.complete && img.naturalWidth > 0) {
            handleLoaded();
        }
    });
}

/** @param {string} targetTabId */
export function switchSettingsTab(targetTabId) {
    if (!cachedSettingsTabs) cachedSettingsTabs = document.querySelectorAll('.settings-tab-btn');
    if (!cachedSettingsPanels) cachedSettingsPanels = document.querySelectorAll('.settings-tab-panel');
    cachedSettingsTabs.forEach(tab => {
        const isTarget = tab.dataset.tab === targetTabId;
        tab.classList.toggle('active', isTarget);
        tab.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        tab.tabIndex = isTarget ? 0 : -1;
    });
    cachedSettingsPanels.forEach(panel => {
        panel.classList.toggle('hidden', panel.id !== targetTabId);
    });
    if (targetTabId === 'tabAppearance') {
        renderPresetWallpapers();
        updatePresetBgCardsUI(modalState.draftWallpaper);
        loadPresetBgCardImages();
    }
}

/** @type {number | null} */
let bgEffectsRafId = null;
/** @type {number | null} */
let pendingBgEffects = null;
/** @type {{ element: HTMLElement, opacity: number } | null} */
let lastBgEffects = null;

/** @param {number} op */
function renderBgEffects(op) {
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

/** 滑块草稿与无障碍读数即时更新，全屏视觉每帧只消费最后一次输入。 */
/** @param {string | number} value */
export function previewDraftMaskOpacity(value) {
    modalState.draftMaskOpacity = parseInt(String(value), 10) || 0;
    applyBgEffects(modalState.draftMaskOpacity, true);
}

/**
 * @param {number | string} opacity
 * @param {boolean} [defer]
 */
export function applyBgEffects(opacity, defer = false) {
    const op = Math.max(0, Math.min(CONFIG.APPEARANCE.MAX_MASK_OPACITY, parseInt(String(opacity), 10) || 0));
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

export async function openEditModal() {
    if (state.editOpen) return;
    closeDropdown();
    hideSuggestions();
    const editBtn = dom.editBookmarksBtn;
    editBtn?.setAttribute('aria-expanded', 'true');
    state.editOpen = true;
    const requestId = ++editOpenRequestId;
    const trigger = document.activeElement;
    const initialWallpaper = await getEffectiveCustomWallpaper();
    if (!state.editOpen || requestId !== editOpenRequestId) return;
    modalState.initialWallpaper = initialWallpaper || backgrounds[state.bg];

    modalState.draftWallpaper = modalState.initialWallpaper;
    modalState.draftMaskOpacity = storageGet(CONFIG.KEYS.MASK_OPACITY, CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY);
    modalState.draftTransitionMode = getTransitionMode();
    modalState.wallpaperSaveFailed = false;
    modalState.draftLanguage = getLanguagePreference();
    syncLanguageUI();
    syncTransitionSwitcherActive(modalState.draftTransitionMode);
    closeLanguageModal();

    replaceBookmarkDraft(pageData.bookmarks.map((bm, i) => ({ ...bm, id: `bm_${i}`, desc: bm.desc || '' })));
    switchSettingsTab('tabBookmarks');
    renderEditList();
    updateWallpaperStatusUI(modalState.draftWallpaper);
    applyBgEffects(modalState.draftMaskOpacity ?? CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY);
    OverlayStack.push('editModal', cancelEditModal, trigger);
}

export function cancelEditModal() {
    // 壁纸提交开始后不能再恢复旧预览，否则会与已提交的 IDB 记录不一致。
    if (dom.cancelEditBtn?.disabled) return;
    applyBgEffects(storageGet(CONFIG.KEYS.MASK_OPACITY, CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY));
    modalState.draftTransitionMode = getTransitionMode();
    syncTransitionSwitcherActive(modalState.draftTransitionMode);
    revertDraftWallpaper();
    closeEditModal();
}

export function closeEditModal() {
    closeLanguageModal();
    // 保存关闭时即使后台暂停了 rAF，也同步落定最后的预览；取消已先覆盖并清队列。
    if (pendingBgEffects !== null) applyBgEffects(pendingBgEffects);
    cancelDragSort();
    state.editOpen = false;
    editOpenRequestId++;
    if (dom.saveEditBtn) {
        dom.saveEditBtn.disabled = false;
        dom.saveEditBtn.removeAttribute('aria-busy');
    }
    if (dom.cancelEditBtn) dom.cancelEditBtn.disabled = false;
    if (dom.tabAppearance) dom.tabAppearance.inert = false;
    OverlayStack.pop('editModal');
    const editBtn = dom.editBookmarksBtn;
    editBtn?.setAttribute('aria-expanded', 'false');

    closeWallpaperUrlInput();
}

/** 关闭并清空壁纸直链输入行，恢复操作按钮组 */
export function closeWallpaperUrlInput() {
    const inputRow = dom.urlBgInputRow;
    if (inputRow && !inputRow.classList.contains('hidden')) {
        inputRow.classList.add('hidden');
        const btnGroup = dom.urlBgBtnGroup;
        btnGroup?.classList.remove('hidden');
        const urlInput = dom.urlBgInput;
        if (urlInput) urlInput.value = '';
    }
}

export function openShortcutModal() {
    const modal = dom.shortcutModal;
    if (!modal) return;
    renderShortcutModalList();
    closeDropdown();
    hideSuggestions();
    dom.openShortcutFromSettingsBtn?.setAttribute('aria-expanded', 'true');
    OverlayStack.push('shortcutModal', closeShortcutModal);
}

export function closeShortcutModal() {
    const modal = dom.shortcutModal;
    if (!modal) return;
    OverlayStack.pop('shortcutModal');
    dom.openShortcutFromSettingsBtn?.setAttribute('aria-expanded', 'false');
}

export function openCreditsModal() {
    const modal = dom.creditsModal;
    if (!modal) return;
    renderCreditsModalList();
    dom.openCreditsFromSettingsBtn?.setAttribute('aria-expanded', 'true');
    OverlayStack.push('creditsModal', closeCreditsModal);
}

export function closeCreditsModal() {
    const modal = dom.creditsModal;
    if (!modal) return;
    OverlayStack.pop('creditsModal');
    dom.openCreditsFromSettingsBtn?.setAttribute('aria-expanded', 'false');
}

/**
 * 导出当前快捷书签草稿，不包含壁纸和偏好设置。
 * @returns {void}
 */
export function exportBookmarksJSON() {
    const data = collectEditData();
    const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        bookmarks: data
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
    if (!file || !state.editOpen) return;
    const sessionId = editOpenRequestId;
    const requestId = ++importRequestId;
    const isCurrent = () => state.editOpen && sessionId === editOpenRequestId && requestId === importRequestId;
    const reader = new FileReader();
    reader.onload = (e) => {
        if (!isCurrent()) return;
        try {
            if (!e.target || typeof e.target.result !== 'string') return;
            const parsed = JSON.parse(e.target.result);
            let importedList = [];
            if (Array.isArray(parsed)) {
                importedList = parsed;
            } else if (parsed && Array.isArray(parsed.bookmarks)) {
                importedList = parsed.bookmarks;
            } else if (parsed && Array.isArray(parsed.categories)) {
                parsed.categories.forEach((/** @type {any} */ cat) => {
                    if (cat && Array.isArray(cat.bookmarks)) importedList.push(...cat.bookmarks);
                });
            } else {
                showConfirm(t('ui.this.file.does.not.contain.a'), null, t('ui.invalid.format'));
                return;
            }

            const validBookmarks = importedList.map((/** @type {any} */ item) => normalizeBookmark(item, t('ui.untitled'))).filter(Boolean);

            if (validBookmarks.length === 0) {
                showConfirm(t('ui.no.valid.bookmarks.were.found.in'), null, t('ui.import.failed'));
                return;
            }

            showConfirm(t('bookmark.importConfirm', { count: validBookmarks.length }), () => {
                if (!isCurrent()) return;
                replaceBookmarkDraft(validBookmarks.map((/** @type {import('../types').BookmarkItem} */ bookmark) => ({ ...bookmark, customText: true })), true);
                renderEditList();
                closeBookmarkPicker();
            }, t('ui.confirm.import'));
        } catch (err) {
            showConfirm(t('ui.could.not.parse.the.json.file'), null, t('ui.parse.error'));
        } finally {
            reader.onload = null;
        }
    };
    reader.onerror = () => {
        if (isCurrent()) showConfirm(t('ui.could.not.read.the.file.please'), null, t('ui.import.failed'));
    };
    reader.readAsText(file, 'UTF-8');
}

/**
 * 恢复系统初始默认状态
 * @returns {void}
 */
export function resetBookmarks() {
    showConfirm(t('ui.restore.all.defaults.this.immediately.removes'), async () => {
        if (!await clearCustomWallpaper(0)) {
            showConfirm(t('ui.could.not.clear.wallpaper.storage.your'), null, t('ui.reset.failed'));
            return;
        }
        /** @type {(keyof typeof CONFIG.KEYS)[]} */
        const keys = ['PREFERRED_ENGINE', 'WALLPAPER_META', 'MASK_OPACITY',
            'BG', 'NAV_DISCOVERED', 'WEATHER_CACHE', 'WEATHER_LOC',
            'THEME_CACHE', 'TINT_CACHE', 'TRANSITION_MODE', 'LANGUAGE'];
        const previousLanguage = getLanguagePreference();
        const removed = keys.map(key => storageRemove(CONFIG.KEYS[key]));
        const bookmarksReset = resetUserBookmarks();
        const mode = getTransitionMode();
        document.documentElement.dataset.transitionMode = mode;
        syncTransitionSwitcherActive(mode);
        modalState.draftTransitionMode = mode;
        const opacity = storageGet(CONFIG.KEYS.MASK_OPACITY, CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY);
        modalState.draftMaskOpacity = opacity;
        applyBgEffects(opacity);
        setEngine(storageGet(CONFIG.KEYS.PREFERRED_ENGINE, DEFAULT_ENGINE), false);
        applyWallpaper(backgrounds[0], false);
        if (!bookmarksReset || removed.some(result => !result)) {
            replaceBookmarkDraft(pageData.bookmarks.map((bm, i) => ({ ...bm, id: `bm_${i}` })));
            renderEditList();
            modalState.draftWallpaper = null;
            updateWallpaperStatusUI(null);
            updatePresetBgCardsUI(null);
            showConfirm(t('ui.some.settings.could.not.be.cleared'), null, t('ui.reset.incomplete'));
            return;
        }

        if (dom.scrollDownHint) {
            dom.scrollDownHint.style.display = '';
            dom.scrollDownHint.style.opacity = '';
        }


        modalState.draftWallpaper = undefined;
        modalState.draftMaskOpacity = null;
        replaceBookmarkDraft([]);

        closeBookmarkPicker();
        closeEditModal();
        if (previousLanguage !== 'auto') location.reload();
    }, t('ui.reset.all.settings'));
}

export async function saveEditModal() {
    const saveBtn = dom.saveEditBtn;
    if (!state.editOpen || !saveBtn || saveBtn.disabled) return;
    const requestId = editOpenRequestId;
    saveBtn.disabled = true;
    saveBtn.setAttribute('aria-busy', 'true');
    try {
        const data = collectEditData();
        if (data.length === 0) {
            showConfirm(t('ui.keep.at.least.one.bookmark.with'), null, t('ui.could.not.save'));
            return;
        }
        const wallpaperSaved = await flushWallpaperSelection();
        // 取消或重新打开设置后，旧保存任务不得提交草稿、弹提示或关闭新窗口。
        if (!state.editOpen || requestId !== editOpenRequestId) return;
        if (!wallpaperSaved) {
            showConfirm(t('ui.the.wallpaper.has.not.been.saved'), null, t('ui.could.not.save'));
            return;
        }

        // 1. 提交书签
        if (modalState.bookmarksChanged && !saveUserBookmarks(data, new Set(modalState.draftBookmarks.filter(item => item.customText).map(item => normalizeUrl(item.url))))) {
            showConfirm(t('ui.could.not.save.bookmarks.your.draft'), null, t('ui.could.not.save'));
            return;
        }

        // 2. 提交背景暗度
        if (modalState.draftMaskOpacity !== null) {
            if (!storageSet(CONFIG.KEYS.MASK_OPACITY, modalState.draftMaskOpacity)) {
                showConfirm(t('ui.could.not.save.background.dimming.your'), null, t('ui.could.not.save'));
                return;
            }
        }

        // 3. 提交切屏动效
        if (modalState.draftTransitionMode && modalState.draftTransitionMode !== getTransitionMode()) {
            if (!setTransitionMode(modalState.draftTransitionMode)) {
                showConfirm(t('ui.could.not.save.transition.mode.your'), null, t('ui.could.not.save'));
                return;
            }
        }

        // 4. 提交壁纸草稿
        if (modalState.draftWallpaper !== undefined && modalState.draftWallpaper !== modalState.initialWallpaper) {
            const targetBg = modalState.draftWallpaper;
            if (dom.cancelEditBtn) dom.cancelEditBtn.disabled = true;
            // 提交快照后停止接受外观修改，避免预览与本次保存结果分离。
            if (dom.tabAppearance) dom.tabAppearance.inert = true;
            const saved = await commitWallpaperSelection(targetBg, () => state.editOpen && requestId === editOpenRequestId);
            if (!state.editOpen || requestId !== editOpenRequestId) return;
            if (!saved) {
                showConfirm(t('ui.could.not.save.the.wallpaper.your'), null, t('ui.wallpaper.not.saved'));
                return;
            }
            modalState.initialWallpaper = targetBg;
        }

        const languageChanged = modalState.draftLanguage !== getLanguagePreference();
        if (languageChanged && !storageSet(CONFIG.KEYS.LANGUAGE, modalState.draftLanguage)) {
            showConfirm(t('language.saveFailed'), null, t('ui.could.not.save'));
            return;
        }
        closeEditModal();
        if (languageChanged) location.reload();
    } finally {
        if (requestId === editOpenRequestId) {
            saveBtn.disabled = false;
            saveBtn.removeAttribute('aria-busy');
            if (dom.cancelEditBtn) dom.cancelEditBtn.disabled = false;
            if (dom.tabAppearance) dom.tabAppearance.inert = false;
        }
    }
}

let initialLanguageOnOpen = 'auto';

export function openLanguageModal(trigger = dom.languageBtn) {
    initialLanguageOnOpen = modalState.draftLanguage || 'auto';
    syncLanguageUI();
    dom.languageBtn?.setAttribute('aria-expanded', 'true');
    OverlayStack.push('languageModal', cancelLanguageModal, trigger);
    const activeItem = /** @type {HTMLButtonElement | null} */ (dom.languageList?.querySelector('button[data-lang][aria-checked="true"]'));
    activeItem?.focus();
}

export function cancelLanguageModal() {
    modalState.draftLanguage = initialLanguageOnOpen;
    syncLanguageUI();
    closeLanguageModal();
}

function closeLanguageModal() {
    OverlayStack.pop('languageModal');
    dom.languageBtn?.setAttribute('aria-expanded', 'false');
}

export function saveLanguageModal() {
    if (modalState.draftLanguage === getLanguagePreference()) {
        closeLanguageModal();
        return;
    }
    closeLanguageModal();
    return saveEditModal();
}

/** @param {string} lang */
export function selectLanguage(lang) {
    modalState.draftLanguage = lang;
    syncLanguageUI();
}

/** @param {string} mode */
export function selectDraftTransitionMode(mode) {
    modalState.draftTransitionMode = mode;
    syncTransitionSwitcherActive(mode);
}

function syncLanguageUI() {
    const currentLang = modalState.draftLanguage || 'auto';
    if (dom.languageList) {
        dom.languageList.querySelectorAll('button[data-lang]').forEach(el => {
            const btn = /** @type {HTMLButtonElement} */ (el);
            const isSelected = btn.dataset.lang === currentLang;
            btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
            const check = btn.querySelector('.lang-check');
            if (isSelected) {
                btn.classList.add('selected');
                check?.classList.remove('opacity-0');
            } else {
                btn.classList.remove('selected');
                check?.classList.add('opacity-0');
            }
        });
    }
}
