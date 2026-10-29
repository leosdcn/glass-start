import { t } from '../core/i18n.js';
/**
 * 设置事件装配
 *
 * 设置按钮、书签草稿编辑与拖拽排序的事件装配。
 */
import { CONFIG } from '../config/constants.js';
import { normalizeUrl, storageGet, checkImageReady } from '../utils/helpers.js';
import { getCategoryCatalog } from '../utils/category-catalog.js';

import { modalState, pageData, state } from '../state/store.js';
import { updateBookmarkDraft, removeBookmarkDraft } from '../state/bookmark-draft.js';
import { dom } from '../state/dom.js';

import { initDragSort } from '../core/drag-sort.js';

import { uploadWallpaper, previewDraftWallpaper, resetDraftWallpaper } from './wallpaper.js';
import { openEditModal, saveEditModal, cancelEditModal, openShortcutModal, closeShortcutModal, openCreditsModal, closeCreditsModal, openBookmarkPicker, closeBookmarkPicker, updatePickerAvailability, switchSettingsTab, previewDraftMaskOpacity, resetBookmarks, importBookmarksJSON, exportBookmarksJSON, syncLanguageUI, openLanguageModal, closeLanguageModal, saveLanguageModal, cancelLanguageModal, selectLanguage, selectDraftTransitionMode, closeWallpaperUrlInput } from './settings.js';
import { updateAllBookmarkCounters, getEditFaviconInner, getExistingUrls, handleEditIconError, appendDraftBookmarkRow } from './bookmark-editor.js';
import { showConfirm } from '../core/dialogs.js';
import { finishPendingTransition, onTransitionSettled } from '../utils/transition-cleanup.js';

export function bindEditEvents() {
    dom.languageBtn?.addEventListener('click', e => {
        e.stopPropagation();
        openLanguageModal(dom.languageBtn);
    });
    dom.doneLanguageBtn?.addEventListener('click', saveLanguageModal);
    dom.cancelLanguageBtn?.addEventListener('click', cancelLanguageModal);
    dom.languageModal?.addEventListener('click', cancelLanguageModal);
    dom.languageList?.addEventListener('click', e => {
        e.stopPropagation();
        const targetEl = e.target instanceof Element ? e.target : null;
        const btn = /** @type {HTMLElement|null} */ (targetEl?.closest('[data-lang]'));
        if (btn?.dataset.lang) {
            selectLanguage(btn.dataset.lang);
        }
    });
    dom.languageSelect?.addEventListener('change', () => {
        modalState.draftLanguage = dom.languageSelect?.value || 'auto';
        syncLanguageUI();
    });
    document.querySelectorAll('#editModal > div, #bookmarkPicker > div, #confirmModal > div, #shortcutModal > div, #creditsModal > div, #languageModal > div').forEach(el => {
        el.addEventListener('click', e => e.stopPropagation());
    });
    dom.editBookmarksBtn?.addEventListener('click', openEditModal);
    dom.cancelEditBtn?.addEventListener('click', cancelEditModal);
    dom.editModal?.addEventListener('click', cancelEditModal);
    dom.togglePickerBtn?.addEventListener('click', e => { e.stopPropagation(); openBookmarkPicker(dom.togglePickerBtn); });
    dom.donePickerBtn?.addEventListener('click', closeBookmarkPicker);
    dom.bookmarkPicker?.addEventListener('click', closeBookmarkPicker);
    dom.doneShortcutBtn?.addEventListener('click', closeShortcutModal);
    dom.shortcutModal?.addEventListener('click', closeShortcutModal);
    dom.openShortcutFromSettingsBtn?.addEventListener('click', openShortcutModal);
    dom.openCreditsFromSettingsBtn?.addEventListener('click', openCreditsModal);
    dom.doneCreditsBtn?.addEventListener('click', closeCreditsModal);
    dom.creditsModal?.addEventListener('click', closeCreditsModal);

    // 重置所有设置 (Danger Zone - 确认后立即重置系统，无需再点击保存)
    if (dom.resetEditBtn) {
        dom.resetEditBtn.addEventListener('click', resetBookmarks);
    }

    /** @type {HTMLElement[]} */
    const settingsTabs = Array.from(document.querySelectorAll('.settings-tab-btn'));
    settingsTabs.forEach((btn, index) => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            if (btn.dataset.tab) switchSettingsTab(btn.dataset.tab);
        });
        btn.addEventListener('keydown', e => {
            if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
            let nextIndex;
            switch (e.key) {
                case 'ArrowRight': nextIndex = (index + 1) % settingsTabs.length; break;
                case 'ArrowLeft': nextIndex = (index - 1 + settingsTabs.length) % settingsTabs.length; break;
                case 'Home': nextIndex = 0; break;
                case 'End': nextIndex = settingsTabs.length - 1; break;
                default: return;
            }
            e.preventDefault();
            e.stopPropagation();
            const nextTab = settingsTabs[nextIndex];
            if (nextTab && nextTab.dataset.tab) {
                switchSettingsTab(nextTab.dataset.tab);
                nextTab.focus();
            }
        });
    });

    // 卡片在首次打开外观页时生成，监听稳定的网格容器。
    dom.presetWallpaperGrid?.addEventListener('click', e => {
        const card = e.target instanceof Element ? e.target.closest('.preset-bg-card') : null;
        if (!(card instanceof HTMLElement) || !dom.presetWallpaperGrid?.contains(card)) return;
        e.stopPropagation();
        const url = card.dataset.bg;
        if (url) previewDraftWallpaper(url);
    });

    // JSON 拖拽 Dropzone 交互绑定
    if (dom.jsonDropzone) {
        dom.jsonDropzone.addEventListener('click', () => dom.importJsonInput?.click());
        dom.jsonDropzone.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                dom.importJsonInput?.click();
            }
        });
        dom.jsonDropzone.addEventListener('dragover', e => {
            e.preventDefault();
            e.stopPropagation();
            dom.jsonDropzone?.classList.add('drag-over');
        });
        dom.jsonDropzone.addEventListener('dragleave', e => {
            e.preventDefault();
            e.stopPropagation();
            if (e.relatedTarget instanceof Node && dom.jsonDropzone?.contains(e.relatedTarget)) return;
            dom.jsonDropzone?.classList.remove('drag-over');
        });
        dom.jsonDropzone.addEventListener('drop', e => {
            e.preventDefault();
            e.stopPropagation();
            dom.jsonDropzone?.classList.remove('drag-over');
            const file = e.dataTransfer?.files[0];
            if (file) importBookmarksJSON(file);
        });
    }

    // 备选池书签一键添加绑定
    if (dom.pickerContent) {
        dom.pickerContent.addEventListener('click', e => {
            const targetEl = e.target instanceof Element ? e.target : null;
            const item = /** @type {HTMLButtonElement|null} */ (targetEl?.closest('.picker-item'));
            if (!item || item.disabled || !item.dataset.url) return;
            const bookmark = getCategoryCatalog(pageData.categories).byUrl.get(normalizeUrl(item.dataset.url));
            if (!bookmark) return;
            const { name, url, icon, desc } = bookmark;
            const urls = getExistingUrls();
            if (urls.has(normalizeUrl(url))) return;

            appendDraftBookmarkRow({ name, url, icon, desc });
            updatePickerAvailability();
        });
    }

    if (dom.addBookmarkBtn) {
        dom.addBookmarkBtn.addEventListener('click', () => {
            appendDraftBookmarkRow({ focus: true });
        });
    }

    if (dom.editList) {
        /** 每行独立防抖，避免编辑下一行时取消上一行的预览。 @type {WeakMap<HTMLElement, ReturnType<typeof setTimeout>>} */
        const editFaviconTimers = new WeakMap();
        dom.editList.addEventListener('input', (e) => {
            const target = e.target instanceof HTMLInputElement ? e.target : null;
            const row = /** @type {HTMLElement|null} */ (target?.closest('.edit-row-card'));
            if (!row || !target) return;
            const fields = target.classList.contains('edit-name') ? { name: target.value }
                : target.classList.contains('edit-url') ? { url: target.value } : null;
            if (!fields || !row.dataset.id) return;
            const item = updateBookmarkDraft(row.dataset.id, fields);
            if (!item) return;

            // 同步实时 Favicon 预览
            const faviconBox = row.querySelector('.edit-favicon-box');
            if (faviconBox) {
                const nameVal = item.name;
                const initial = (nameVal || '?').trim().charAt(0).toUpperCase() || '?';

                const existingImg = /** @type {HTMLElement|null} */ (faviconBox.querySelector('.edit-favicon-img'));
                const existingInitial = faviconBox.querySelector('.edit-favicon-initial');
                if (existingImg) {
                    existingImg.dataset.initial = initial;
                }
                if (existingInitial) {
                    existingInitial.textContent = initial;
                }

                if (target.classList.contains('edit-url')) {
                    const previousTimer = editFaviconTimers.get(row);
                    if (previousTimer !== undefined) clearTimeout(previousTimer);
                    editFaviconTimers.set(row, setTimeout(() => {
                        editFaviconTimers.delete(row);
                        if (!state.editOpen || !row.isConnected || !modalState.draftBookmarks.includes(item)) return;
                        faviconBox.innerHTML = getEditFaviconInner(item.name, item.url);
                        const newImg = /** @type {HTMLImageElement|null} */ (faviconBox.querySelector('.edit-favicon-img'));
                        if (newImg) checkImageReady(newImg, handleEditIconError);
                    }, CONFIG.SUGGEST.DEBOUNCE_MS));
                }
            }
        });

        dom.editList.addEventListener('click', e => {
            const targetEl = e.target instanceof Element ? e.target : null;
            const del = targetEl?.closest('.del-btn');
            if (del) {
                const item = /** @type {HTMLElement|null} */ (del.closest('.edit-row-card'));
                if (item) {
                    finishPendingTransition(item);
                    if (item.dataset.id) removeBookmarkDraft(item.dataset.id);
                    const remove = () => {
                        item.remove();
                        updateAllBookmarkCounters();
                    };
                    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                        remove();
                    } else {
                        const durSec = `${CONFIG.TIMERS.BOOKMARK_DELETE_DURATION / 1000}s`;
                        item.style.transition = `opacity ${durSec} var(--ease-spring), transform ${durSec} var(--ease-spring)`;
                        item.style.opacity = '0';
                        item.style.transform = `scale(${CONFIG.PHYSICS.BOOKMARK_DELETE_SCALE}) translateY(${CONFIG.PHYSICS.BOOKMARK_DELETE_OFFSET_Y}px)`;
                        onTransitionSettled(item, 'opacity', CONFIG.TIMERS.BOOKMARK_DELETE_DURATION, remove);
                    }
                }
            }
        });
    }

    // 保存流程由设置模块统一管理。
    if (dom.saveEditBtn) {
        dom.saveEditBtn.addEventListener('click', saveEditModal);
    }

    // JSON 导入导出事件绑定
    if (dom.exportJsonBtn) {
        dom.exportJsonBtn.addEventListener('click', async () => {
            if (dom.exportJsonBtn?.disabled) return;
            if (dom.exportJsonBtn) dom.exportJsonBtn.disabled = true;
            try {
                await exportBookmarksJSON();
            } finally {
                if (dom.exportJsonBtn) dom.exportJsonBtn.disabled = false;
            }
        });
    }
    if (dom.importJsonInput) {
        dom.importJsonInput.addEventListener('change', e => {
            const targetInput = e.target instanceof HTMLInputElement ? e.target : null;
            const file = targetInput?.files?.[0];
            if (file) importBookmarksJSON(file);
            if (targetInput) targetInput.value = '';
        });
    }

    // 自定义壁纸事件绑定
    if (dom.uploadBgBtn) dom.uploadBgBtn.addEventListener('click', () => dom.uploadBgInput?.click());
    if (dom.uploadBgInput) {
        dom.uploadBgInput.addEventListener('change', e => {
            const targetInput = e.target instanceof HTMLInputElement ? e.target : null;
            const file = targetInput?.files?.[0];
            if (file) {
                if (uploadWallpaper(file) === false) return;
            }
            if (targetInput) targetInput.value = '';
        });
    }

    if (dom.urlBgBtn) {
        const openUrlInput = () => {
            const current = modalState.draftWallpaper || storageGet(CONFIG.KEYS.USER_WALLPAPER) || '';
            if (dom.urlBgInput) dom.urlBgInput.value = typeof current === 'string' && current.startsWith('http') ? current : '';
            dom.urlBgBtnGroup?.classList.add('hidden');
            dom.urlBgInputRow?.classList.remove('hidden');
            dom.urlBgInput?.focus();
        };
        const submitUrl = () => {
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
                showConfirm(t('ui.enter.a.valid.image.url.starting'), null, t('ui.invalid.url'));
                return;
            }
            previewDraftWallpaper(imageUrl.href);
        };
        dom.urlBgBtn.addEventListener('click', openUrlInput);
        dom.urlBgConfirmBtn?.addEventListener('click', submitUrl);
        dom.urlBgCancelBtn?.addEventListener('click', closeWallpaperUrlInput);
        dom.urlBgInput?.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); submitUrl(); }
            if (e.key === 'Escape') { e.preventDefault(); closeWallpaperUrlInput(); }
        });
    }

    if (dom.resetBgBtn) {
        dom.resetBgBtn.addEventListener('click', async () => {
            await resetDraftWallpaper();
        });
    }

    // 背景暗度事件绑定（草稿实时预览）
    if (dom.maskOpacityInput) {
        dom.maskOpacityInput.addEventListener('input', e => {
            const targetInput = e.target instanceof HTMLInputElement ? e.target : null;
            if (targetInput) previewDraftMaskOpacity(targetInput.value);
        });
    }

    // 切屏动效选择（草稿高亮切换，保存时生效）
    dom.settingsTransitionGrid?.addEventListener('click', e => {
        const btn = /** @type {HTMLElement|null} */ (e.target instanceof HTMLElement ? e.target.closest('.settings-transition-btn') : null);
        if (!btn || !btn.dataset.mode) return;
        selectDraftTransitionMode(btn.dataset.mode);
    });

    // 清理缓存：确认后再清空并刷新。
    const clearBtn = dom.clearCacheBtn;
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (clearBtn.disabled) return;
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
                            try {
                                const keys = await caches.keys();
                                // 网页图标池跨部署共享；扩展拥有独立来源，可清理自己的图标池。
                                await Promise.all(keys.filter(key => key.startsWith(cachePrefix) ||
                                    (isExtension && key === CONFIG.CACHE.FAVICON)).map(key => caches.delete(key)));
                            } catch {}
                        }
                        if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
                            try {
                                const regs = await navigator.serviceWorker.getRegistrations();
                                await Promise.all(regs.filter(r => r.scope === scope.href).map(r => r.unregister()));
                            } catch {}
                        }
                    } finally {
                        location.reload();
                    }
                },
                isExtension ? t('ui.clear.cache') : t('ui.clear.offline.cache'),
                clearBtn,
                isExtension ? t('ui.clear.and.reload') : t('ui.clear.cache.and.reload')
            );
        });
    }

    initDragSort();
}
