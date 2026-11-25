import { t } from '../core/i18n.js';
/**
 * 设置事件装配
 *
 * 设置按钮、书签草稿编辑与拖拽排序的事件装配。
 */
import { CONFIG } from '../config/constants.js';
import { checkImageReady } from '../utils/favicon.js';
import { handleRovingKeyNav } from '../utils/helpers.js';

import { modalState, state } from '../state/store.js';
import { updateBookmarkDraft, removeBookmarkDraft } from '../state/bookmark-draft.js';
import { dom } from '../state/dom.js';

import { initDragSort } from './bookmark-drag.js';

import { uploadWallpaper, previewDraftWallpaper, resetDraftWallpaper } from './wallpaper.js';
import { openEditModal, saveEditModal, previewDraftMaskOpacity, openLanguageModal, saveLanguageModal, cancelLanguageModal, selectLanguage, selectDraftTransitionMode, openWallpaperUrlInput, submitWallpaperUrlInput } from './settings.js';
import { cancelEditModal, switchSettingsTab, closeWallpaperUrlInput, getSettingsTabs } from './settings-session.js';
import { resetAllSettings, importBookmarksJSON, exportBookmarksJSON, clearOfflineCache } from './settings-data.js';
import { openShortcutModal, closeShortcutModal, openCreditsModal, closeCreditsModal } from './settings-static-modals.js';
import { openBookmarkPicker, closeBookmarkPicker, addBookmarkFromPicker } from './bookmark-picker.js';
import { getEditFaviconInner, handleEditIconError, appendDraftBookmarkRow } from './bookmark-editor.js';
import { animateBookmarkRemoval } from './bookmark-motion.js';

function bindLanguageAndModalEvents() {
    dom.languageBtn?.addEventListener('click', e => {
        e.stopPropagation();
        openLanguageModal(dom.languageBtn);
    });
    dom.doneLanguageBtn?.addEventListener('click', saveLanguageModal);
    dom.cancelLanguageBtn?.addEventListener('click', cancelLanguageModal);
    dom.languageList?.addEventListener('click', e => {
        const targetEl = e.target instanceof Element ? e.target : null;
        const btn = /** @type {HTMLElement|null} */ (targetEl?.closest('[data-lang]'));
        if (btn?.dataset.lang) selectLanguage(btn.dataset.lang);
    });
    dom.languageList?.addEventListener('keydown', e => {
        const items = /** @type {HTMLElement[]} */ (Array.from(dom.languageList?.querySelectorAll('button[data-lang]') || []));
        const currentBtn = /** @type {HTMLElement|null} */ (e.target instanceof Element ? e.target.closest('[data-lang]') : null);
        handleRovingKeyNav(e, items, currentBtn, nextBtn => {
            if (nextBtn.dataset.lang) selectLanguage(nextBtn.dataset.lang);
        });
    });

    const editButton = dom.editBookmarksBtn;
    editButton?.addEventListener('click', () => openEditModal(editButton));
    dom.togglePickerBtn?.addEventListener('click', () => openBookmarkPicker(dom.togglePickerBtn));
    dom.donePickerBtn?.addEventListener('click', closeBookmarkPicker);
    dom.doneShortcutBtn?.addEventListener('click', closeShortcutModal);
    dom.openShortcutFromSettingsBtn?.addEventListener('click', () => openShortcutModal(dom.openShortcutFromSettingsBtn));
    dom.openCreditsFromSettingsBtn?.addEventListener('click', () => openCreditsModal(dom.openCreditsFromSettingsBtn));
    dom.doneCreditsBtn?.addEventListener('click', closeCreditsModal);
    dom.resetEditBtn?.addEventListener('click', resetAllSettings);

    const settingsTabs = getSettingsTabs() || [];
    settingsTabs.forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            if (btn.dataset.tab) switchSettingsTab(btn.dataset.tab);
        });
        btn.addEventListener('keydown', e => {
            handleRovingKeyNav(e, settingsTabs, btn, nextTab => {
                if (nextTab.dataset.tab) switchSettingsTab(nextTab.dataset.tab);
            });
        });
    });
}

function bindImportDropzoneEvents() {
    dom.exportJsonBtn?.addEventListener('click', exportBookmarksJSON);
    dom.importJsonInput?.addEventListener('change', e => {
        const targetInput = e.target instanceof HTMLInputElement ? e.target : null;
        const file = targetInput?.files?.[0];
        if (file) importBookmarksJSON(file);
        if (targetInput) targetInput.value = '';
    });

    const dropzone = dom.jsonDropzone;
    if (!dropzone) return;
    dropzone.addEventListener('click', () => dom.importJsonInput?.click());
    dropzone.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            dom.importJsonInput?.click();
        }
    });
    dropzone.addEventListener('dragover', e => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', e => {
        e.preventDefault();
        e.stopPropagation();
        if (e.relatedTarget instanceof Node && dropzone.contains(e.relatedTarget)) return;
        dropzone.classList.remove('drag-over');
    });
    dropzone.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('drag-over');
        const file = e.dataTransfer?.files[0];
        if (file) importBookmarksJSON(file);
    });
}

function bindBookmarkEditListEvents() {
    dom.pickerContent?.addEventListener('click', e => {
        const targetEl = e.target instanceof Element ? e.target : null;
        const item = /** @type {HTMLButtonElement|null} */ (targetEl?.closest('.picker-item'));
        if (!item || item.disabled || !item.dataset.url) return;
        addBookmarkFromPicker(item.dataset.url);
    });
    dom.addBookmarkBtn?.addEventListener('click', () => {
        appendDraftBookmarkRow({ focus: true });
    });

    const editList = dom.editList;
    if (!editList) return;

    /** 每行独立防抖，避免编辑下一行时取消上一行的预览。 @type {WeakMap<HTMLElement, ReturnType<typeof setTimeout>>} */
    const editFaviconTimers = new WeakMap();
    /** @type {Set<ReturnType<typeof setTimeout>>} */
    const activeFaviconTimers = new Set();
    const clearAllFaviconTimers = () => {
        for (const timer of activeFaviconTimers) clearTimeout(timer);
        activeFaviconTimers.clear();
    };
    dom.cancelEditBtn?.addEventListener('click', clearAllFaviconTimers);
    dom.saveEditBtn?.addEventListener('click', clearAllFaviconTimers);

    editList.addEventListener('input', e => {
        const target = e.target instanceof HTMLInputElement ? e.target : null;
        const row = /** @type {HTMLElement|null} */ (target?.closest('.edit-row-card'));
        if (!row || !target) return;
        const fields = target.classList.contains('edit-name') ? { name: target.value }
            : target.classList.contains('edit-url') ? { url: target.value } : null;
        if (!fields || !row.dataset.id) return;
        const item = updateBookmarkDraft(row.dataset.id, fields);
        if (!item) return;
        if (fields.name !== undefined) {
            row.querySelector('.drag-handle')?.setAttribute('aria-label', t('bookmark.reorderLabel', { name: item.name }));
        }

        const faviconBox = row.querySelector('.edit-favicon-box');
        if (!faviconBox) return;
        const initial = [...(item.name || '?').trim()][0]?.toUpperCase() || '?';
        const existingImg = /** @type {HTMLElement|null} */ (faviconBox.querySelector('.edit-favicon-img'));
        const existingInitial = faviconBox.querySelector('.edit-favicon-initial');
        if (existingImg) existingImg.dataset.initial = initial;
        if (existingInitial) existingInitial.textContent = initial;

        if (target.classList.contains('edit-url')) {
            const previousTimer = editFaviconTimers.get(row);
            if (previousTimer !== undefined) {
                clearTimeout(previousTimer);
                activeFaviconTimers.delete(previousTimer);
            }
            const timer = setTimeout(() => {
                activeFaviconTimers.delete(timer);
                editFaviconTimers.delete(row);
                if (!state.editOpen || !row.isConnected || !modalState.draftBookmarks.includes(item)) return;
                faviconBox.innerHTML = getEditFaviconInner(item);
                const newImg = /** @type {HTMLImageElement|null} */ (faviconBox.querySelector('.edit-favicon-img'));
                if (newImg) checkImageReady(newImg, handleEditIconError);
            }, CONFIG.SUGGEST.DEBOUNCE_MS);
            editFaviconTimers.set(row, timer);
            activeFaviconTimers.add(timer);
        }
    });

    editList.addEventListener('click', e => {
        const targetEl = e.target instanceof Element ? e.target : null;
        const item = /** @type {HTMLElement|null} */ (targetEl?.closest('.del-btn')?.closest('.edit-row-card'));
        if (!item) return;
        const timer = editFaviconTimers.get(item);
        if (timer !== undefined) {
            clearTimeout(timer);
            activeFaviconTimers.delete(timer);
            editFaviconTimers.delete(item);
        }
        if (item.dataset.id) removeBookmarkDraft(item.dataset.id);
        animateBookmarkRemoval(editList, item);
    });
}

function bindWallpaperEvents() {
    dom.presetWallpaperGrid?.addEventListener('click', e => {
        const card = e.target instanceof Element ? e.target.closest('.preset-bg-card') : null;
        if (!(card instanceof HTMLElement) || !dom.presetWallpaperGrid?.contains(card)) return;
        e.stopPropagation();
        if (card.dataset.bg) previewDraftWallpaper(card.dataset.bg);
    });

    dom.uploadBgBtn?.addEventListener('click', () => dom.uploadBgInput?.click());
    dom.uploadBgInput?.addEventListener('change', e => {
        const targetInput = e.target instanceof HTMLInputElement ? e.target : null;
        const file = targetInput?.files?.[0];
        if (targetInput) targetInput.value = '';
        if (file) uploadWallpaper(file);
    });

    if (dom.urlBgBtn) {
        dom.urlBgBtn.addEventListener('click', openWallpaperUrlInput);
        dom.urlBgConfirmBtn?.addEventListener('click', submitWallpaperUrlInput);
        dom.urlBgCancelBtn?.addEventListener('click', closeWallpaperUrlInput);
        dom.urlBgInput?.addEventListener('keydown', e => {
            if (e.isComposing || e.keyCode === CONFIG.SECURITY.IME_COMPOSITION_KEY_CODE) return;
            if (e.key === 'Enter') { e.preventDefault(); submitWallpaperUrlInput(); }
            if (e.key === 'Escape') { e.preventDefault(); closeWallpaperUrlInput(); }
        });
    }

    dom.resetBgBtn?.addEventListener('click', async () => {
        await resetDraftWallpaper();
    });
    dom.maskOpacityInput?.addEventListener('input', e => {
        const targetInput = e.target instanceof HTMLInputElement ? e.target : null;
        if (targetInput) previewDraftMaskOpacity(targetInput.value);
    });
    dom.settingsTransitionGrid?.addEventListener('click', e => {
        const btn = /** @type {HTMLElement|null} */ (e.target instanceof Element ? e.target.closest('.settings-transition-btn') : null);
        if (btn?.dataset.mode) selectDraftTransitionMode(btn.dataset.mode);
    });
}

export function bindEditEvents() {
    bindLanguageAndModalEvents();
    bindImportDropzoneEvents();
    bindBookmarkEditListEvents();
    bindWallpaperEvents();

    dom.cancelEditBtn?.addEventListener('click', cancelEditModal);
    dom.saveEditBtn?.addEventListener('click', saveEditModal);
    dom.clearCacheBtn?.addEventListener('click', clearOfflineCache);

    initDragSort();
}
