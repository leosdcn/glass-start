import { flushWallpaperSelection } from '../modules/wallpaper.js';
/**
 * ==============================================================================
 * Glass Start — 设置事件装配 (src/js/core/settings-events.js)
 * ==============================================================================
 *
 * 设置按钮、书签草稿编辑与拖拽排序的事件装配。
 */
import { CONFIG } from '../config/constants.js';
import { escapeHtml, storageGet, storageSet, checkImageReady } from '../utils/helpers.js';

import { modalState } from '../state/store.js';
import { dom } from '../state/dom.js';

import { initDragSort } from './drag-sort.js';

import { previewDraftWallpaper, resetDraftWallpaper } from '../modules/wallpaper.js';
import { openEditModal, closeEditModal, cancelEditModal, openShortcutModal, closeShortcutModal, openCreditsModal, closeCreditsModal, openBookmarkPicker, closeBookmarkPicker, switchSettingsTab, scheduleBgEffects, updateAllBookmarkCounters, getEditFaviconInner, collectEditData, showConfirm, resetBookmarks, importBookmarksJSON, exportBookmarksJSON, getExistingUrls, handleEditIconError, appendDraftBookmarkRow } from '../modules/settings.js';
import { saveUserBookmarks } from '../modules/bookmarks.js';

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

    const settingsTabs = Array.from(document.querySelectorAll('.settings-tab-btn'));
    settingsTabs.forEach((btn, index) => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            switchSettingsTab(btn.dataset.tab);
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
            switchSettingsTab(nextTab.dataset.tab);
            nextTab.focus();
        });
    });

    document.querySelectorAll('.preset-bg-card').forEach(card => {
        card.addEventListener('click', e => {
            e.stopPropagation();
            const url = card.dataset.bg;
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
            dom.jsonDropzone.classList.add('drag-over');
        });
        dom.jsonDropzone.addEventListener('dragleave', e => {
            e.preventDefault();
            e.stopPropagation();
            if (e.relatedTarget && dom.jsonDropzone.contains(e.relatedTarget)) return;
            dom.jsonDropzone.classList.remove('drag-over');
        });
        dom.jsonDropzone.addEventListener('drop', e => {
            e.preventDefault();
            e.stopPropagation();
            dom.jsonDropzone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) importBookmarksJSON(file);
        });
    }

    // 备选池书签一键添加绑定
    if (dom.pickerContent) {
        dom.pickerContent.addEventListener('click', e => {
            const item = e.target.closest('.picker-item');
            if (!item || !item.dataset.name || !item.dataset.url) return;
            const name = item.dataset.name;
            const url = item.dataset.url;
            const urls = getExistingUrls();
            if (urls.has(url)) return;

            appendDraftBookmarkRow({ name, url });
            item.classList.add('opacity-40', 'pointer-events-none');
            item.disabled = true;
            item.setAttribute('aria-disabled', 'true');
            item.setAttribute('aria-label', `${escapeHtml(name)}（已添加）`);
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
        let editFaviconDebounceTimer = null;
        dom.editList.addEventListener('input', (e) => {
            modalState.bookmarksChanged = true;
            const target = e.target;
            const row = target?.closest('.edit-row-card');
            if (!row || !modalState.draftBookmarks) return;
            const id = row.dataset.id;
            const item = modalState.draftBookmarks.find(b => b.id === id);
            if (!item) return;

            if (target.classList.contains('edit-name')) {
                item.name = target.value;
            } else if (target.classList.contains('edit-url')) {
                item.url = target.value;
            }

            // 同步实时 Favicon 预览
            const faviconBox = row.querySelector('.edit-favicon-box');
            if (faviconBox) {
                const nameVal = item.name;
                const urlVal = item.url;
                const initial = (nameVal || '?').trim().charAt(0).toUpperCase() || '?';

                const existingImg = faviconBox.querySelector('.edit-favicon-img');
                const existingInitial = faviconBox.querySelector('.edit-favicon-initial');
                if (existingImg) {
                    existingImg.dataset.initial = initial;
                }
                if (existingInitial) {
                    existingInitial.textContent = initial;
                }

                if (target.classList.contains('edit-url')) {
                    clearTimeout(editFaviconDebounceTimer);
                    editFaviconDebounceTimer = setTimeout(() => {
                        faviconBox.innerHTML = getEditFaviconInner(nameVal, urlVal);
                        const newImg = faviconBox.querySelector('.edit-favicon-img');
                        if (newImg) checkImageReady(newImg, handleEditIconError);
                    }, CONFIG.SUGGEST.DEBOUNCE_MS);
                } else if (target.classList.contains('edit-name')) {
                    if (!existingImg || existingImg.dataset.failed === '1') {
                        faviconBox.innerHTML = getEditFaviconInner(nameVal, urlVal);
                        const newImg = faviconBox.querySelector('.edit-favicon-img');
                        if (newImg) checkImageReady(newImg, handleEditIconError);
                    }
                }
            }
        });

        dom.editList.addEventListener('click', e => {
            const del = e.target.closest('.del-btn');
            if (del) {
                const item = del.closest('.edit-row-card');
                if (item) {
                    modalState.bookmarksChanged = true;
                    const rowId = item.dataset.id;
                    if (rowId && modalState.draftBookmarks) {
                        modalState.draftBookmarks = modalState.draftBookmarks.filter(b => b.id !== rowId);
                    }
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

    // @region [SETTINGS_MODAL_COMMIT] 设置弹窗底部「保存并关闭」落盘入口
    if (dom.saveEditBtn) {
        dom.saveEditBtn.addEventListener('click', async () => {
            if (dom.saveEditBtn.disabled) return;
            dom.saveEditBtn.disabled = true;
            dom.saveEditBtn.setAttribute('aria-busy', 'true');
            try {
                const data = collectEditData();
                if (data.length === 0) {
                    showConfirm('至少需要保留一个名称和 URL 均已填写的书签才能保存。', null, '无法保存');
                    return;
                }

                if (!await flushWallpaperSelection()) {
                    showConfirm('壁纸尚未保存成功，请重新选择后再保存。', null, '无法保存');
                    return;
                }

                // 1. 提交书签
                if (modalState.bookmarksChanged) {
                    saveUserBookmarks(data);
                }

                // 2. 提交背景暗度（壁纸已于用户选择时即选即存，无需重复落盘）
                if (modalState.draftMaskOpacity !== null) {
                    storageSet(CONFIG.KEYS.MASK_OPACITY, modalState.draftMaskOpacity);
                }

                closeEditModal();
            } finally {
                dom.saveEditBtn.disabled = false;
                dom.saveEditBtn.removeAttribute('aria-busy');
            }
        });
    }

    // JSON 导入导出事件绑定
    if (dom.exportJsonBtn) {
        dom.exportJsonBtn.addEventListener('click', async () => {
            if (dom.exportJsonBtn.disabled) return;
            dom.exportJsonBtn.disabled = true;
            try {
                await exportBookmarksJSON();
            } finally {
                dom.exportJsonBtn.disabled = false;
            }
        });
    }
    if (dom.importJsonInput) {
        dom.importJsonInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (file) importBookmarksJSON(file);
            e.target.value = '';
        });
    }

    // 自定义壁纸事件绑定
    if (dom.uploadBgBtn) dom.uploadBgBtn.addEventListener('click', () => dom.uploadBgInput?.click());
    if (dom.uploadBgInput) {
        dom.uploadBgInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (file) {
                if (!file.type.startsWith('image/')) {
                    showConfirm('请选择有效的图片文件（JPG / PNG / WebP 等）。', null, '格式错误');
                    return;
                }
                const reader = new FileReader();
                reader.onload = ev => {
                    const dataUrl = ev.target.result;
                    const img = new Image();
                    img.onload = () => {
                        const MAX_WIDTH = CONFIG.APPEARANCE.MAX_UPLOAD_WIDTH;
                        const MAX_HEIGHT = CONFIG.APPEARANCE.MAX_UPLOAD_HEIGHT;
                        let width = img.width;
                        let height = img.height;

                        if (width > MAX_WIDTH || height > MAX_HEIGHT) {
                            if (width / height > MAX_WIDTH / MAX_HEIGHT) {
                                height = Math.round((height * MAX_WIDTH) / width);
                                width = MAX_WIDTH;
                            } else {
                                width = Math.round((width * MAX_HEIGHT) / height);
                                height = MAX_HEIGHT;
                            }
                        }

                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);

                        const compressedDataUrl = canvas.toDataURL('image/jpeg', CONFIG.APPEARANCE.JPEG_QUALITY);
                        previewDraftWallpaper(compressedDataUrl);

                        ctx.clearRect(0, 0, width, height);
                        canvas.width = 0;
                        canvas.height = 0;
                        img.onload = null;
                        img.onerror = null;
                        img.src = '';
                        reader.onload = null;
                    };
                    img.onerror = () => {
                        previewDraftWallpaper(dataUrl);
                        img.onload = null;
                        img.onerror = null;
                        img.src = '';
                        reader.onload = null;
                    };
                    img.src = dataUrl;
                };
                reader.readAsDataURL(file);
            }
            e.target.value = '';
        });
    }

    if (dom.urlBgBtn) {
        const openUrlInput = () => {
            const current = modalState.draftWallpaper || storageGet(CONFIG.KEYS.USER_WALLPAPER) || '';
            if (dom.urlBgInput) dom.urlBgInput.value = current.startsWith('http') ? current : '';
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
            modalState.draftMaskOpacity = parseInt(e.target.value, 10) || 0;
            scheduleBgEffects(modalState.draftMaskOpacity);
        });
    }

    // 清理缓存事件绑定 (BUG-08 防时序割裂：确认后再执行物理清空与刷新)
    if (dom.clearCacheBtn) {
        dom.clearCacheBtn.addEventListener('click', () => {
            if (dom.clearCacheBtn.disabled) return;
            const confirmFn = showConfirm;
            if (typeof confirmFn !== 'function') return;

            if (!('caches' in window)) {
                confirmFn('当前浏览器不支持 Service Worker 缓存，或已是最新状态。', null, '提示', dom.clearCacheBtn);
                return;
            }

            const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
            const msg = isOffline
                ? '警告：当前处于离线状态！清理 Service Worker 缓存与注销将导致页面在重新联网前无法访问。确定要继续清理并刷新吗？'
                : '确定要清理并重置 Service Worker 离线缓存吗？此操作将清除本地缓存的静态资源并在刷新后重新载入。';

            confirmFn(
                msg,
                async () => {
                    if (dom.clearCacheBtn) dom.clearCacheBtn.disabled = true;
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
                dom.clearCacheBtn,
                '立即清理并刷新'
            );
        });
    }

    initDragSort();
}
