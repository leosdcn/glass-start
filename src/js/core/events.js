import { cancelDragSort } from './drag-sort.js';
import { resetActiveCard } from './gestures.js';

/** 装配搜索、键盘与页面交互事件，协调输入法、联想选择和弹窗焦点。 */
import { CONFIG } from '../config/constants.js';

import { state } from '../state/store.js';
import { dom } from '../state/dom.js';
import { OverlayStack, MODAL_OVERLAY_IDS } from '../core/overlay-stack.js';
import { switchToStart, switchToNav, isScreenTransitioning } from './screen-state.js';
import { activateSuggestion, selectSuggestion, getSuggestionCount, fetchSuggestions, hideSuggestions, closeDropdown, toggleDropdown, setEngine, openRandomBookmark, selectedSuggestionIdx, setSelectedSuggestionIdx, originalQuery, setOriginalQuery, scheduleSuggestions } from '../modules/search.js';
import { toggleWeatherPopover, closeWeatherPopover } from '../modules/weather.js';
import { switchBg } from '../modules/wallpaper.js';
import { openShortcutModal, closeShortcutModal } from '../modules/settings.js';

/**
 * @param {KeyboardEvent} e
 * @param {HTMLElement | null} modalEl
 */
function handleModalTabFocus(e, modalEl) {
    if (!modalEl) return;
    const focusables = Array.from(modalEl.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(el => {
        const hEl = /** @type {HTMLElement} */ (el);
        return hEl.tabIndex >= 0 && (hEl.offsetWidth > 0 || hEl.offsetHeight > 0 || hEl === document.activeElement);
    });
    if (focusables.length === 0) return;
    const first = /** @type {HTMLElement} */ (focusables[0]);
    const last = /** @type {HTMLElement} */ (focusables[focusables.length - 1]);
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
    /** @type {ReturnType<typeof setTimeout>|null} */
    let compositionEndTimer = null;

    const searchInput = dom.searchInput;
    const searchClearBtn = dom.searchClearBtn;
    const randomBookmarkBtn = dom.randomBookmarkBtn;
    const suggestionMenu = dom.suggestionMenu;
    const engineBtn = dom.engineBtn;
    const dropdownMenu = dom.dropdownMenu;
    const weatherBtn = dom.weatherBtn;
    const weatherPopover = dom.weatherPopover;

    /** @param {boolean} hasVal */
    const updateSearchActionButtons = (hasVal) => {
        const actionButtons = [
            { btn: searchClearBtn, visible: !!hasVal },
            { btn: randomBookmarkBtn, visible: !hasVal }
        ];
        for (const { btn, visible } of actionButtons) {
            if (!btn) continue;
            btn.classList.toggle('hidden', !visible);
            btn.inert = !visible;
            btn.setAttribute('aria-hidden', String(!visible));
            if (!visible && document.activeElement === btn) searchInput?.focus();
        }
    };
    updateSearchActionButtons(!!searchInput?.value);

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
            setOriginalQuery(val);
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
            setOriginalQuery(val);
            updateSearchActionButtons(!!val);
            if (isComposing) return;
            scheduleSuggestions(val);
        });
    }

    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', e => {
            e.stopPropagation();
            e.preventDefault();
            if (searchInput) searchInput.value = '';
            setOriginalQuery('');
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
            const targetEl = e.target instanceof Element ? e.target : null;
            const item = /** @type {HTMLElement|null} */ (targetEl?.closest('[data-suggestion]'));
            if (!item || !item.dataset.idx) return;
            e.stopPropagation();
            const isNewTab = e.altKey || e.metaKey || e.ctrlKey;
            activateSuggestion(Number(item.dataset.idx), isNewTab);
        });
        suggestionMenu.addEventListener('mouseover', e => {
            if (suggestionMenu.classList.contains('keyboard-nav')) suggestionMenu.classList.remove('keyboard-nav');
            const targetEl = e.target instanceof Element ? e.target : null;
            const item = /** @type {HTMLElement|null} */ (targetEl?.closest('.suggestion-item'));
            if (!item || !item.dataset.idx) return;
            selectSuggestion(Number(item.dataset.idx), { updateInput: false });
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
            const targetEl = e.target instanceof Element ? e.target : null;
            const btn = /** @type {HTMLElement|null} */ (targetEl?.closest('[data-engine]'));
            if (btn && btn.dataset.engine) { e.stopPropagation(); setEngine(btn.dataset.engine); }
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

    let tabBlurListenersAttached = false;
    const clearTabBlurOnInteraction = () => {
        if (document.body.classList.contains('tab-blurred')) {
            document.body.classList.remove('tab-blurred');
        }
        if (tabBlurListenersAttached) {
            tabBlurListenersAttached = false;
            window.removeEventListener('mousemove', clearTabBlurOnInteraction);
            window.removeEventListener('keydown', clearTabBlurOnInteraction);
            window.removeEventListener('touchstart', clearTabBlurOnInteraction);
            window.removeEventListener('wheel', clearTabBlurOnInteraction);
        }
    };
    const attachTabBlurListeners = () => {
        if (!tabBlurListenersAttached) {
            tabBlurListenersAttached = true;
            window.addEventListener('mousemove', clearTabBlurOnInteraction, { passive: true });
            window.addEventListener('keydown', clearTabBlurOnInteraction, { passive: true });
            window.addEventListener('touchstart', clearTabBlurOnInteraction, { passive: true });
            window.addEventListener('wheel', clearTabBlurOnInteraction, { passive: true });
        }
    };

    /** @param {MouseEvent} e */
    const handleLinkClickFeedback = (e) => {
        const targetEl = e.target instanceof Element ? e.target : null;
        const link = /** @type {HTMLElement|null} */ (targetEl?.closest('a[target="_blank"], .bookmark-item, .nav-bookmark'));
        if (link) {
            resetActiveCard();
            if (typeof link.blur === 'function') link.blur();
            const activeEl = /** @type {HTMLElement|null} */ (document.activeElement);
            if (activeEl && typeof activeEl.blur === 'function' && activeEl !== document.body && activeEl !== searchInput && !activeEl.matches('input, textarea, select, [contenteditable]:not([contenteditable=\"false\"])')) {
                activeEl.blur();
            }
            const isBackgroundOpen = e.metaKey || e.ctrlKey || e.button === 1;
            if (!isBackgroundOpen) {
                link.classList.add('is-clicked');
                link.style.transform = '';
                document.body.classList.add('tab-blurred');
                attachTabBlurListeners();
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
        cancelDragSort();
        document.body.classList.add('tab-blurred');
        attachTabBlurListeners();
        const activeEl = /** @type {HTMLElement|null} */ (document.activeElement);
        if (activeEl && typeof activeEl.blur === 'function' && activeEl !== document.body && activeEl !== searchInput && !activeEl.matches('input, textarea, select, [contenteditable]:not([contenteditable=\"false\"])')) {
            activeEl.blur();
        }
    };
    window.addEventListener('blur', handleTabBlur, { passive: true });
    window.addEventListener('pagehide', handleTabBlur, { passive: true });

    const handleBackToStart = () => {
        if (isScreenTransitioning()) return;
        switchToStart();
    };
    dom.navHint?.addEventListener('click', handleBackToStart);

    document.addEventListener('keydown', e => {
        if (e.key === 'Tab' && !OverlayStack.isEmpty()) {
            const topOverlay = OverlayStack.top();
            if (topOverlay && MODAL_OVERLAY_IDS.has(topOverlay.id)) {
                const modalEl = dom[topOverlay.id];
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
            if (OverlayStack.top()?.id === 'shortcutModal') {
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

        const activeEl = /** @type {HTMLElement|null} */ (document.activeElement);
        const activeTag = activeEl?.tagName;
        const isInputActive = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || !!activeEl?.isContentEditable;
        const isInteractiveActive = isInputActive || !!activeEl?.closest('button, [role="button"], a, select');

        if ((e.key === 'b' || e.key === 'B') && (e.metaKey || e.ctrlKey) && !isInputActive) {
            e.preventDefault();
            switchBg().catch(() => {});
            return;
        }

        if (document.activeElement === searchInput) {
            if (e.isComposing || e.keyCode === CONFIG.SECURITY.IME_COMPOSITION_KEY_CODE || isComposing || justEndedComposition) return;

            const isSuggestActive = suggestionMenu && suggestionMenu.classList.contains('active');
            const suggestionCount = isSuggestActive ? getSuggestionCount() : 0;

            if (e.key === 'Enter') {
                e.preventDefault();
                const isNewTab = e.altKey || e.metaKey || e.ctrlKey;
                activateSuggestion(selectedSuggestionIdx, isNewTab);
                return;
            }

            const updateActiveSuggestion = () => {
                selectSuggestion(selectedSuggestionIdx, { keyboard: true });
                if (searchInput) updateSearchActionButtons(!!searchInput.value);
            };

            if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                if (e.key === 'ArrowDown' && suggestionCount > 0) {
                    e.preventDefault();
                    if (selectedSuggestionIdx === -1 && searchInput) {
                        setOriginalQuery(searchInput.value);
                    }
                    let nextIdx = selectedSuggestionIdx + 1;
                    if (nextIdx >= suggestionCount) {
                        nextIdx = -1;
                    }
                    setSelectedSuggestionIdx(nextIdx);
                    updateActiveSuggestion();
                    return;
                }
                if (e.key === 'ArrowUp' && suggestionCount > 0) {
                    e.preventDefault();
                    if (selectedSuggestionIdx === -1 && searchInput) {
                        setOriginalQuery(searchInput.value);
                        setSelectedSuggestionIdx(suggestionCount - 1);
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

        if (state.currentSection === 'start' && e.key.length === 1 && e.key !== ' ' && !isInteractiveActive) {
            searchInput?.focus();
            return;
        }
    });
}
