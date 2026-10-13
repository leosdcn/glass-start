import { resetActiveCard } from './gestures.js';

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
import { CONFIG } from '../config/constants.js';

import { state } from '../state/store.js';
import { dom } from '../state/dom.js';
import { OverlayStack, MODAL_OVERLAY_IDS } from '../core/overlay-stack.js';
import { switchToStart, switchToNav, isScreenTransitioning } from './screen-state.js';
export { initDragSort } from './drag-sort.js';
import { doSearch, fetchSuggestions, hideSuggestions, closeDropdown, toggleDropdown, setEngine, openBookmarkUrl, openRandomBookmark, selectedSuggestionIdx, setSelectedSuggestionIdx, setOriginalQuery } from '../modules/search.js';
import { toggleWeatherPopover, closeWeatherPopover } from '../modules/weather.js';
import { switchBg } from '../modules/wallpaper.js';
import { openShortcutModal, closeShortcutModal } from '../modules/settings.js';

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

    const searchInput = dom.searchInput;
    const searchClearBtn = dom.searchClearBtn;
    const randomBookmarkBtn = dom.randomBookmarkBtn;
    const suggestionMenu = dom.suggestionMenu;
    const engineBtn = dom.engineBtn;
    const dropdownMenu = dom.dropdownMenu;
    const weatherBtn = dom.weatherBtn;
    const weatherPopover = dom.weatherPopover;

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
            }, CONFIG.TIMERS.COMPOSITION_END_RESET);

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
            resetActiveCard();
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
                setTimeout(clearClicked, CONFIG.TIMERS.CLICK_FEEDBACK_CLEAR);
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
            const shortcutModal = dom.shortcutModal;
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
            if (e.isComposing || e.keyCode === CONFIG.SECURITY.IME_COMPOSITION_KEY_CODE || isComposing || justEndedComposition) return;

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

export { bindEditEvents } from './settings-events.js';
