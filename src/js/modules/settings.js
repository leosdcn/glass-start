/**
 * 设置面板与弹窗管理系统
 * 负责设置弹窗生命周期、外观与壁纸配置、语言切换及数据导入导出的统一协调。
 * 具体书签草稿编辑见 bookmark-editor.js，预置目录挑选器见 bookmark-picker.js。
 */
import { t, getLocale, getLanguagePreference, resolveLocale } from '../core/i18n.js';
import { renderEditList, collectEditData } from './bookmark-editor.js';
import { showConfirm } from '../core/dialogs.js';
import { CONFIG } from '../config/constants.js';
import { getDefaultEngine } from '../config/engines.js';
import { normalizeBookmark, normalizeBookmarks, normalizeBookmarkOverrides } from '../utils/bookmark-model.js';
import { storageGet, storageSet, storageRemove } from '../utils/storage.js';
import { IMAGE_CACHE_PREFIX, scopedCachePrefix, isScopedCache } from '../utils/offline-cache.js';
import { state, modalState, pageData } from '../state/store.js';
import { replaceBookmarkDraft } from '../state/bookmark-draft.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';
import { applyBgEffects, flushBgEffects } from '../core/wallpaper-renderer.js';
import { flushWallpaperSelection, prepareWallpaperDraft, getCommittedWallpaperUrl, closeWallpaperDraft, pauseWallpaperDraft, showWallpaperDraft, updateWallpaperStatusUI, updatePresetBgCardsUI, resetWallpaperSettings, commitWallpaperSelection, revertDraftWallpaper, getSavedMaskOpacity, commitWallpaperDimming, showWallpaperError, previewDraftWallpaper, discardWallpaperDraftSelection } from './wallpaper.js';
import { loadBookmarks, saveUserBookmarks, resetUserBookmarks, getImportedBookmarks, getBookmarkRevision } from './bookmarks.js';
import { cancelSearchSubmission, closeDropdown, hideSuggestions, setEngine } from './search.js';
import { getTransitionMode, syncTransitionSwitcherActive, setTransitionMode, resetNavDiscovery } from '../core/screen-state.js';
import { cancelDragSort } from './bookmark-drag.js';
import { closeBookmarkPicker } from './bookmark-picker.js';
import { resetWeather } from './weather.js';

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

/** 滑块草稿与无障碍读数即时更新，全屏视觉每帧只消费最后一次输入。 */
/** @param {string | number} value */
export function previewDraftMaskOpacity(value) {
    modalState.draftMaskOpacity = parseInt(String(value), 10) || 0;
    applyBgEffects(modalState.draftMaskOpacity, true);
}

/** @param {HTMLElement} [invoker] */
export async function openEditModal(invoker) {
    if (state.editOpen) return;
    cancelSearchSubmission();
    /** @type {NonNullable<typeof editSession>} */
    const session = {};
    editSession = session;
    closeDropdown();
    hideSuggestions();
    setEditPhase('opening');
    const trigger = invoker ?? document.activeElement;
    const isCurrent = () => editSession === session;
    try {
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
        if (!OverlayStack.push('editModal', cancelEditModal, trigger)) {
            closeWallpaperDraft();
            editSession = null;
            setEditPhase('closed');
        }
    } catch (err) {
        console.error('Failed to open settings:', err);
        if (isCurrent()) {
            closeWallpaperDraft();
            editSession = null;
            setEditPhase('closed');
        }
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
        discardWallpaperDraftSelection();
        showWallpaperError(t('ui.enter.a.valid.image.url.starting'));
        return;
    }
    previewDraftWallpaper(imageUrl.href);
}

/**
 * 导出当前快捷书签草稿，不包含壁纸和偏好设置。
 * @returns {void}
 */
export function exportBookmarksJSON() {
    const bookmarks = validateBookmarkDraft(t('ui.export.bookmarks'), true);
    if (!bookmarks) return;
    const d = new Date();
    const exportData = {
        version: '1.1',
        exportDate: d.toISOString(),
        bookmarks
    };
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
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
    if (file.size > CONFIG.SECURITY.MAX_IMPORT_BYTES) {
        showConfirm(t('ui.file.too.large', { size: Math.round(CONFIG.SECURITY.MAX_IMPORT_BYTES / (1024 * 1024)) }), null, t('ui.import.failed'));
        return;
    }

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
                parsed.categories.forEach((/** @type {Partial<import('../types').BookmarkCategory>} */ cat) => {
                    if (cat && Array.isArray(cat.bookmarks)) {
                        for (const bookmark of cat.bookmarks) importedList.push(bookmark);
                    }
                });
            } else {
                showConfirm(t('ui.this.file.does.not.contain.a'), null, t('ui.invalid.format'), { signal });
                return;
            }

            const fallbackName = t('ui.untitled');
            const validBookmarks = normalizeBookmarks(importedList, item => {
                const bookmark = normalizeBookmark(item, fallbackName);
                if (bookmark && !bookmark.overrides) bookmark.overrides = normalizeBookmarkOverrides(item);
                return bookmark;
            });

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
export function resetAllSettings() {
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
            const wallpaperReset = await resetWallpaperSettings(isCurrent);
            if (!isCurrent()) return;
            if (!wallpaperReset) {
                showConfirm(t('ui.could.not.clear.wallpaper.storage.your'), null, t('ui.reset.failed'));
                return;
            }

            const keys = /** @type {const} */ (['PREFERRED_ENGINE', 'TRANSITION_MODE', 'LANGUAGE']);
            const bookmarksReset = await commitBookmarks(() => {
                if (!isCurrent()) return false;
                const saved = resetUserBookmarks();
                if (!saved) return false;
                session.bookmarkRevision = saved.revision;
                return true;
            });
            if (!isCurrent()) return;
            const outcomes = [
                ...keys.map(key => storageRemove(CONFIG.KEYS[key])),
                resetNavDiscovery(), resetWeather(), bookmarksReset, wallpaperReset === true
            ];
            const committed = session.baseline = readCommittedSettings();
            document.documentElement.dataset.transitionMode = committed.draftTransitionMode;
            setEngine(storageGet(CONFIG.KEYS.PREFERRED_ENGINE, getDefaultEngine()), false);
            if (outcomes.includes(false)) {
                rebaseDraft(before, committed);
                showConfirm(t('ui.some.settings.could.not.be.cleared'), null, t('ui.reset.incomplete'));
                return;
            }

            applyBgEffects(committed.draftMaskOpacity);
            syncTransitionSwitcherActive(committed.draftTransitionMode);
            replaceBookmarkDraft([]);
            finishEdit();
        } catch (err) {
            console.error('Settings reset failed:', err);
            showConfirm(t('ui.some.settings.could.not.be.cleared'), null, t('ui.reset.failed'));
        } finally {
            if (isCurrent()) setEditPhase('editing');
            resumeWallpaper?.();
        }
    }, t('ui.reset.all.settings'), { triggerEl: dom.resetEditBtn });
}

/** @param {string} title @param {boolean} [allowEmpty] */
function validateBookmarkDraft(title, allowEmpty = false) {
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

/** 保存只提交会话中改变的字段。一次失败保留剩余草稿，已经成功的字段成为下次重试的基线。 */
export async function saveEditModal() {
    const session = editSession;
    if (!session?.baseline || !session.initial || modalState.phase !== 'editing') return;
    const { baseline, initial } = session;
    let bookmarksCommitted = false;
    const isCurrent = () => editSession === session;
    setEditPhase('preparing-save');
    try {
        const previewReady = await flushWallpaperSelection(isCurrent);
        if (!isCurrent()) return;
        if (!previewReady) {
            if (OverlayStack.top()?.id === 'editModal') {
                switchSettingsTab('tabAppearance');
                showConfirm(t('settings.discardFailedWallpaper'), () => {
                    discardWallpaperDraftSelection();
                    saveEditModal();
                }, t('ui.could.not.save'), { tone: 'neutral', okText: t('settings.saveWithoutFailedWallpaper') });
            }
            return;
        }

        const data = validateBookmarkDraft(t('ui.could.not.save'));
        if (!data) return;
        beginEditCommit();
        const { draftWallpaper, draftMaskOpacity, draftTransitionMode, draftLanguage } = modalState;
        /** @typedef {Partial<SettingsBaseline> | false | 'conflict'} CommitResult */
        /** @type {Array<[keyof SettingsBaseline, boolean, () => CommitResult | Promise<CommitResult>, string]>} */
        const commits = [
            ['bookmarks', modalState.bookmarksChanged, () => commitBookmarks(() => {
                if (!isCurrent()) return false;
                const saved = saveUserBookmarks(data, session.bookmarkRevision);
                if (!saved || saved === 'conflict') return saved;
                session.bookmarkRevision = saved.revision;
                return { bookmarks: saved.bookmarks };
            }), 'ui.could.not.save.bookmarks.your.draft'],
            ['draftMaskOpacity', draftMaskOpacity !== baseline.draftMaskOpacity,
                async () => draftMaskOpacity !== null && await commitWallpaperDimming(draftMaskOpacity, isCurrent)
                    && { draftMaskOpacity: getSavedMaskOpacity() }, 'ui.could.not.save.background.dimming.your'],
            ['draftTransitionMode', draftTransitionMode !== baseline.draftTransitionMode,
                () => setTransitionMode(draftTransitionMode) && { draftTransitionMode }, 'ui.could.not.save.transition.mode.your'],
            ['draftWallpaper', draftWallpaper !== baseline.draftWallpaper,
                async () => draftWallpaper !== null && await commitWallpaperSelection(draftWallpaper, isCurrent)
                    && { draftWallpaper: getCommittedWallpaperUrl() }, 'ui.could.not.save.the.wallpaper.your'],
            ['draftLanguage', draftLanguage !== baseline.draftLanguage,
                () => storageSet(CONFIG.KEYS.LANGUAGE, draftLanguage) && { draftLanguage: getLanguagePreference() }, 'language.saveFailed']
        ];
        for (const [field, changed, commit, error] of commits) {
            if (!changed) continue;
            const saved = await commit();
            if (!isCurrent()) return;
            if (saved === 'conflict') {
                showConfirm(t('settings.bookmarkConflict'), () => {
                    if (!isCurrent()) return;
                    session.bookmarkRevision = getBookmarkRevision();
                    saveEditModal();
                }, t('ui.could.not.save'), {
                    tone: 'neutral',
                    okText: t('settings.overwriteBookmarks')
                });
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
            session.baseline = { ...session.baseline, ...saved };
            if (saved.bookmarks) {
                replaceBookmarkDraft(saved.bookmarks);
                bookmarksCommitted = true;
            }
        }
        finishEdit();
    } catch (err) {
        console.error('Settings save failed:', err);
        showConfirm(t('ui.could.not.save'), null, t('ui.could.not.save'));
    } finally {
        if (isCurrent()) {
            if (bookmarksCommitted) renderEditList();
            setEditPhase('editing');
        }
    }
}

let initialLanguageOnOpen = 'auto';

export function openLanguageModal(trigger = dom.languageBtn) {
    initialLanguageOnOpen = modalState.draftLanguage || 'auto';
    syncLanguageUI();
    OverlayStack.push('languageModal', cancelLanguageModal, trigger);
}

export function cancelLanguageModal() {
    modalState.draftLanguage = initialLanguageOnOpen;
    syncLanguageUI();
    closeLanguageModal();
}

function closeLanguageModal() {
    OverlayStack.pop('languageModal');
}

export function saveLanguageModal() {
    const changed = modalState.draftLanguage !== getLanguagePreference();
    closeLanguageModal();
    if (changed) return saveEditModal();
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
        btn.autofocus = isSelected;
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
            const imagePrefix = scopedCachePrefix(scope.pathname) + IMAGE_CACHE_PREFIX;
            try {
                const keys = await caches.keys();
                const targets = keys.filter(key => isScopedCache(key, imagePrefix));
                const results = await Promise.allSettled(targets.map(key => caches.delete(key)));
                const failed = results.find(result => result.status === 'rejected');
                if (failed) throw failed.reason;
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
