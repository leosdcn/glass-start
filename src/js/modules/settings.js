/**
 * 设置面板与弹窗管理系统
 * 负责设置弹窗打开/保存、外观草稿与语言弹窗；会话工具见 settings-session.js，导入导出与重置见 settings-data.js。
 */
import { t, getLocale, getLanguagePreference } from '../core/i18n.js';
import { renderEditList } from './bookmark-editor.js';
import { showConfirm } from '../core/dialogs.js';
import { CONFIG } from '../config/constants.js';
import { storageSet } from '../utils/storage.js';
import { state, modalState } from '../state/store.js';
import { replaceBookmarkDraft } from '../state/bookmark-draft.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';
import { applyBgEffects } from '../core/wallpaper-renderer.js';
import { flushWallpaperSelection, prepareWallpaperDraft, closeWallpaperDraft, updateWallpaperStatusUI, showWallpaperError, previewDraftWallpaper, discardWallpaperDraftSelection } from './wallpaper.js';
import { commitWallpaperDimming, commitWallpaperSelection, getCommittedWallpaperUrl, getSavedMaskOpacity } from './wallpaper-store.js';
import { loadBookmarks, saveUserBookmarks, getBookmarkRevision } from './bookmarks.js';
import { cancelSearchSubmission, closeDropdown } from './search.js';
import { hideSuggestions } from './search-suggestions.js';
import { syncTransitionSwitcherActive, setTransitionMode } from '../core/screen-state.js';
import {
    beginEditCommit, cancelEditModal, closeLanguageModal, closeWallpaperUrlInput,
    commitBookmarks, finishEdit, getEditSession, readCommittedSettings,
    setEditPhase, setEditSession, switchSettingsTab, syncLanguageUI, validateBookmarkDraft
} from './settings-session.js';

const settingLabels = /** @type {const} */ ({
    bookmarks: 'settings.bookmarks',
    draftMaskOpacity: 'ui.background.dimming',
    draftTransitionMode: 'ui.page.transition',
    draftWallpaper: 'settings.wallpaper'
});

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
    /** @type {import('./settings-session.js').EditSession} */
    const session = {};
    setEditSession(session);
    closeDropdown();
    hideSuggestions();
    setEditPhase('opening');
    const trigger = invoker ?? document.activeElement;
    const isCurrent = () => getEditSession() === session;
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
            setEditSession(null);
            setEditPhase('closed');
        }
    } catch (err) {
        console.error('Failed to open settings:', err);
        if (isCurrent()) {
            closeWallpaperDraft();
            setEditSession(null);
            setEditPhase('closed');
        }
    }
}

/** 打开壁纸直链输入行 */
export function openWallpaperUrlInput() {
    const current = modalState.draftWallpaper || '';
    if (dom.urlBgInput) dom.urlBgInput.value = typeof current === 'string' && current.startsWith('http') ? current : '';
    dom.urlBgBtnGroup?.classList.add('hidden');
    dom.urlBgInputRow?.classList.remove('hidden');
    dom.urlBgInput?.focus();
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

/** 保存只提交会话中改变的字段。一次失败保留剩余草稿，已经成功的字段成为下次重试的基线。 */
export async function saveEditModal() {
    const session = getEditSession();
    if (!session?.baseline || !session.initial || modalState.phase !== 'editing') return;
    const { baseline, initial } = session;
    let bookmarksCommitted = false;
    const isCurrent = () => getEditSession() === session;
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
        /** @typedef {Partial<import('./settings-session.js').SettingsBaseline> | false | 'conflict'} CommitResult */
        /** @type {Array<[keyof import('./settings-session.js').SettingsBaseline, boolean, () => CommitResult | Promise<CommitResult>, string]>} */
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
