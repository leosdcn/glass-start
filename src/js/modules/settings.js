/**
 * 设置面板与弹窗管理系统
 * 负责设置弹窗生命周期、外观与壁纸配置、语言切换及数据导入导出的统一协调。
 * 具体书签草稿编辑见 bookmark-editor.js，预置目录挑选器见 bookmark-picker.js。
 */
import { t, getLocale, getLanguagePreference, resolveLocale } from '../core/i18n.js';
import { renderEditList, collectEditData } from './bookmark-editor.js';
import { showConfirm } from '../core/dialogs.js';
import { CONFIG, IS_MAC } from '../config/constants.js';
import { DEFAULT_ENGINE } from '../config/engines.js';
import { escapeHtml, safeUrl } from '../utils/helpers.js';
import { normalizeBookmark, normalizeBookmarks } from '../utils/bookmark-model.js';
import { storageGet, storageSet, storageRemove } from '../utils/storage.js';
import { state, modalState, pageData } from '../state/store.js';
import { replaceBookmarkDraft } from '../state/bookmark-draft.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';
import { flushWallpaperSelection, prepareWallpaperDraft, getCommittedWallpaperUrl, closeWallpaperDraft, pauseWallpaperDraft, showWallpaperDraft, updateWallpaperStatusUI, updatePresetBgCardsUI, clearCustomWallpaper, renderPresetWallpapers, commitWallpaperSelection, revertDraftWallpaper, applyBgEffects, flushBgEffects, getSavedMaskOpacity, commitWallpaperDimming, showWallpaperError, previewDraftWallpaper } from './wallpaper.js';
import { loadBookmarks, saveUserBookmarks, resetUserBookmarks, getImportedBookmarks } from './bookmarks.js';
import { closeDropdown, hideSuggestions, setEngine } from './search.js';
import { getTransitionMode, syncTransitionSwitcherActive, setTransitionMode, resetNavDiscovery } from '../core/screen-state.js';
import { cancelDragSort } from './bookmark-drag.js';
import { closeBookmarkPicker } from './bookmark-picker.js';
import { resetWeather } from './weather.js';
import { getCategoryIconHTML } from '../utils/favicon.js';

/** @type {Record<string, string>} */
const KBD = {
    'kbd-any': `<kbd class="kbd-badge">${escapeHtml(t('ui.any.character.key'))}</kbd>`,
    'kbd-slash': IS_MAC ? '<kbd>⌘</kbd><kbd>/</kbd>' : '<kbd>Ctrl</kbd><kbd>/</kbd>',
    'kbd-bg': IS_MAC ? '<kbd>⌘</kbd><kbd>B</kbd>' : '<kbd>Ctrl</kbd><kbd>B</kbd>',
    'kbd-newtab': IS_MAC ? '<kbd>⌘</kbd><kbd>↵</kbd>' : '<kbd>Alt</kbd><kbd>↵</kbd>',
    'kbd-tab': IS_MAC ? '<kbd>Tab</kbd><span class="text-white/35 text-2xs select-none">/</span><kbd>⇧ Tab</kbd>' : '<kbd>Tab</kbd><span class="text-white/35 text-2xs select-none">/</span><kbd>Shift+Tab</kbd>'
};

function renderShortcutModalList() {
    const container = dom.shortcutModalList;
    if (!container || container.hasChildNodes()) return;
    container.innerHTML = CONFIG.SHORTCUTS.map(sec => `
        <div class="flex flex-col">
            <h4 class="text-xs font-semibold text-white/80 mb-2 px-1 flex items-center select-none">${escapeHtml(sec.group)}</h4>
            <div class="flex-1 flex flex-col justify-between">
                ${sec.items.map(item => `
                    <div class="shortcut-row">
                        <span class="text-white/85 text-xs select-none">${escapeHtml(item.desc)}</span>
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

/** @typedef {ReturnType<typeof readCommittedSettings>} SettingsBaseline */
/** @type {{ initial?: SettingsBaseline, baseline?: SettingsBaseline, bookmarkRevision?: string } | null} */
let editSession = null;
/** @type {AbortController | null} */
let activeImportController = null;

/** @template T @param {() => T} commit */
async function commitBookmarks(commit) {
    // 同源标签在同一把锁内比较版本并写入。不可用时仍检查已落盘的版本。
    try {
        return navigator.locks ? await navigator.locks.request(CONFIG.KEYS.BOOKMARKS, commit) : commit();
    } catch {
        return false;
    }
}

function readCommittedSettings() {
    return {
        bookmarks: pageData.bookmarks,
        draftMaskOpacity: getSavedMaskOpacity(),
        draftTransitionMode: getTransitionMode(),
        draftWallpaper: getCommittedWallpaperUrl(),
        draftLanguage: getLanguagePreference()
    };
}

const settingLabels = /** @type {const} */ ({
    bookmarks: 'settings.bookmarks',
    draftMaskOpacity: 'ui.background.dimming',
    draftTransitionMode: 'ui.page.transition',
    draftWallpaper: 'settings.wallpaper'
});

function cancelPendingImport() {
    if (activeImportController) {
        activeImportController.abort();
        activeImportController = null;
    }
}

/** @type {HTMLElement[] | null} */
let settingsTabsList = null;
/** @type {HTMLElement[] | null} */
let settingsPanelsList = null;

function getSettingsPanels() {
    if (!settingsPanelsList) settingsPanelsList = Array.from(document.querySelectorAll('.settings-tab-panel'));
    return settingsPanelsList;
}

export function getSettingsTabs() {
    if (!settingsTabsList) settingsTabsList = Array.from(document.querySelectorAll('.settings-tab-btn'));
    return settingsTabsList;
}

/** @param {import('../types').ModalState['phase']} phase */
function setEditPhase(phase) {
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

function beginEditCommit() {
    closeLanguageModal();
    closeBookmarkPicker();
    cancelDragSort();
    cancelPendingImport();
    setEditPhase('committing');
}

function finishEdit() {
    closeEditModal();
    const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
    if (resolveLocale(getLanguagePreference(), languages) !== getLocale()) location.reload();
}

/** 保留有修改的草稿，其余字段跟随新的提交基线。 */
/** @param {SettingsBaseline} before @param {SettingsBaseline} after */
function rebaseDraft(before, after) {
    for (const field of /** @type {const} */ (['draftMaskOpacity', 'draftTransitionMode', 'draftWallpaper', 'draftLanguage'])) {
        if (modalState[field] === before[field]) Object.assign(modalState, { [field]: after[field] });
    }
    if (!modalState.bookmarksChanged) replaceBookmarkDraft(after.bookmarks);
    renderEditList();
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
    /** @type {NonNullable<typeof editSession>} */
    const session = {};
    editSession = session;
    closeDropdown();
    hideSuggestions();
    const editBtn = dom.editBookmarksBtn;
    editBtn?.setAttribute('aria-expanded', 'true');
    setEditPhase('opening');
    const trigger = document.activeElement;
    const isCurrent = () => editSession === session;
    await prepareWallpaperDraft(isCurrent);
    if (!isCurrent()) return;
    session.bookmarkRevision = loadBookmarks();
    const committed = session.initial = session.baseline = readCommittedSettings();
    const { bookmarks, ...draft } = committed;
    Object.assign(modalState, draft);
    syncLanguageUI();
    syncTransitionSwitcherActive(modalState.draftTransitionMode);
    closeLanguageModal();

    replaceBookmarkDraft(bookmarks);
    switchSettingsTab('tabBookmarks');
    renderEditList();
    updateWallpaperStatusUI(modalState.draftWallpaper);
    applyBgEffects(modalState.draftMaskOpacity ?? CONFIG.APPEARANCE.DEFAULT_MASK_OPACITY);
    setEditPhase('editing');
    OverlayStack.push('editModal', cancelEditModal, trigger);
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
    const editBtn = dom.editBookmarksBtn;
    editBtn?.setAttribute('aria-expanded', 'false');

    closeWallpaperUrlInput();
}

/** 打开壁纸直链输入行 */
export function openWallpaperUrlInput() {
    const current = modalState.draftWallpaper || '';
    if (dom.urlBgInput) dom.urlBgInput.value = typeof current === 'string' && current.startsWith('http') ? current : '';
    dom.urlBgBtnGroup?.classList.add('hidden');
    dom.urlBgInputRow?.classList.remove('hidden');
    dom.urlBgInput?.focus();
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

/** 提交壁纸直链输入行并触发草稿预览 */
export function submitWallpaperUrlInput() {
    const trimmed = (dom.urlBgInput?.value || '').trim();
    closeWallpaperUrlInput();
    if (!trimmed) return;
    let imageUrl;
    try {
        if (!/^https?:\/\//i.test(trimmed)) throw new Error('Invalid image URL');
        imageUrl = new URL(trimmed);
        // 外部图片遵循 img-src https:；同源本地 HTTP 图片仍允许加载。
        if (imageUrl.protocol === 'http:' && imageUrl.origin !== location.origin) {
            imageUrl.protocol = 'https:';
        }
    } catch {
        showWallpaperError(t('ui.enter.a.valid.image.url.starting'));
        return;
    }
    previewDraftWallpaper(imageUrl.href);
}

export function openShortcutModal() {
    const modal = dom.shortcutModal;
    if (!modal) return;
    renderShortcutModalList();
    closeDropdown();
    hideSuggestions();
    if (state.editOpen) {
        dom.openShortcutFromSettingsBtn?.setAttribute('aria-expanded', 'true');
    }
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
    const bookmarks = collectEditData();
    const exportData = {
        version: '1.1',
        exportDate: new Date().toISOString(),
        bookmarks
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
    if (!file || (modalState.phase !== 'editing' && modalState.phase !== 'preparing-save')) return;
    cancelPendingImport();

    const controller = new AbortController();
    activeImportController = controller;
    const signal = controller.signal;
    const session = editSession;
    const isCurrent = () => !signal.aborted && session === editSession;

    const reader = new FileReader();
    const clearReader = () => {
        reader.onload = reader.onerror = reader.onabort = null;
        signal.removeEventListener('abort', abortRead);
    };

    const abortRead = () => {
        clearReader();
        try {
            if (reader.readyState === FileReader.LOADING) reader.abort();
        } catch {}
    };
    signal.addEventListener('abort', abortRead, { once: true });

    reader.onload = (e) => {
        clearReader();
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
                    if (cat && Array.isArray(cat.bookmarks)) {
                        for (const bookmark of cat.bookmarks) importedList.push(bookmark);
                    }
                });
            } else {
                showConfirm(t('ui.this.file.does.not.contain.a'), null, t('ui.invalid.format'), { signal });
                return;
            }

            const fallbackName = t('ui.untitled');
            const validBookmarks = normalizeBookmarks(importedList, item => normalizeBookmark(item, fallbackName));

            if (validBookmarks.length === 0) {
                showConfirm(t('ui.no.valid.bookmarks.were.found.in'), null, t('ui.import.failed'), { signal });
                return;
            }

            showConfirm(t('bookmark.importConfirm', { count: validBookmarks.length }), () => {
                if (!isCurrent()) return;
                replaceBookmarkDraft(getImportedBookmarks(validBookmarks), true);
                renderEditList();
                closeBookmarkPicker();
            }, t('ui.confirm.import'), { signal });
        } catch (err) {
            showConfirm(t('ui.could.not.parse.the.json.file'), null, t('ui.parse.error'), { signal });
        }
    };
    reader.onerror = () => {
        clearReader();
        if (isCurrent()) showConfirm(t('ui.could.not.read.the.file.please'), null, t('ui.import.failed'), { signal });
    };
    reader.readAsText(file, 'UTF-8');
}

/** 确认后重置；发生部分失败时，让未改动的字段跟随最新提交基线。 */
export function resetBookmarks() {
    const session = editSession;
    if (!session?.baseline || modalState.phase !== 'editing') return;
    const isCurrent = () => editSession === session;
    showConfirm(t('ui.restore.all.defaults.this.immediately.removes'), async () => {
        if (!isCurrent() || modalState.phase !== 'editing') return;
        const before = session.baseline;
        if (!before) return;
        beginEditCommit();
        const resumeWallpaper = pauseWallpaperDraft();
        try {
            const wallpaperCleared = await clearCustomWallpaper(0, isCurrent);
            if (!isCurrent()) return;
            if (!wallpaperCleared) {
                showConfirm(t('ui.could.not.clear.wallpaper.storage.your'), null, t('ui.reset.failed'));
                return;
            }

            const keys = /** @type {const} */ (['PREFERRED_ENGINE', 'WALLPAPER_META', 'MASK_OPACITY',
                'BG', 'THEME_CACHE', 'TINT_CACHE', 'TRANSITION_MODE', 'LANGUAGE']);
            const bookmarksReset = await commitBookmarks(() => {
                if (!isCurrent() || !resetUserBookmarks()) return false;
                session.bookmarkRevision = loadBookmarks();
                return true;
            });
            if (!isCurrent()) return;
            const outcomes = [
                ...keys.map(key => storageRemove(CONFIG.KEYS[key])),
                resetNavDiscovery(), resetWeather(), bookmarksReset
            ];
            const committed = session.baseline = readCommittedSettings();
            document.documentElement.dataset.transitionMode = committed.draftTransitionMode;
            setEngine(storageGet(CONFIG.KEYS.PREFERRED_ENGINE, DEFAULT_ENGINE), false);
            if (outcomes.includes(false)) {
                rebaseDraft(before, committed);
                showConfirm(t('ui.some.settings.could.not.be.cleared'), null, t('ui.reset.incomplete'));
                return;
            }

            applyBgEffects(committed.draftMaskOpacity);
            syncTransitionSwitcherActive(committed.draftTransitionMode);
            replaceBookmarkDraft([]);
            finishEdit();
        } finally {
            if (isCurrent()) setEditPhase('editing');
            resumeWallpaper?.();
        }
    }, t('ui.reset.all.settings'));
}

/** 保存只提交会话中改变的字段。一次失败保留剩余草稿，已经成功的字段成为下次重试的基线。 */
export async function saveEditModal() {
    const session = editSession;
    if (!session?.baseline || !session.initial || modalState.phase !== 'editing') return;
    const { baseline, initial } = session;
    const isCurrent = () => editSession === session;
    setEditPhase('preparing-save');
    try {
        const previewReady = await flushWallpaperSelection(isCurrent);
        if (!isCurrent()) return;
        if (!previewReady) {
            if (OverlayStack.top()?.id === 'editModal') switchSettingsTab('tabAppearance');
            return;
        }

        let invalidDraft = false;
        const data = collectEditData(() => { invalidDraft = true; });
        if (data.length === 0) {
            showConfirm(t('ui.keep.at.least.one.bookmark.with'), null, t('ui.could.not.save'));
            return;
        }
        if (invalidDraft) {
            if (OverlayStack.top()?.id === 'editModal') switchSettingsTab('tabBookmarks');
            showConfirm(t('settings.invalidBookmarkDraft'), null, t('ui.could.not.save'));
            return;
        }
        beginEditCommit();
        const { draftWallpaper, draftMaskOpacity, draftTransitionMode, draftLanguage } = modalState;
        /** @type {Array<[keyof SettingsBaseline, boolean, () => boolean | 'conflict' | Promise<boolean | 'conflict'>, string]>} */
        const commits = [
            ['bookmarks', modalState.bookmarksChanged, () => commitBookmarks(() => {
                if (!isCurrent()) return false;
                const result = saveUserBookmarks(data, session.bookmarkRevision);
                if (result === true) session.bookmarkRevision = loadBookmarks();
                return result;
            }), 'ui.could.not.save.bookmarks.your.draft'],
            ['draftMaskOpacity', draftMaskOpacity !== baseline.draftMaskOpacity,
                () => draftMaskOpacity !== null && commitWallpaperDimming(draftMaskOpacity, isCurrent), 'ui.could.not.save.background.dimming.your'],
            ['draftTransitionMode', draftTransitionMode !== baseline.draftTransitionMode,
                () => setTransitionMode(draftTransitionMode), 'ui.could.not.save.transition.mode.your'],
            ['draftWallpaper', draftWallpaper !== baseline.draftWallpaper,
                () => draftWallpaper !== null && commitWallpaperSelection(draftWallpaper, isCurrent), 'ui.could.not.save.the.wallpaper.your'],
            ['draftLanguage', draftLanguage !== baseline.draftLanguage,
                () => storageSet(CONFIG.KEYS.LANGUAGE, draftLanguage), 'language.saveFailed']
        ];
        for (const [field, changed, commit, error] of commits) {
            if (!changed) continue;
            const saved = await commit();
            if (!isCurrent()) return;
            if (saved === 'conflict') {
                showConfirm(t('settings.bookmarkConflict'), null, t('ui.could.not.save'));
                return;
            }
            if (!saved) {
                const fields = /** @type {(keyof typeof settingLabels)[]} */ (Object.keys(settingLabels));
                const applied = fields.filter(key => initial[key] !== session.baseline?.[key]).map(key => t(settingLabels[key]));
                const message = applied.length ? t('settings.partialSave', {
                    error: t(error), settings: new Intl.ListFormat(getLocale()).format(applied)
                }) : t(error);
                if (field === 'draftWallpaper') {
                    showWallpaperError(message);
                    switchSettingsTab('tabAppearance');
                } else {
                    showConfirm(message, null, t('ui.could.not.save'));
                }
                return;
            }
            const committed = readCommittedSettings();
            session.baseline = { ...session.baseline, [field]: committed[field] };
            if (field === 'bookmarks') {
                replaceBookmarkDraft(committed.bookmarks);
                renderEditList();
            }
        }
        finishEdit();
    } finally {
        if (isCurrent()) setEditPhase('editing');
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
    const session = editSession;
    if (!clearBtn || !session?.baseline || modalState.phase !== 'editing') return;
    const isExtension = window.__GLASS_EXTENSION__;

    if (isExtension) {
        showConfirm(`${t('cache.extension.description')} ${t('cache.discardDraft')}`, () => {
            if (editSession === session && modalState.phase === 'editing') location.reload();
        }, t('cache.extension.title'), { triggerEl: clearBtn, okText: t('cache.extension.action') });
        return;
    }
    if (!('caches' in window)) {
        showConfirm(t('ui.offline.caching.is.unavailable.or.the'), null, t('ui.notice'), { triggerEl: clearBtn });
        return;
    }

    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const message = isOffline
        ? t('ui.you.are.offline.clearing.the.offline')
        : t('ui.clear.the.offline.cache.cached.app');

    showConfirm(
        `${message} ${t('cache.discardDraft')}`,
        async () => {
            if (editSession !== session || modalState.phase !== 'editing') return;
            beginEditCommit();
            const resumeWallpaper = pauseWallpaperDraft();
            const scope = new URL('./', location.href);
            const cachePrefix = 'glass-scope-' + encodeURIComponent(scope.pathname) + '-';
            try {
                const keys = await caches.keys();
                // 另一个 %2F- 表示前缀命中的是更深的部署路径。
                await Promise.all(keys.filter(key => key.startsWith(cachePrefix) &&
                    !key.includes('%2F-', cachePrefix.length)).map(key => caches.delete(key)));
                if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(regs.filter(r => r.scope === scope.href).map(r => r.unregister()));
                }
                if (editSession === session) {
                    closeEditModal();
                    location.reload();
                }
            } catch (err) {
                console.warn('离线缓存或服务工作线程清理异常:', err);
                if (editSession === session) {
                    setEditPhase('editing');
                    showConfirm(t('cache.clearFailed'), null, t('ui.notice'), { triggerEl: clearBtn });
                }
            } finally {
                resumeWallpaper?.();
            }
        },
        t('ui.clear.offline.cache'),
        { triggerEl: clearBtn, okText: t('ui.clear.cache.and.reload') }
    );
}
