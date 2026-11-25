/** 全局快捷键、页面唤醒和跨业务菜单协调；控件内部事件见各业务事件模块。 */
import { cancelDragSort } from './modules/bookmark-drag.js';
import { cancelCategoryPulse, loadBookmarks } from './modules/bookmarks.js';
import { resetActiveCard } from './core/gestures.js';
import { resetScreenInput, canScrollStartDown } from './core/screen-input.js';

import { CONFIG } from './config/constants.js';

import { state } from './state/store.js';
import { dom } from './state/dom.js';
import { OverlayStack } from './core/overlay-stack.js';
import { switchToStart, switchToNav, isScreenTransitioning, reconcileScreenState } from './core/screen-state.js';
import { hideSuggestions, cancelSuggestionRequest, closeDropdown, toggleDropdown } from './modules/search.js';
import { handleSearchKeydown } from './modules/search-events.js';
import { toggleWeatherPopover, closeWeatherPopover, updateWeather } from './modules/weather.js';
import { updateClock, stopClockTimer } from './modules/clock.js';
import { checkServiceWorkerUpdate } from './core/service-worker-updates.js';
import { switchBg } from './modules/wallpaper.js';
import { openShortcutModal, closeShortcutModal } from './modules/settings-static-modals.js';

/** @type {AbortController | null} */
let tabBlurAbortController = null;
const clearTabBlurOnInteraction = () => {
    if (document.body.classList.contains('tab-blurred')) {
        document.body.classList.remove('tab-blurred');
    }
    if (tabBlurAbortController) {
        tabBlurAbortController.abort();
        tabBlurAbortController = null;
    }
};
const attachTabBlurListeners = () => {
    if (tabBlurAbortController) return;
    tabBlurAbortController = new AbortController();
    const opts = { passive: true, signal: tabBlurAbortController.signal };
    window.addEventListener('mousemove', clearTabBlurOnInteraction, opts);
    window.addEventListener('keydown', clearTabBlurOnInteraction, opts);
    window.addEventListener('touchstart', clearTabBlurOnInteraction, opts);
    window.addEventListener('wheel', clearTabBlurOnInteraction, opts);
};

/** 页面恢复时协调业务刷新与交互状态，底层机制不导入业务模块。 */
export function handleAppWakeUp() {
    updateClock();

    cancelDragSort();
    cancelCategoryPulse();
    document.querySelectorAll('.is-clicked, .fade-in, .dragging').forEach(el => {
        el.classList.remove('is-clicked', 'fade-in', 'dragging');
    });

    resetActiveCard();
    resetScreenInput();
    reconcileScreenState(undefined, true);

    checkServiceWorkerUpdate();

    updateWeather(false).catch(() => {});
}

let eventsBound = false;

export function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    let waitingForPageShow = false;
    window.addEventListener('storage', event => {
        const keys = CONFIG.KEYS;
        if (event.storageArea === localStorage && (event.key === null || event.key === keys.BOOKMARKS ||
            event.key === keys.BOOKMARK_KEYS || event.key === keys.CUSTOM_META)) loadBookmarks();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopClockTimer();
        // 从 BFCache 返回时，pageshow 统一接管这一轮唤醒。
        else if (!waitingForPageShow) handleAppWakeUp();
    }, { passive: true });
    window.addEventListener('pageshow', event => {
        waitingForPageShow = false;
        if (event.persisted && !document.hidden) handleAppWakeUp();
    }, { passive: true });

    const { searchInput, engineBtn, weatherBtn } = dom;

    searchInput?.addEventListener('focus', closeWeatherPopover);

    engineBtn?.addEventListener('click', toggleDropdown);
    weatherBtn?.addEventListener('click', toggleWeatherPopover);

    document.addEventListener('click', e => {
        const target = e.target;
        if (!(target instanceof Node)) return;
        // 防抖中的联想还未入栈，也要在点击搜索框以外时作废。
        if (!OverlayStack.has('suggestions') && !searchInput?.contains(target)) cancelSuggestionRequest();
        OverlayStack.closeOutsidePanels(target);
    }, { capture: true });
    const handleTabBlur = () => {
        cancelDragSort();
        document.body.classList.add('tab-blurred');
        attachTabBlurListeners();
    };
    // 切到新标签页时保留候选，回到原页后可继续打开其他结果。
    window.addEventListener('blur', () => {
        closeDropdown();
        closeWeatherPopover();
        handleTabBlur();
    }, { passive: true });
    window.addEventListener('pagehide', event => {
        waitingForPageShow = event.persisted;
        handleTabBlur();
    }, { passive: true });

    /** @param {MouseEvent} e */
    const handleLinkClickFeedback = (e) => {
        if (e.type === 'auxclick' && e.button !== 1) return;
        const targetEl = e.target instanceof Element ? e.target : null;
        const link = /** @type {HTMLElement|null} */ (targetEl?.closest('a[target="_blank"], .bookmark-item, .nav-bookmark'));
        if (link) {
            resetActiveCard();
            const isBackgroundOpen = e.metaKey || e.ctrlKey || e.button === 1;
            if (!isBackgroundOpen) {
                link.classList.add('is-clicked');
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

    dom.navHint?.addEventListener('click', switchToStart);

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
                topOverlay.close();
                e.stopPropagation();
                return;
            }
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

        const topOverlay = OverlayStack.top();
        const onlySuggestions = topOverlay?.id === 'suggestions' && OverlayStack.stack.length === 1;
        if (topOverlay && !onlySuggestions) return;

        const activeEl = /** @type {HTMLElement|null} */ (document.activeElement);
        const activeTag = activeEl?.tagName;
        const isInputActive = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || !!activeEl?.isContentEditable;
        const isSearchActive = activeEl === searchInput;

        if ((e.key === 'b' || e.key === 'B') && (e.metaKey || e.ctrlKey) && !isInputActive) {
            e.preventDefault();
            switchBg().catch(() => {});
            return;
        }

        if (isSearchActive && handleSearchKeydown(e)) return;

        if (e.ctrlKey || e.metaKey || e.altKey) return;

        if (!isInputActive || (isSearchActive && !onlySuggestions)) {
            const enteringNav = state.currentSection === 'start' && (e.key === 'PageDown' || e.key === 'ArrowDown');
            const leavingNav = state.currentSection === 'nav' &&
                (e.key === 'PageUp' || e.key === 'Home' || e.key === 'ArrowUp') &&
                (!dom.navContent || dom.navContent.scrollTop <= 0);
            if ((enteringNav || leavingNav) && isScreenTransitioning()) {
                e.preventDefault();
                return;
            }
            if (enteringNav) {
                e.preventDefault();
                const start = dom.startContent;
                if (start && canScrollStartDown()) {
                    start.scrollBy({ top: e.key === 'PageDown' ? start.clientHeight * 0.9 : 40 });
                } else {
                    switchToNav();
                }
                return;
            }
            if (leavingNav) {
                e.preventDefault();
                switchToStart();
                return;
            }
        }

        if (state.currentSection === 'start' && e.key.length === 1 && e.key !== ' ' &&
            !isInputActive && !activeEl?.closest('button, [role="button"], a, select')) {
            searchInput?.focus();
            return;
        }
    });
}
