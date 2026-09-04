/**
 * ==============================================================================
 * Glass Start — 全局事件中枢与拖拽排序 (src/js/core/events.js)
 * ==============================================================================
 *
 * 核心功能：
 * 1. 弹窗焦点捕获与 Escape 键盘事件总线 (handleModalTabFocus, bindEvents)
 * 2. 搜索框实时拼音输入法防冲突与联想键盘 ↑↓ 导航
 * 3. 书签编辑列表 HTML5 Drag & Drop 与 FLIP 物理吸附平滑重排 (initDragSort)
 * 4. 设置弹窗内部各类按钮与文件拖拽 (bindEditEvents)
 */
import { CONFIG, backgrounds } from '../config/constants.js';
import {
    normalizeUrl,
    faviconFromUrl,
    safeUrl,
    escapeHtml,
    runWithLoading,
    storageSet,
    storageRemove
} from '../utils/helpers.js';
import { setWallpaperDB } from '../utils/idb.js';
import { state, modalState, pageData } from '../state/store.js';
import { dom, $ } from '../state/dom.js';
import { OverlayStack, MODAL_OVERLAY_IDS } from '../core/overlay-stack.js';
import { switchToStart, switchToNav, isScreenTransitioning } from './screen-state.js';
import {
    doSearch,
    fetchSuggestions,
    hideSuggestions,
    closeDropdown,
    toggleDropdown,
    setEngine,
    openBookmarkUrl,
    openRandomBookmark,
    selectedSuggestionIdx,
    setSelectedSuggestionIdx,
    setOriginalQuery
} from '../modules/search.js';
import {
    toggleWeatherPopover,
    closeWeatherPopover,
    updateWeather
} from '../modules/weather.js';
import {
    switchBg,
    previewDraftWallpaper,
    resetDraftWallpaper,
    updatePresetBgCardsUI,
    findPresetBgIndex,
    clearCustomWallpaper
} from '../modules/wallpaper.js';
import {
    openEditModal,
    closeEditModal,
    cancelEditModal,
    openShortcutModal,
    closeShortcutModal,
    openCreditsModal,
    closeCreditsModal,
    openBookmarkPicker,
    closeBookmarkPicker,
    switchSettingsTab,
    applyBgEffects,
    updateBookmarkCountBadge,
    getEditRowHTML,
    getEditFaviconInner,
    collectEditData,
    showConfirm,
    resetBookmarks,
    importBookmarksJSON,
    exportBookmarksJSON,
    updatePickerCount,
    getExistingUrls,
    handleEditIconError
} from '../modules/settings.js';
import {
    saveUserBookmarks,
    renderBookmarks,
    getSortedCategories,
    initPickerFaviconObserver
} from '../modules/bookmarks.js';

export function handleModalTabFocus(e, modalEl) {
    if (!modalEl) return;
    const focusables = Array.from(modalEl.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(el => {
        return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
    });
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey) {
        if (document.activeElement === first || !modalEl.contains(document.activeElement)) {
            last.focus();
            e.preventDefault();
        }
    } else {
        if (document.activeElement === last || !modalEl.contains(document.activeElement)) {
            first.focus();
            e.preventDefault();
        }
    }
}

export function bindEvents() {
    let isComposing = false;
    let justEndedComposition = false;
    let compositionEndTimer = null;
    let originalQuery = '';
    let suggestDebounceTimer = null;

    const searchInput = dom.searchInput || $('searchInput');
    const searchClearBtn = dom.searchClearBtn || $('searchClearBtn');
    const randomBookmarkBtn = dom.randomBookmarkBtn || $('randomBookmarkBtn');
    const suggestionMenu = dom.suggestionMenu || $('suggestionMenu');
    const engineBtn = dom.engineBtn || $('engineBtn');
    const dropdownMenu = dom.dropdownMenu || $('dropdownMenu');
    const weatherBtn = dom.weatherBtn || $('weatherBtn');
    const weatherPopover = dom.weatherPopover || $('weatherPopover');

    const updateSearchActionButtons = (hasVal) => {
        if (searchClearBtn) searchClearBtn.classList.toggle('hidden', !hasVal);
        if (randomBookmarkBtn) randomBookmarkBtn.classList.toggle('hidden', !!hasVal);
    };

    if (searchInput) {
        searchInput.addEventListener('compositionstart', () => {
            isComposing = true;
            justEndedComposition = false;
            hideSuggestions();
        });

        searchInput.addEventListener('compositionend', () => {
            isComposing = false;
            justEndedComposition = true;
            if (compositionEndTimer) clearTimeout(compositionEndTimer);
            compositionEndTimer = setTimeout(() => {
                justEndedComposition = false;
            }, 100);

            const val = searchInput.value;
            originalQuery = val;
            updateSearchActionButtons(!!val);
            fetchSuggestions(state.engine, val);
        });

        searchInput.addEventListener('click', e => {
            e.stopPropagation();
            closeDropdown();
            const val = searchInput.value.trim();
            if (val && (!suggestionMenu || !suggestionMenu.classList.contains('active'))) {
                fetchSuggestions(state.engine, val);
            }
        });

        searchInput.addEventListener('input', () => {
            const val = searchInput.value;
            originalQuery = val;
            updateSearchActionButtons(!!val);
            if (isComposing) return;
            if (suggestDebounceTimer) clearTimeout(suggestDebounceTimer);
            suggestDebounceTimer = setTimeout(() => {
                fetchSuggestions(state.engine, val);
            }, CONFIG.SUGGEST.DEBOUNCE_MS);
        });
    }

    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', e => {
            e.stopPropagation();
            e.preventDefault();
            if (searchInput) searchInput.value = '';
            originalQuery = '';
            updateSearchActionButtons(false);
            hideSuggestions();
            searchInput?.focus();
        });
    }

    if (randomBookmarkBtn) {
        randomBookmarkBtn.addEventListener('click', e => {
            e.stopPropagation();
            e.preventDefault();
            openRandomBookmark(true);
        });
    }

    if (suggestionMenu) {
        suggestionMenu.addEventListener('click', e => {
            const item = e.target.closest('[data-suggestion]');
            if (!item) return;
            e.stopPropagation();
            const isNewTab = e.altKey || e.metaKey || e.ctrlKey;
            if (item.dataset.type === 'bookmark' && item.dataset.url) {
                openBookmarkUrl(item.dataset.url, isNewTab);
            } else {
                const query = item.dataset.suggestion;
                if (searchInput) searchInput.value = query;
                doSearch(query, isNewTab);
            }
        });
        suggestionMenu.addEventListener('mouseover', e => {
            suggestionMenu.classList.remove('keyboard-nav');
            const item = e.target.closest('.suggestion-item');
            if (!item) return;
            const prevActive = suggestionMenu.querySelector('.suggestion-item.active');
            if (prevActive) prevActive.classList.remove('active');
            item.classList.add('active');
        }, { passive: true });
    }

    if (engineBtn) {
        engineBtn.addEventListener('click', e => {
            e.stopPropagation();
            hideSuggestions();
            closeWeatherPopover();
            toggleDropdown();
        });
    }

    if (dropdownMenu) {
        dropdownMenu.addEventListener('click', e => {
            const btn = e.target.closest('[data-engine]');
            if (btn) { e.stopPropagation(); setEngine(btn.dataset.engine); }
        });
    }

    if (weatherBtn) {
        weatherBtn.addEventListener('click', e => {
            e.stopPropagation();
            closeDropdown();
            hideSuggestions();
            toggleWeatherPopover();
        });
    }

    if (weatherPopover) {
        weatherPopover.addEventListener('click', e => {
            e.stopPropagation();
        });
    }

    const handleCloseMenus = () => {
        closeDropdown();
        hideSuggestions();
        closeWeatherPopover();
    };
    document.addEventListener('click', handleCloseMenus);
    window.addEventListener('blur', handleCloseMenus);

    const handleLinkClickFeedback = (e) => {
        const link = e.target && e.target.closest && e.target.closest('a[target="_blank"], .bookmark-item, .nav-bookmark');
        if (link) {
            if (typeof window.resetActiveTiltCard === 'function') {
                window.resetActiveTiltCard();
            }
            if (typeof link.blur === 'function') link.blur();
            if (document.activeElement && typeof document.activeElement.blur === 'function' && document.activeElement !== document.body && document.activeElement !== searchInput) {
                document.activeElement.blur();
            }
            const isBackgroundOpen = e.metaKey || e.ctrlKey || e.button === 1;
            if (!isBackgroundOpen) {
                link.classList.add('is-clicked');
                link.style.transform = '';
                document.body.classList.add('tab-blurred');
                const clearClicked = () => {
                    link.classList.remove('is-clicked');
                    link.removeEventListener('mouseleave', clearClicked);
                    link.removeEventListener('pointerleave', clearClicked);
                };
                link.addEventListener('mouseleave', clearClicked, { once: true });
                link.addEventListener('pointerleave', clearClicked, { once: true });
                setTimeout(clearClicked, 600);
            }
        }
    };
    document.addEventListener('click', handleLinkClickFeedback, { passive: true });
    document.addEventListener('auxclick', handleLinkClickFeedback, { passive: true });

    const handleTabBlur = () => {
        document.body.classList.add('tab-blurred');
        if (document.activeElement && typeof document.activeElement.blur === 'function' && document.activeElement !== document.body && document.activeElement !== searchInput) {
            document.activeElement.blur();
        }
    };
    const clearTabBlurOnInteraction = () => {
        if (document.body.classList.contains('tab-blurred')) {
            document.body.classList.remove('tab-blurred');
        }
    };
    window.addEventListener('blur', handleTabBlur, { passive: true });
    window.addEventListener('pagehide', handleTabBlur, { passive: true });
    window.addEventListener('mousemove', clearTabBlurOnInteraction, { passive: true });
    window.addEventListener('keydown', clearTabBlurOnInteraction, { passive: true });
    window.addEventListener('touchstart', clearTabBlurOnInteraction, { passive: true });
    window.addEventListener('wheel', clearTabBlurOnInteraction, { passive: true });

    const handleBackToStart = () => {
        if (isScreenTransitioning()) return;
        switchToStart();
    };
    dom.navHint?.addEventListener('click', handleBackToStart);
    dom.navHeader?.addEventListener('click', handleBackToStart);

    document.addEventListener('keydown', e => {
        if (e.key === 'Tab' && !OverlayStack.isEmpty()) {
            const topOverlay = OverlayStack.top();
            if (topOverlay && MODAL_OVERLAY_IDS.has(topOverlay.id)) {
                const modalEl = dom[topOverlay.id] || document.getElementById(topOverlay.id);
                if (modalEl) {
                    handleModalTabFocus(e, modalEl);
                    return;
                }
            }
        }

        if (e.key === 'Escape') {
            const topOverlay = OverlayStack.top();
            if (topOverlay && typeof topOverlay.close === 'function') {
                if (topOverlay.id === 'suggestions' && suggestionMenu?.classList.contains('active') && selectedSuggestionIdx >= 0) {
                    if (searchInput) searchInput.value = originalQuery;
                    updateSearchActionButtons(!!searchInput?.value);
                }
                topOverlay.close();
                e.stopPropagation();
                return;
            }
            closeDropdown();
            hideSuggestions();
            searchInput?.blur();
            return;
        }

        if ((e.key === '/' || e.code === 'Slash') && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            const shortcutModal = dom.shortcutModal || $('shortcutModal');
            if (shortcutModal && !shortcutModal.hasAttribute('hidden') && shortcutModal.classList.contains('active')) {
                closeShortcutModal();
            } else {
                openShortcutModal();
            }
            return;
        }

        if (!OverlayStack.isEmpty()) {
            const onlySuggestions = OverlayStack.top()?.id === 'suggestions' && OverlayStack.stack.length === 1;
            if (!onlySuggestions) return;
        }

        const activeTag = document.activeElement?.tagName;
        const isInputActive = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement?.isContentEditable;

        if ((e.key === 'b' || e.key === 'B') && (e.metaKey || e.ctrlKey) && !isInputActive) {
            e.preventDefault();
            switchBg().catch(() => {});
            return;
        }

        if (document.activeElement === searchInput) {
            if (e.isComposing || e.keyCode === 229 || isComposing || justEndedComposition) return;

            const isSuggestActive = suggestionMenu && suggestionMenu.classList.contains('active');
            const items = isSuggestActive ? Array.from(suggestionMenu.querySelectorAll('.suggestion-item')) : [];

            if (e.key === 'Enter') {
                e.preventDefault();
                const isNewTab = e.altKey || e.metaKey || e.ctrlKey;
                if (selectedSuggestionIdx >= 0 && items[selectedSuggestionIdx]) {
                    const selectedEl = items[selectedSuggestionIdx];
                    if (selectedEl.dataset.type === 'bookmark' && selectedEl.dataset.url) {
                        openBookmarkUrl(selectedEl.dataset.url, isNewTab);
                    } else {
                        doSearch(selectedEl.dataset.suggestion, isNewTab);
                    }
                } else {
                    doSearch(undefined, isNewTab);
                }
                return;
            }

            const updateActiveSuggestion = () => {
                if (suggestionMenu) suggestionMenu.classList.add('keyboard-nav');
                items.forEach((el, idx) => {
                    const isSel = idx === selectedSuggestionIdx;
                    el.classList.toggle('active', isSel);
                    el.setAttribute('aria-selected', isSel ? 'true' : 'false');
                });
                if (selectedSuggestionIdx >= 0 && items[selectedSuggestionIdx]) {
                    searchInput.value = items[selectedSuggestionIdx].dataset.suggestion;
                    searchInput.setAttribute('aria-activedescendant', `sug-opt-${selectedSuggestionIdx}`);
                    items[selectedSuggestionIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                } else {
                    searchInput.value = originalQuery;
                    searchInput.removeAttribute('aria-activedescendant');
                }
                updateSearchActionButtons(!!searchInput.value);
            };

            if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                if (e.key === 'ArrowDown' && items.length > 0) {
                    e.preventDefault();
                    if (selectedSuggestionIdx === -1) {
                        setOriginalQuery(searchInput.value);
                    }
                    let nextIdx = selectedSuggestionIdx + 1;
                    if (nextIdx >= items.length) {
                        nextIdx = -1;
                    }
                    setSelectedSuggestionIdx(nextIdx);
                    updateActiveSuggestion();
                    return;
                }
                if (e.key === 'ArrowUp' && items.length > 0) {
                    e.preventDefault();
                    if (selectedSuggestionIdx === -1) {
                        setOriginalQuery(searchInput.value);
                        setSelectedSuggestionIdx(items.length - 1);
                    } else {
                        setSelectedSuggestionIdx(selectedSuggestionIdx - 1);
                    }
                    updateActiveSuggestion();
                    return;
                }
            }
        }

        if (e.ctrlKey || e.metaKey || e.altKey) return;

        const suggestionActive = suggestionMenu && suggestionMenu.classList.contains('active');
        if (!isInputActive || (document.activeElement === searchInput && !suggestionActive)) {
            const isNavAtTop = dom.navContent ? dom.navContent.scrollTop <= 0 : true;
            const isNavKey = ((e.key === 'PageDown' || e.key === 'ArrowDown') && state.currentSection === 'start')
                || ((e.key === 'PageUp' || e.key === 'Home' || e.key === 'ArrowUp') && state.currentSection === 'nav' && isNavAtTop);
            if (isNavKey && isScreenTransitioning()) {
                e.preventDefault();
                return;
            }
            if ((e.key === 'PageDown' || e.key === 'ArrowDown') && state.currentSection === 'start') {
                e.preventDefault();
                switchToNav();
                return;
            }
            if ((e.key === 'PageUp' || e.key === 'Home' || e.key === 'ArrowUp') && state.currentSection === 'nav' && isNavAtTop) {
                e.preventDefault();
                switchToStart();
                return;
            }
        }

        if (state.currentSection === 'start' && e.key.length === 1 && !isInputActive) {
            searchInput?.focus();
            return;
        }
    });
}

export function initDragSort() {
    let dragSrc = null;
    let dragOverRafId = null;
    let touchMoveRafId = null;
    let lastOverTarget = null;
    let lastIsTop = null;
    const editList = dom.editList || $('editList');
    if (!editList) return;

    function updateDragIndicator(target, isTop) {
        lastOverTarget = target;
        lastIsTop = isTop;
        const lineY = isTop ? (target.offsetTop - 4.5) : (target.offsetTop + target.offsetHeight + 1.5);
        if (dom.dragDropIndicator) {
            dom.dragDropIndicator.style.transform = `translate3d(0, ${lineY}px, 0)`;
            dom.dragDropIndicator.style.opacity = '1';
        }
    }

    function clearDragClasses() {
        if (dragOverRafId) {
            cancelAnimationFrame(dragOverRafId);
            dragOverRafId = null;
        }
        if (touchMoveRafId) {
            cancelAnimationFrame(touchMoveRafId);
            touchMoveRafId = null;
        }
        editList.querySelectorAll('.edit-row-card').forEach(el => {
            el.classList.remove('dragging');
        });
        if (dom.dragDropIndicator) {
            dom.dragDropIndicator.style.opacity = '0';
        }
        lastOverTarget = null;
        lastIsTop = null;
    }

    let isDragHandleActive = false;

    editList.addEventListener('mousedown', e => {
        const handle = e.target.closest('.drag-handle');
        const card = e.target.closest('.edit-row-card');
        if (handle && card) {
            isDragHandleActive = true;
            card.setAttribute('draggable', 'true');
            e.preventDefault();
            try { window.getSelection()?.removeAllRanges(); } catch (_) {}
            document.body.classList.add('bookmark-dragging');
        } else if (card) {
            isDragHandleActive = false;
            card.setAttribute('draggable', 'false');
        }
    });

    document.addEventListener('mouseup', () => {
        isDragHandleActive = false;
        document.body.classList.remove('bookmark-dragging');
        editList.querySelectorAll('.edit-row-card[draggable="true"]').forEach(card => {
            card.setAttribute('draggable', 'false');
        });
    }, { passive: true });

    editList.addEventListener('dragstart', e => {
        if (!isDragHandleActive) {
            e.preventDefault();
            return;
        }
        const item = e.target.closest('.edit-row-card');
        if (!item) {
            e.preventDefault();
            return;
        }
        dragSrc = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try {
            e.dataTransfer.setData('text/plain', item.dataset.idx || '');
        } catch (_) {}
    });

    editList.addEventListener('dragend', () => {
        isDragHandleActive = false;
        document.body.classList.remove('bookmark-dragging');
        editList.querySelectorAll('.edit-row-card[draggable="true"]').forEach(card => {
            card.setAttribute('draggable', 'false');
        });
        clearDragClasses();
        dragSrc = null;
    });

    editList.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const target = e.target.closest('.edit-row-card');
        if (!target || target === dragSrc) return;

        if (dragOverRafId) return;
        dragOverRafId = requestAnimationFrame(() => {
            dragOverRafId = null;
            const rect = target.getBoundingClientRect();
            const relY = (e.clientY - rect.top) / rect.height;

            let isTop = true;
            if (lastOverTarget === target && lastIsTop !== null) {
                isTop = lastIsTop ? (relY <= CONFIG.PHYSICS.DRAG_HYSTERESIS_HIGH) : (relY < CONFIG.PHYSICS.DRAG_HYSTERESIS_LOW);
            } else {
                isTop = relY < 0.5;
            }

            updateDragIndicator(target, isTop);
        });
    });

    editList.addEventListener('dragleave', e => {
        if (e.target === editList || !editList.contains(e.relatedTarget)) {
            clearDragClasses();
        }
    });

    editList.addEventListener('drop', e => {
        e.preventDefault();
        const target = lastOverTarget || e.target.closest('.edit-row-card');
        const isTop = lastIsTop !== null ? lastIsTop : true;
        clearDragClasses();

        if (!target || !dragSrc || target === dragSrc) return;

        const cards = Array.from(editList.querySelectorAll('.edit-row-card'));
        const firstPositions = new Map();
        cards.forEach(card => {
            firstPositions.set(card, card.getBoundingClientRect());
        });

        if (isTop) {
            target.parentNode.insertBefore(dragSrc, target);
        } else {
            target.parentNode.insertBefore(dragSrc, target.nextSibling);
        }
        modalState.bookmarksChanged = true;

        cards.forEach(card => {
            const first = firstPositions.get(card);
            const last = card.getBoundingClientRect();
            if (!first || !last) return;

            const deltaY = first.top - last.top;
            const deltaX = first.left - last.left;

            if (deltaY !== 0 || deltaX !== 0) {
                card.style.transition = 'none';
                card.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;

                requestAnimationFrame(() => {
                    card.style.transition = 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
                    card.style.transform = 'translate3d(0, 0, 0)';
                });

                card.addEventListener('transitionend', (ev) => {
                    if (ev.propertyName !== 'transform') return;
                    card.style.transition = '';
                    card.style.transform = '';
                }, { once: true });
            }
        });

        updateBookmarkCountBadge();
    });

    let editFaviconDebounceTimer = null;
    editList.addEventListener('input', e => {
        const target = e.target;
        const row = target.closest('.edit-row-card');
        if (!row) return;

        const nameInput = row.querySelector('.edit-name');
        const urlInput = row.querySelector('.edit-url');
        const faviconBox = row.querySelector('.edit-favicon-box');
        if (!faviconBox) return;

        const nameVal = nameInput ? nameInput.value : '';
        const urlVal = urlInput ? urlInput.value : '';
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
                if (newImg && newImg.complete) {
                    if (newImg.naturalWidth > 0) newImg.classList.add('loaded');
                    else handleEditIconError(newImg);
                }
            }, 180);
        } else if (target.classList.contains('edit-name')) {
            if (!existingImg || existingImg.dataset.failed === '1') {
                faviconBox.innerHTML = getEditFaviconInner(nameVal, urlVal);
                const newImg = faviconBox.querySelector('.edit-favicon-img');
                if (newImg && newImg.complete) {
                    if (newImg.naturalWidth > 0) newImg.classList.add('loaded');
                    else handleEditIconError(newImg);
                }
            }
        }
    });
}

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

    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            switchSettingsTab(btn.dataset.tab);
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

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = getEditRowHTML(name, url, Date.now()).trim();
            const div = tempDiv.firstElementChild;
            div.classList.add('animate-item-in');
            div.addEventListener('animationend', () => div.classList.remove('animate-item-in'), { once: true });
            dom.editList?.appendChild(div);
            const newImg = div.querySelector('.edit-favicon-img');
            if (newImg && newImg.complete) {
                if (newImg.naturalWidth > 0) newImg.classList.add('loaded');
                else handleEditIconError(newImg);
            }
            item.classList.add('opacity-40', 'pointer-events-none');
            item.disabled = true;
            item.setAttribute('aria-disabled', 'true');
            item.setAttribute('aria-label', `${escapeHtml(name)}（已添加）`);
            item.dataset.name = '';
            item.dataset.url = '';
            const lastSpan = item.querySelector('span:last-child');
            if (lastSpan) lastSpan.textContent = '✓';
            modalState.bookmarksChanged = true;
            updatePickerCount();
            updateBookmarkCountBadge();
        });
    }

    if (dom.addBookmarkBtn) {
        dom.addBookmarkBtn.addEventListener('click', () => {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = getEditRowHTML('', '', Date.now()).trim();
            const div = tempDiv.firstElementChild;
            div.classList.add('animate-item-in');
            div.addEventListener('animationend', () => div.classList.remove('animate-item-in'), { once: true });
            dom.editList?.appendChild(div);
            const newImg = div.querySelector('.edit-favicon-img');
            if (newImg && newImg.complete) {
                if (newImg.naturalWidth > 0) newImg.classList.add('loaded');
                else handleEditIconError(newImg);
            }
            div.querySelector('.edit-name')?.focus();
            modalState.bookmarksChanged = true;
            updateBookmarkCountBadge();
        });
    }

    if (dom.editList) {
        dom.editList.addEventListener('input', () => {
            modalState.bookmarksChanged = true;
        });

        dom.editList.addEventListener('click', e => {
            const del = e.target.closest('.del-btn');
            if (del) {
                const item = del.closest('[data-idx]');
                if (item) {
                    modalState.bookmarksChanged = true;
                    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                        item.remove();
                        updatePickerCount();
                        updateBookmarkCountBadge();
                    } else {
                        item.style.transition = 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)';
                        item.style.opacity = '0';
                        item.style.transform = 'scale(0.92) translateY(-6px)';
                        item.addEventListener('transitionend', () => {
                            item.remove();
                            updatePickerCount();
                            updateBookmarkCountBadge();
                        }, { once: true });
                    }
                }
            }
        });
    }

    // @region [SETTINGS_MODAL_COMMIT] 设置弹窗底部「保存并关闭」落盘入口
    if (dom.saveEditBtn) {
        dom.saveEditBtn.addEventListener('click', () => runWithLoading(dom.saveEditBtn, async () => {
            const data = collectEditData();
            if (data.length === 0) {
                showConfirm('至少需要保留一个名称和 URL 均已填写的书签才能保存。', null, '无法保存');
                return;
            }

            // 1. 提交书签
            if (modalState.bookmarksChanged) {
                saveUserBookmarks(data);
            }

            // 2. 提交壁纸
            if (modalState.wallpaperChanged) {
                const draft = modalState.draftWallpaper;
                const presetIdx = findPresetBgIndex(draft);
                if (presetIdx >= 0) {
                    await clearCustomWallpaper();
                    state.bg = presetIdx;
                    storageSet(CONFIG.KEYS.BG, presetIdx);
                } else if (draft) {
                    state.customWallpaper = draft;
                    await setWallpaperDB(draft);
                    if (draft.length <= CONFIG.APPEARANCE.MAX_LS_WALLPAPER_BYTES) {
                        storageSet(CONFIG.KEYS.USER_WALLPAPER, draft);
                    } else {
                        storageRemove(CONFIG.KEYS.USER_WALLPAPER);
                    }
                    state.bg = 0;
                    storageSet(CONFIG.KEYS.BG, 0);
                } else {
                    await clearCustomWallpaper();
                    state.bg = 0;
                    storageSet(CONFIG.KEYS.BG, 0);
                }
                if (dom.statWallpaperType) {
                    dom.statWallpaperType.textContent = state.customWallpaper ? '自定义' : '系统';
                }
                updatePresetBgCardsUI(draft !== null && draft !== undefined ? draft : backgrounds[0]);
            }

            // 3. 提交特效
            if (modalState.draftMaskOpacity !== null && modalState.draftBgBlur !== null) {
                storageSet(CONFIG.KEYS.MASK_OPACITY, modalState.draftMaskOpacity);
                storageSet(CONFIG.KEYS.BG_BLUR, modalState.draftBgBlur);
            }

            closeEditModal();
        }));
    }

    // JSON 导入导出事件绑定
    if (dom.exportJsonBtn) dom.exportJsonBtn.addEventListener('click', () => runWithLoading(dom.exportJsonBtn, async () => exportBookmarksJSON()));
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
            dom.urlBgInputRow?.classList.remove('hidden');
            dom.urlBgInput?.focus();
        };
        const closeUrlInput = () => {
            dom.urlBgInputRow?.classList.add('hidden');
            if (dom.urlBgInput) dom.urlBgInput.value = '';
        };
        const submitUrl = () => {
            const trimmed = (dom.urlBgInput?.value || '').trim();
            closeUrlInput();
            if (!trimmed) return;
            if (!/^https?:\/\//i.test(trimmed)) {
                showConfirm('请输入以 http:// 或 https:// 开头的有效图片链接。', null, '地址错误');
                return;
            }
            previewDraftWallpaper(trimmed);
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
        dom.resetBgBtn.addEventListener('click', () => {
            resetDraftWallpaper();
        });
    }

    // 壁纸视觉特效事件绑定（草稿实时预览）
    if (dom.maskOpacityInput) {
        dom.maskOpacityInput.addEventListener('input', e => {
            modalState.draftMaskOpacity = parseInt(e.target.value, 10) || 0;
            applyBgEffects(modalState.draftMaskOpacity, modalState.draftBgBlur !== null ? modalState.draftBgBlur : 0, false);
        });
    }
    if (dom.bgBlurInput) {
        dom.bgBlurInput.addEventListener('input', e => {
            modalState.draftBgBlur = parseInt(e.target.value, 10) || 0;
            applyBgEffects(modalState.draftMaskOpacity !== null ? modalState.draftMaskOpacity : 15, modalState.draftBgBlur, false);
        });
    }

    // 清理缓存事件绑定
    if (dom.clearCacheBtn) {
        dom.clearCacheBtn.addEventListener('click', () => runWithLoading(dom.clearCacheBtn, async () => {
            if ('caches' in window) {
                try {
                    const keys = await caches.keys();
                    await Promise.all(keys.map(key => caches.delete(key)));
                    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
                        try {
                            const regs = await navigator.serviceWorker.getRegistrations();
                            await Promise.all(regs.map(r => r.unregister()));
                            await navigator.serviceWorker.register('sw.js');
                        } catch {}
                    }
                    showConfirm('Service Worker 离线资源与页面缓存已成功刷新清理！', null, '离线缓存已重置');
                } catch {
                    showConfirm('缓存清理完成或无需清理。', null, '清理提示');
                }
            } else {
                showConfirm('当前浏览器不支持 Service Worker 缓存，或已是最新状态。', null, '提示');
            }
        }));
    }

    initDragSort();
}
