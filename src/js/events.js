/** 全局快捷键、页面唤醒和跨业务菜单协调；控件内部事件见各业务事件模块。 */
import { cancelDragSort } from './modules/bookmark-drag.js';
import { resetActiveCard } from './core/gestures.js';
import { resetScreenInput, blurNonEditableActive } from './core/screen-input.js';

import { CONFIG } from './config/constants.js';

import { state } from './state/store.js';
import { dom } from './state/dom.js';
import { OverlayStack } from './core/overlay-stack.js';
import { switchToStart, switchToNav, isScreenTransitioning, reconcileScreenState } from './core/screen-state.js';
import { hideSuggestions, closeDropdown, toggleDropdown } from './modules/search.js';
import { restoreSearchQuery, handleSearchKeydown } from './modules/search-events.js';
import { toggleWeatherPopover, closeWeatherPopover, updateWeather } from './modules/weather.js';
import { updateClock, stopClockTimer } from './modules/clock.js';
import { checkServiceWorkerUpdate } from './core/service-worker-updates.js';
import { switchBg } from './modules/wallpaper.js';
import { openShortcutModal, closeShortcutModal } from './modules/settings.js';

/** 页面恢复时协调业务刷新与交互状态，底层机制不导入业务模块。 */
export function handleAppWakeUp() {
    updateClock();

    document.querySelectorAll('.is-clicked').forEach(el => el.classList.remove('is-clicked'));
    document.querySelectorAll('.fade-in, .animate-item-in, .category-title-pulse').forEach(el => {
        el.classList.remove('fade-in', 'animate-item-in', 'category-title-pulse');
    });
    cancelDragSort();
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));

    resetActiveCard();
    blurNonEditableActive();
    resetScreenInput();
    reconcileScreenState(undefined, true);

    checkServiceWorkerUpdate();

    updateWeather(false).catch(() => {});
}

export function bindEvents() {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopClockTimer();
        else handleAppWakeUp();
    }, { passive: true });
    window.addEventListener('pageshow', event => {
        if (event.persisted) handleAppWakeUp();
    }, { passive: true });

    const { searchInput, suggestionMenu, engineBtn, weatherBtn } = dom;

    searchInput?.addEventListener('focus', closeWeatherPopover);

    if (engineBtn) {
        engineBtn.addEventListener('click', e => {
            e.stopPropagation();
            hideSuggestions();
            closeWeatherPopover();
            toggleDropdown();
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

    document.addEventListener('click', () => {
        closeDropdown();
        hideSuggestions();
        closeWeatherPopover();
    });
    // 切到新标签页时保留候选，回到原页后可继续打开其他结果。
    window.addEventListener('blur', () => {
        closeDropdown();
        closeWeatherPopover();
    });

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
            blurNonEditableActive();
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
        blurNonEditableActive();
    };
    window.addEventListener('blur', handleTabBlur, { passive: true });
    window.addEventListener('pagehide', handleTabBlur, { passive: true });

    const handleBackToStart = () => {
        if (isScreenTransitioning()) return;
        switchToStart();
    };
    dom.navHint?.addEventListener('click', handleBackToStart);

    document.addEventListener('keydown', e => {
        if (e.defaultPrevented) return;
        if (e.isComposing || e.keyCode === CONFIG.SECURITY.IME_COMPOSITION_KEY_CODE) {
            // Chrome 仍可能把组合态的 Escape 交给原生 dialog 关闭。
            if (e.key === 'Escape' && OverlayStack.topModal()) e.preventDefault();
            return;
        }

        if (e.key === 'Escape') {
            const topOverlay = OverlayStack.top();
            if (topOverlay) {
                e.preventDefault();
                if (topOverlay.id === 'suggestions' && suggestionMenu?.classList.contains('active')) restoreSearchQuery();
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

        if (handleSearchKeydown(e)) return;

        if (e.ctrlKey || e.metaKey || e.altKey) return;

        const suggestionActive = suggestionMenu && suggestionMenu.classList.contains('active');
        if (!isInputActive || (document.activeElement === searchInput && !suggestionActive)) {
            const isNavAtTop = state.currentSection === 'nav' ? (!dom.navContent || dom.navContent.scrollTop <= 0) : true;
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
