/**
 * 设置事件装配
 *
 * 设置按钮、书签草稿编辑与拖拽排序的事件装配。
 */
import { CONFIG } from '../config/constants.js';
import { normalizeUrl, storageGet, checkImageReady } from '../utils/helpers.js';

import { modalState } from '../state/store.js';
import { updateBookmarkDraft, removeBookmarkDraft } from '../state/bookmark-draft.js';
import { dom } from '../state/dom.js';

import { initDragSort } from './drag-sort.js';

import { uploadWallpaper, previewDraftWallpaper, resetDraftWallpaper } from '../modules/wallpaper.js';
import { openEditModal, saveEditModal, cancelEditModal, openShortcutModal, closeShortcutModal, openCreditsModal, closeCreditsModal, openBookmarkPicker, closeBookmarkPicker, switchSettingsTab, previewDraftMaskOpacity, resetBookmarks, importBookmarksJSON, exportBookmarksJSON } from '../modules/settings.js';
import { updateAllBookmarkCounters, getEditFaviconInner, getExistingUrls, handleEditIconError, appendDraftBookmarkRow } from '../modules/bookmark-editor.js';
import { showConfirm } from './dialogs.js';

export function bindEditEvents() {
    document.querySelectorAll('#editModal > div, #bookmarkPicker > div, #confirmModal > div, #shortcutModal > div, #creditsModal > div').forEach(el => {
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

    document.querySelectorAll('.preset-bg-card').forEach(card => {
        card.addEventListener('click', e => {
            e.stopPropagation();
            const cardEl = card instanceof HTMLElement ? card : null;
            const url = cardEl?.dataset.bg;
            if (url) {
                previewDraftWallpaper(url);
            }
        });
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
            if (!item || !item.dataset.name || !item.dataset.url) return;
            const name = item.dataset.name;
            const url = item.dataset.url;
            const urls = getExistingUrls();
            if (urls.has(normalizeUrl(url))) return;

            appendDraftBookmarkRow({ name, url });
            item.classList.add('opacity-40', 'pointer-events-none');
            item.disabled = true;
            item.setAttribute('aria-disabled', 'true');
            item.setAttribute('aria-label', `${name}（已添加）`);
            item.dataset.name = '';
            item.dataset.url = '';
            const lastSpan = item.querySelector('span:last-child');
            if (lastSpan) lastSpan.textContent = '✓';
        });
    }

    if (dom.addBookmarkBtn) {
        dom.addBookmarkBtn.addEventListener('click', () => {
            appendDraftBookmarkRow({ focus: true });
        });
    }

    if (dom.editList) {
        /** @type {ReturnType<typeof setTimeout>|null} */
        let editFaviconDebounceTimer = null;
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
                const urlVal = item.url;
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
                    if (editFaviconDebounceTimer) clearTimeout(editFaviconDebounceTimer);
                    editFaviconDebounceTimer = setTimeout(() => {
                        faviconBox.innerHTML = getEditFaviconInner(nameVal, urlVal);
                        const newImg = /** @type {HTMLImageElement|null} */ (faviconBox.querySelector('.edit-favicon-img'));
                        if (newImg) checkImageReady(newImg, handleEditIconError);
                    }, CONFIG.SUGGEST.DEBOUNCE_MS);
                } else if (target.classList.contains('edit-name')) {
                    if (!existingImg || existingImg.dataset.failed === '1') {
                        faviconBox.innerHTML = getEditFaviconInner(nameVal, urlVal);
                        const newImg = /** @type {HTMLImageElement|null} */ (faviconBox.querySelector('.edit-favicon-img'));
                        if (newImg) checkImageReady(newImg, handleEditIconError);
                    }
                }
            }
        });

        dom.editList.addEventListener('click', e => {
            const targetEl = e.target instanceof Element ? e.target : null;
            const del = targetEl?.closest('.del-btn');
            if (del) {
                const item = /** @type {HTMLElement|null} */ (del.closest('.edit-row-card'));
                if (item) {
                    if (item.dataset.id) removeBookmarkDraft(item.dataset.id);
                    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                        item.remove();
                        updateAllBookmarkCounters();
                    } else {
                        const durSec = `${CONFIG.TIMERS.BOOKMARK_DELETE_DURATION / 1000}s`;
                        item.style.transition = `all ${durSec} var(--ease-spring)`;
                        item.style.opacity = '0';
                        item.style.transform = `scale(${CONFIG.PHYSICS.BOOKMARK_DELETE_SCALE}) translateY(${CONFIG.PHYSICS.BOOKMARK_DELETE_OFFSET_Y}px)`;
                        item.addEventListener('transitionend', () => {
                            item.remove();
                            updateAllBookmarkCounters();
                        }, { once: true });
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
        const closeUrlInput = () => {
            dom.urlBgInputRow?.classList.add('hidden');
            dom.urlBgBtnGroup?.classList.remove('hidden');
            if (dom.urlBgInput) dom.urlBgInput.value = '';
        };
        const submitUrl = () => {
            const trimmed = (dom.urlBgInput?.value || '').trim();
            closeUrlInput();
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
                showConfirm('请输入以 http:// 或 https:// 开头的有效图片链接。', null, '地址错误');
                return;
            }
            previewDraftWallpaper(imageUrl.href);
        };
        dom.urlBgBtn.addEventListener('click', openUrlInput);
        dom.urlBgConfirmBtn?.addEventListener('click', submitUrl);
        dom.urlBgCancelBtn?.addEventListener('click', closeUrlInput);
        dom.urlBgInput?.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); submitUrl(); }
            if (e.key === 'Escape') { e.preventDefault(); closeUrlInput(); }
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

    // 清理缓存：确认后再清空并刷新。
    const clearBtn = dom.clearCacheBtn;
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (clearBtn.disabled) return;
            const confirmFn = showConfirm;
            if (typeof confirmFn !== 'function') return;

            if (!('caches' in window)) {
                confirmFn('当前浏览器不支持 Service Worker 缓存，或已是最新状态。', null, '提示', clearBtn);
                return;
            }

            const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
            const msg = isOffline
                ? '警告：当前处于离线状态！清理 Service Worker 缓存与注销将导致页面在重新联网前无法访问。确定要继续清理并刷新吗？'
                : '确定要清理并重置 Service Worker 离线缓存吗？此操作将清除本地缓存的静态资源并在刷新后重新载入。';

            confirmFn(
                msg,
                async () => {
                    clearBtn.disabled = true;
                    try {
                        if ('caches' in window) {
                            try {
                                const keys = await caches.keys();
                                await Promise.all(keys.map(key => caches.delete(key)));
                            } catch {}
                        }
                        if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
                            try {
                                const regs = await navigator.serviceWorker.getRegistrations();
                                await Promise.all(regs.map(r => r.unregister()));
                            } catch {}
                        }
                    } finally {
                        location.reload();
                    }
                },
                '清理离线缓存',
                clearBtn,
                '立即清理并刷新'
            );
        });
    }

    initDragSort();
}
