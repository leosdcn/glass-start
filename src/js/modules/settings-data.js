/** 设置页书签导入导出、还原出厂设置及离线缓存清理。 */
import { t } from '../core/i18n.js';
import { renderEditList } from './bookmark-editor.js';
import { showConfirm } from '../core/dialogs.js';
import { CONFIG } from '../config/constants.js';
import { getDefaultEngine } from '../config/engines.js';
import { normalizeBookmark, normalizeBookmarks, normalizeBookmarkOverrides } from '../utils/bookmark-model.js';
import { storageGet, storageRemove } from '../utils/storage.js';
import { IMAGE_CACHE_PREFIX, scopedCachePrefix, isScopedCache } from '../utils/offline-cache.js';
import { modalState } from '../state/store.js';
import { replaceBookmarkDraft } from '../state/bookmark-draft.js';
import { dom } from '../state/dom.js';
import { applyBgEffects } from '../core/wallpaper-renderer.js';
import { pauseWallpaperDraft, resetWallpaperSettings } from './wallpaper.js';
import { resetUserBookmarks, getImportedBookmarks } from './bookmarks.js';
import { setEngine } from './search.js';
import { syncTransitionSwitcherActive, resetNavDiscovery } from '../core/screen-state.js';
import { closeBookmarkPicker } from './bookmark-picker.js';
import { resetWeather } from './weather.js';
import {
    beginEditCommit, cancelPendingImport, closeEditModal, commitBookmarks, finishEdit,
    getEditSession, readCommittedSettings, rebaseDraft, setActiveImportController,
    setEditPhase, validateBookmarkDraft
} from './settings-session.js';

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
    setActiveImportController(controller);
    const signal = controller.signal;
    const session = getEditSession();
    const isCurrent = () => !signal.aborted && session === getEditSession();

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
        } catch {
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
    const session = getEditSession();
    if (!session?.baseline || modalState.phase !== 'editing') return;
    const isCurrent = () => getEditSession() === session;
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

/** 确认后清理当前部署的离线缓存并刷新；不删除用户偏好。 */
export function clearOfflineCache() {
    const clearBtn = dom.clearCacheBtn;
    const session = getEditSession();
    if (!clearBtn || !session?.baseline || modalState.phase !== 'editing') return;
    const isExtension = window.__GLASS_EXTENSION__;

    if (isExtension) {
        showConfirm(`${t('cache.extension.description')} ${t('cache.discardDraft')}`, () => {
            if (getEditSession() === session && modalState.phase === 'editing') location.reload();
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
            if (getEditSession() !== session || modalState.phase !== 'editing') return;
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
                if (getEditSession() === session) {
                    closeEditModal();
                    location.reload();
                }
            } catch (err) {
                console.warn('离线缓存或服务工作线程清理异常:', err);
                if (getEditSession() === session) {
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
