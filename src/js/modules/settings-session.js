/** 设置会话状态、选项卡切换、阶段锁与草稿重基；业务保存见 settings.js，数据维护见 settings-data.js。 */
import { t, getLocale, getLanguagePreference, resolveLocale } from '../core/i18n.js';
import { renderEditList, collectEditData } from './bookmark-editor.js';
import { showConfirm } from '../core/dialogs.js';
import { CONFIG } from '../config/constants.js';
import { state, modalState, pageData } from '../state/store.js';
import { replaceBookmarkDraft } from '../state/bookmark-draft.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';
import { applyBgEffects, flushBgEffects } from '../core/wallpaper-renderer.js';
import { closeWallpaperDraft, showWallpaperDraft, updateWallpaperStatusUI, updatePresetBgCardsUI, revertDraftWallpaper } from './wallpaper.js';
import { getCommittedWallpaperUrl, getSavedMaskOpacity } from './wallpaper-store.js';
import { getTransitionMode, syncTransitionSwitcherActive } from '../core/screen-state.js';
import { cancelDragSort } from './bookmark-drag.js';
import { closeBookmarkPicker } from './bookmark-picker.js';

/** @typedef {ReturnType<typeof readCommittedSettings>} SettingsBaseline */
/** @typedef {{ initial?: SettingsBaseline, baseline?: SettingsBaseline, bookmarkRevision?: string }} EditSession */

/** @type {EditSession | null} */
let editSession = null;
/** @type {AbortController | null} */
let activeImportController = null;
/** @type {HTMLElement[] | null} */
let settingsTabsList = null;
/** @type {HTMLElement[] | null} */
let settingsPanelsList = null;

export function getEditSession() {
    return editSession;
}

/** @param {EditSession | null} session */
export function setEditSession(session) {
    editSession = session;
}

/** @param {AbortController | null} controller */
export function setActiveImportController(controller) {
    activeImportController = controller;
}

export function cancelPendingImport() {
    if (activeImportController) {
        activeImportController.abort();
        activeImportController = null;
    }
}

/** @template T @param {() => T} commit */
export async function commitBookmarks(commit) {
    // 同源标签在同一把锁内比较版本并写入。不可用时仍检查已落盘的版本。
    try {
        return navigator.locks ? await navigator.locks.request(CONFIG.KEYS.BOOKMARKS, commit) : commit();
    } catch {
        return false;
    }
}

export function readCommittedSettings() {
    return {
        bookmarks: pageData.bookmarks,
        draftMaskOpacity: getSavedMaskOpacity(),
        draftTransitionMode: getTransitionMode(),
        draftWallpaper: getCommittedWallpaperUrl(),
        draftLanguage: getLanguagePreference()
    };
}

function getSettingsPanels() {
    if (!settingsPanelsList || !settingsPanelsList.every(el => el.isConnected)) {
        settingsPanelsList = Array.from(document.querySelectorAll('.settings-tab-panel'));
    }
    return settingsPanelsList;
}

export function getSettingsTabs() {
    if (!settingsTabsList || !settingsTabsList.every(el => el.isConnected)) {
        settingsTabsList = Array.from(document.querySelectorAll('.settings-tab-btn'));
    }
    return settingsTabsList;
}

/** @param {import('../types').ModalState['phase']} phase */
export function setEditPhase(phase) {
    modalState.phase = phase;
    const committing = phase === 'committing';
    const saving = committing || phase === 'preparing-save';
    if (dom.saveEditBtn) {
        dom.saveEditBtn.disabled = saving;
        if (saving) dom.saveEditBtn.setAttribute('aria-busy', 'true');
        else dom.saveEditBtn.removeAttribute('aria-busy');
    }
    if (dom.cancelEditBtn) dom.cancelEditBtn.disabled = committing;
    if (dom.languageBtn) dom.languageBtn.disabled = saving;
    getSettingsPanels().forEach(panel => { panel.inert = committing; });
}

export function beginEditCommit() {
    closeLanguageModal();
    closeBookmarkPicker();
    cancelDragSort();
    cancelPendingImport();
    setEditPhase('committing');
}

export function finishEdit() {
    closeEditModal();
    const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
    if (resolveLocale(getLanguagePreference(), languages) !== getLocale()) location.reload();
}

/** 保留有修改的草稿，其余字段跟随新的提交基线。 */
/** @param {SettingsBaseline} before @param {SettingsBaseline} after */
export function rebaseDraft(before, after) {
    for (const field of /** @type {const} */ (['draftMaskOpacity', 'draftTransitionMode', 'draftWallpaper', 'draftLanguage'])) {
        if (modalState[field] === before[field]) Object.assign(modalState, { [field]: after[field] });
    }
    if (!modalState.bookmarksChanged) {
        replaceBookmarkDraft(after.bookmarks);
        renderEditList();
    }
    if (modalState.draftWallpaper !== after.draftWallpaper && modalState.draftWallpaper) {
        showWallpaperDraft(modalState.draftWallpaper);
    } else {
        updateWallpaperStatusUI(after.draftWallpaper);
        updatePresetBgCardsUI(after.draftWallpaper);
    }
    applyBgEffects(modalState.draftMaskOpacity ?? after.draftMaskOpacity);
    syncTransitionSwitcherActive(modalState.draftTransitionMode);
    syncLanguageUI();
}

/** @param {string} targetTabId */
export function switchSettingsTab(targetTabId) {
    getSettingsTabs().forEach(tab => {
        const isTarget = tab.dataset.tab === targetTabId;
        tab.classList.toggle('active', isTarget);
        tab.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        tab.tabIndex = isTarget ? 0 : -1;
    });
    getSettingsPanels().forEach(panel => {
        panel.classList.toggle('hidden', panel.id !== targetTabId);
    });
    if (targetTabId === 'tabAppearance') {
        updatePresetBgCardsUI(modalState.draftWallpaper);
    }
}

export function cancelEditModal() {
    // 提交开始后不能恢复旧预览，否则会与已提交的设置不一致。
    if (!state.editOpen || modalState.phase === 'committing') return;
    if (modalState.phase !== 'opening') {
        applyBgEffects(getSavedMaskOpacity());
        modalState.draftTransitionMode = getTransitionMode();
        syncTransitionSwitcherActive(modalState.draftTransitionMode);
        revertDraftWallpaper();
    }
    finishEdit();
}

export function closeEditModal() {
    if (!state.editOpen) return;
    closeLanguageModal();
    closeBookmarkPicker();
    cancelPendingImport();
    // 保存关闭时即使后台暂停了 rAF，也同步落定最后的预览；取消已先覆盖并清队列。
    flushBgEffects();
    cancelDragSort();
    closeWallpaperDraft();
    editSession = null;
    setEditPhase('closed');
    OverlayStack.pop('editModal');

    closeWallpaperUrlInput();
}

/** 关闭并清空壁纸直链输入行，恢复操作按钮组 */
export function closeWallpaperUrlInput() {
    const inputRow = dom.urlBgInputRow;
    if (inputRow && !inputRow.classList.contains('hidden')) {
        const restoreFocus = inputRow.contains(document.activeElement);
        inputRow.classList.add('hidden');
        const btnGroup = dom.urlBgBtnGroup;
        btnGroup?.classList.remove('hidden');
        const urlInput = dom.urlBgInput;
        if (urlInput) urlInput.value = '';
        if (restoreFocus) dom.urlBgBtn?.focus({ preventScroll: true });
    }
}

/** @param {string} title @param {boolean} [allowEmpty] */
export function validateBookmarkDraft(title, allowEmpty = false) {
    let invalidDraft = false;
    const data = collectEditData(() => { invalidDraft = true; });
    if (!allowEmpty && data.length === 0) {
        showConfirm(t('ui.keep.at.least.one.bookmark.with'), null, title);
        return null;
    }
    if (!invalidDraft) return data;
    if (OverlayStack.top()?.id === 'editModal') switchSettingsTab('tabBookmarks');
    showConfirm(t('settings.invalidBookmarkDraft'), null, title);
    return null;
}

export function closeLanguageModal() {
    OverlayStack.pop('languageModal');
}

export function syncLanguageUI() {
    const currentLang = modalState.draftLanguage || 'auto';
    dom.languageList?.querySelectorAll('button[data-lang]').forEach(el => {
        const btn = /** @type {HTMLButtonElement} */ (el);
        const isSelected = btn.dataset.lang === currentLang;
        btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
        btn.autofocus = isSelected;
        btn.classList.toggle('selected', isSelected);
        btn.querySelector('.lang-check')?.classList.toggle('opacity-0', !isSelected);
    });
}
