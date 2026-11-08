/**
 * 设置面板与弹窗管理系统
 * 负责设置弹窗生命周期、外观与壁纸配置、语言切换及数据导入导出的统一协调。
 * 具体书签草稿编辑见 bookmark-editor.js，预置目录挑选器见 bookmark-picker.js。
 */
import { t, getLanguagePreference } from '../core/i18n.js';
import { updateAllBookmarkCounters, renderEditList, collectEditData } from './bookmark-editor.js';
import { showConfirm } from '../core/dialogs.js';
import { CONFIG, backgrounds, IS_MAC } from '../config/constants.js';
import { DEFAULT_ENGINE } from '../config/engines.js';
import { escapeHtml, safeUrl } from '../utils/helpers.js';
import { normalizeUrl, normalizeBookmark } from '../utils/bookmark-model.js';
import { storageGet, storageSet, storageRemove } from '../utils/storage.js';
import { state, modalState, pageData } from '../state/store.js';
import { replaceBookmarkDraft } from '../state/bookmark-draft.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';
import { applyWallpaper } from '../core/wallpaper-renderer.js';
import { flushWallpaperSelection, getEffectiveCustomWallpaper, updateWallpaperStatusUI, updatePresetBgCardsUI, clearCustomWallpaper, renderPresetWallpapers, commitWallpaperSelection, revertDraftWallpaper, applyBgEffects, flushBgEffects } from './wallpaper.js';
import { saveUserBookmarks, resetUserBookmarks } from './bookmarks.js';
import { closeDropdown, hideSuggestions, setEngine } from './search.js';
import { getTransitionMode, syncTransitionSwitcherActive, setTransitionMode } from '../core/screen-state.js';
import { cancelDragSort } from './bookmark-drag.js';
import { closeBookmarkPicker } from './bookmark-picker.js';
import { refreshWeatherDisplay } from './weather.js';
import { getCategoryIconHTML } from '../utils/favicon.js';

/** @type {Record<string, string>} */
const KBD = {
    'kbd-any': `<kbd class="kbd-text">${escapeHtml(t('ui.any.character.key'))}</kbd>`,
    'kbd-slash': IS_MAC ? '<kbd>⌘</kbd><kbd>/</kbd>' : '<kbd>Ctrl</kbd><kbd>/</kbd>',
    'kbd-bg': IS_MAC ? '<kbd>⌘</kbd><kbd>B</kbd>' : '<kbd>Ctrl</kbd><kbd>B</kbd>',
    'kbd-newtab': IS_MAC ? '<kbd>⌘</kbd><kbd>↵</kbd>' : '<kbd>Alt</kbd><kbd>↵</kbd>',
    'kbd-tab': IS_MAC ? '<kbd>Tab</kbd><span class="text-white/35 text-2xs select-none">/</span><kbd>⇧ Tab</kbd>' : '<kbd>Tab</kbd><span class="text-white/35 text-2xs select-none">/</span><kbd>Shift+Tab</kbd>'
};

function renderShortcutModalList() {
    const container = dom.shortcutModalList;
    if (!container || container.hasChildNodes()) return;
    container.innerHTML = CONFIG.SHORTCUTS.map(sec => `
        <div>
            <h4 class="text-2xs font-semibold uppercase tracking-wider text-white/45 mb-1.5 px-1">${escapeHtml(sec.group)}</h4>
            <div class="inset-card">
                ${sec.items.map(item => `
                    <div class="inset-card-row">
                        <span class="text-white/85 text-xs">${escapeHtml(item.desc)}</span>
                        <span class="keycap shrink-0">${item.kbdId ? (KBD[item.kbdId] || `<kbd>${escapeHtml(item.fallback || '')}</kbd>`) : (item.rawHtml || '')}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

function renderCreditsModalList() {
    const container = dom.creditsList;
    if (!container || container.hasChildNodes()) return;
    container.innerHTML = CONFIG.CREDITS.map(item => `
        <div class="py-3 first:pt-1 last:pb-1 flex items-center justify-between gap-3">
            <div class="flex items-center gap-2.5 min-w-0">
                <span class="size-5 shrink-0 select-none flex items-center justify-center">${getCategoryIconHTML(item.icon, 'size-4.5')}</span>
                <div class="truncate">
                    <div class="font-medium text-white/90 truncate">${escapeHtml(item.name)}</div>
                    <div class="text-2xs text-white/55 truncate mt-0.5">${escapeHtml(item.desc)}</div>
                </div>
            </div>
            <a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer" class="shrink-0 text-2xs px-2.5 py-1 rounded-md bg-white/8 hover:bg-white/15 border border-white/12 hover:border-white/20 text-white/80 hover:text-white glass-interactive flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50" title="${escapeHtml(t('credits.license', { name: item.name }))}">
                ${escapeHtml(item.license)}
                <svg class="size-2.5 opacity-70" aria-hidden="true"><use href="#icon-external"/></svg>
            </a>
        </div>
    `).join('');
}

let editOpenRequestId = 0;
let importRequestId = 0;
/** @type {NodeListOf<HTMLElement> | null} */
let cachedSettingsTabs = null;
/** @type {NodeListOf<HTMLElement> | null} */
let cachedSettingsPanels = null;

/** 提交状态是业务判断的唯一来源，控件仅反映该状态。 @param {boolean} committing */
function setEditCommitting(committing) {
    modalState.committing = committing;
    if (dom.cancelEditBtn) dom.cancelEditBtn.disabled = committing;
    if (dom.languageBtn) dom.languageBtn.disabled = committing;
    cachedSettingsPanels?.forEach(panel => { panel.inert = committing; });
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
    }
}

/** 滑块草稿与无障碍读数即时更新，全屏视觉每帧只消费最后一次输入。 */
/** @param {string | number} value */
export function previewDraftMaskOpacity(value) {
    modalState.draftMaskOpacity = parseInt(String(value), 10) || 0;
    applyBgEffects(modalState.draftMaskOpacity, true);
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
    // 提交开始后不能恢复旧预览，否则会与已提交的设置不一致。
    if (modalState.committing) return;
    applyBgEffects(storageGet(CONFIG.KEYS.MASK_OPACITY, CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY));
    modalState.draftTransitionMode = getTransitionMode();
    syncTransitionSwitcherActive(modalState.draftTransitionMode);
    revertDraftWallpaper();
    closeEditModal();
}

export function closeEditModal() {
    closeLanguageModal();
    // 保存关闭时即使后台暂停了 rAF，也同步落定最后的预览；取消已先覆盖并清队列。
    flushBgEffects();
    cancelDragSort();
    state.editOpen = false;
    editOpenRequestId++;
    if (dom.saveEditBtn) {
        dom.saveEditBtn.disabled = false;
        dom.saveEditBtn.removeAttribute('aria-busy');
    }
    setEditCommitting(false);
    OverlayStack.pop('editModal');
    const editBtn = dom.editBookmarksBtn;
    editBtn?.setAttribute('aria-expanded', 'false');

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
    if (!file || !state.editOpen || modalState.committing) return;
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
    if (!state.editOpen || modalState.committing || dom.saveEditBtn?.disabled) return;
    const requestId = editOpenRequestId;
    showConfirm(t('ui.restore.all.defaults.this.immediately.removes'), async () => {
        if (!state.editOpen || requestId !== editOpenRequestId || modalState.committing || dom.saveEditBtn?.disabled) return;
        cancelDragSort();
        importRequestId++;
        const previousDraft = [...modalState.draftBookmarks];
        setEditCommitting(true);
        if (dom.saveEditBtn) {
            dom.saveEditBtn.disabled = true;
            dom.saveEditBtn.setAttribute('aria-busy', 'true');
        }
        try {
            const wallpaperCleared = await clearCustomWallpaper(0);
            // 内部关闭或重新打开设置后，旧重置不得清空新草稿或关闭新窗口。
            if (!state.editOpen || requestId !== editOpenRequestId) return;
            if (!wallpaperCleared) {
                showConfirm(t('ui.could.not.clear.wallpaper.storage.your'), null, t('ui.reset.failed'));
                return;
            }
            /** @type {(keyof typeof CONFIG.KEYS)[]} */
            const keys = ['PREFERRED_ENGINE', 'WALLPAPER_META', 'MASK_OPACITY',
                'BG', 'NAV_DISCOVERED', 'WEATHER_CACHE', 'WEATHER_LOC',
                'THEME_CACHE', 'TINT_CACHE', 'TRANSITION_MODE', 'LANGUAGE', 'TEMP_UNIT'];
            const previousLanguage = getLanguagePreference();
            const removed = keys.map(key => storageRemove(CONFIG.KEYS[key]));
            refreshWeatherDisplay();
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
                replaceBookmarkDraft(previousDraft);
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
        } finally {
            if (requestId === editOpenRequestId) {
                if (dom.saveEditBtn) {
                    dom.saveEditBtn.disabled = false;
                    dom.saveEditBtn.removeAttribute('aria-busy');
                }
                setEditCommitting(false);
            }
        }
    }, t('ui.reset.all.settings'));
}

/**
 * 保存设置面板中的全部草稿
 *
 * 提交时序与事务语义说明：
 * - 等待壁纸预览后收集最新草稿，再依次提交书签、遮罩、动效、壁纸和语言。
 * - 设计权衡：不提供跨 LocalStorage 与 IndexedDB 的整体原子事务。
 *   若中途某项持久化失败，已提交的项不会回滚，草稿保留在弹窗内以便用户排查或重试。
 */
export async function saveEditModal() {
    const saveBtn = dom.saveEditBtn;
    if (!state.editOpen || modalState.committing || !saveBtn || saveBtn.disabled) return;
    const requestId = editOpenRequestId;
    saveBtn.disabled = true;
    saveBtn.setAttribute('aria-busy', 'true');
    try {
        const wallpaperSaved = await flushWallpaperSelection();
        // 取消或重新打开设置后，旧保存任务不得提交草稿、弹提示或关闭新窗口。
        if (!state.editOpen || requestId !== editOpenRequestId) return;
        if (!wallpaperSaved) {
            showConfirm(t('ui.the.wallpaper.has.not.been.saved'), null, t('ui.could.not.save'));
            return;
        }

        const data = collectEditData();
        if (data.length === 0) {
            showConfirm(t('ui.keep.at.least.one.bookmark.with'), null, t('ui.could.not.save'));
            return;
        }
        // 从此刻起提交同一份草稿；等待预览期间仍可编辑和取消。
        closeLanguageModal();
        closeBookmarkPicker();
        cancelDragSort();
        importRequestId++;
        setEditCommitting(true);

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
            setEditCommitting(false);
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
    dom.languageList?.querySelectorAll('button[data-lang]').forEach(el => {
        const btn = /** @type {HTMLButtonElement} */ (el);
        const isSelected = btn.dataset.lang === currentLang;
        btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
        btn.classList.toggle('selected', isSelected);
        btn.querySelector('.lang-check')?.classList.toggle('opacity-0', !isSelected);
    });
}

/** 确认后清理当前部署的离线缓存并刷新；不删除用户偏好。 */
export function clearOfflineCache() {
    const clearBtn = dom.clearCacheBtn;
    if (!clearBtn || clearBtn.disabled) return;
    const isExtension = window.__GLASS_EXTENSION__;

    if (!('caches' in window)) {
        showConfirm(isExtension ? t('ui.this.browser.does.not.support.clearing') : t('ui.offline.caching.is.unavailable.or.the'), null, t('ui.notice'), clearBtn);
        return;
    }

    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const msg = isExtension
        ? t('ui.clear.temporary.caches.and.reload.saved')
        : isOffline
        ? t('ui.you.are.offline.clearing.the.offline')
        : t('ui.clear.the.offline.cache.cached.app');

    showConfirm(
        msg,
        async () => {
            clearBtn.disabled = true;
            const scope = new URL('./', location.href);
            const cachePrefix = 'glass-scope-' + encodeURIComponent(scope.pathname) + '-';
            try {
                if ('caches' in window) {
                    const keys = await caches.keys();
                    // 网页图标池跨部署共享；扩展拥有独立来源，可清理自己的图标池。
                    await Promise.all(keys.filter(key => key.startsWith(cachePrefix) ||
                        (isExtension && key === CONFIG.CACHE.FAVICON)).map(key => caches.delete(key)));
                }
                if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(regs.filter(r => r.scope === scope.href).map(r => r.unregister()));
                }
            } catch (err) {
                console.warn('离线缓存或服务工作线程清理异常:', err);
            } finally {
                location.reload();
            }
        },
        isExtension ? t('ui.clear.cache') : t('ui.clear.offline.cache'),
        clearBtn,
        isExtension ? t('ui.clear.and.reload') : t('ui.clear.cache.and.reload')
    );
}
