/**
 * ==============================================================================
 * Glass Start — 双屏有限状态机与手势调度引擎 (src/js/core/screen-state.js)
 * ==============================================================================
 * 遵循 5 大防 BFCache 与生命周期失步铁律：
 * 1. 状态自愈 100% 声明式（零内联 transition:none 异步竞态）；
 * 2. 纯 GPU 硬件加速 (translate3d)，零全站滚动，零 Backdrop-filter 重绘闪烁；
 * 3. 状态锁 (isTransitioning) 天然无感吞咽触控板与滚轮动量余震；
 * 4. 页面唤醒覆盖 visibilitychange 与 pageshow 双通道；
 * 5. Safari 冷启动首帧同步 Layout 对齐，杜绝过渡提前截断。
 */
import { CONFIG } from '../config/constants.js';
import { storageGet, storageSet } from '../utils/helpers.js';
import { state } from '../state/store.js';
import { dom, $ } from '../state/dom.js';
import { OverlayStack } from './overlay-stack.js';
import { syncThemeForSection } from './theme-engine.js';

let isTransitioning = false;
let transitionTimer = null;
let navTransitionCleanup = null;
let isTouchHandled = false;

// 兼容性辅助导出（为历史模块调用提供平稳存根）
export const getScrollThreshold = () => (typeof window !== 'undefined' && window.__SCROLL_THRESHOLD__) ?? CONFIG.GESTURE.WHEEL_THRESHOLD;
export function resetAccumAfterDelay() {}
export function clearAccum() {}

export function normDelta(e) {
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 16;
    else if (e.deltaMode === 2) d *= 400;
    return d;
}

export function updateSectionAccessibility(sec) {
    const startSection = dom.startSection || $('startSection');
    const nav = dom.navSection || $('navSection');
    if (sec === 'nav') {
        if (startSection) {
            startSection.setAttribute('aria-hidden', 'true');
            startSection.setAttribute('inert', '');
        }
        if (nav) {
            nav.removeAttribute('aria-hidden');
            nav.removeAttribute('inert');
        }
    } else {
        if (startSection) {
            startSection.removeAttribute('aria-hidden');
            startSection.removeAttribute('inert');
        }
        if (nav) {
            nav.setAttribute('aria-hidden', 'true');
            nav.setAttribute('inert', '');
        }
    }
}

export function getSavedSection() {
    try { return sessionStorage.getItem('startpage_section'); } catch { return null; }
}

export function saveSection(s) {
    state.currentSection = s;
    try { sessionStorage.setItem('startpage_section', s); } catch {}
}

export function updateGearVisibility() {
    const editBtn = dom.editBookmarksBtn || $('editBookmarksBtn');
    if (editBtn) {
        editBtn.classList.toggle('hidden-on-nav', state.currentSection === 'nav');
    }
}

export function isScreenTransitioning() {
    return isTransitioning;
}

/**
 * 幂等式全屏状态与 DOM 样式强制对齐校准器
 * @param {'nav'|'start'} [targetSection]
 * @param {boolean} [force=false]
 */
export function reconcileScreenState(targetSection, force = false) {
    if (!targetSection && !force && isTransitioning) {
        return;
    }
    if (transitionTimer) {
        clearTimeout(transitionTimer);
        transitionTimer = null;
    }
    if (typeof navTransitionCleanup === 'function') {
        navTransitionCleanup();
        navTransitionCleanup = null;
    }
    isTransitioning = false;
    isTouchHandled = false;

    const sec = (targetSection === 'nav' || targetSection === 'start')
        ? targetSection
        : (getSavedSection() || 'start');

    state.currentSection = sec;
    saveSection(sec);
    updateSectionAccessibility(sec);
    updateGearVisibility();
    syncThemeForSection(sec);

    if (typeof window !== 'undefined') {
        window.scrollTo(0, 0);
        if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
        if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
    }

    const navContent = dom.navContent || $('navContent');
    if (navContent && sec === 'start') {
        navContent.scrollTop = 0;
    }

    const startSection = dom.startSection || $('startSection');
    const nav = dom.navSection || $('navSection');

    // 清空可能残留的内联样式，100% 声明式交给 CSS 状态类管理
    if (startSection) {
        startSection.style.transform = '';
        startSection.style.transition = '';
    }
    if (nav) {
        nav.style.transform = '';
        nav.style.transition = '';
    }

    if (sec === 'nav') {
        document.body.classList.add('in-nav-mode');
        if (startSection) {
            startSection.classList.add('screen-pushed-up');
        }
        if (nav) {
            nav.classList.remove('nav-hidden');
            nav.classList.add('nav-visible', 'screen-pushed-in');
        }
        if (typeof window.refreshSidebarNavCache === 'function') window.refreshSidebarNavCache();
        if (typeof window.updateSidebarActive === 'function') window.updateSidebarActive();
        if (typeof window.initFaviconObserver === 'function') window.initFaviconObserver();
    } else {
        document.body.classList.remove('in-nav-mode');
        if (startSection) {
            startSection.classList.remove('screen-pushed-up');
        }
        if (nav) {
            nav.classList.remove('screen-pushed-in', 'nav-visible');
            nav.classList.add('nav-hidden');
        }
    }

    // 预水合类清理
    if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('nr');
    }
}

export function switchToNav() {
    if (state.currentSection === 'nav' && !isTransitioning) return;
    if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('nr');
        if (document.body.classList.contains('tab-blurred')) {
            document.body.classList.remove('tab-blurred');
        }
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }
    }
    if (transitionTimer) {
        clearTimeout(transitionTimer);
        transitionTimer = null;
    }
    if (typeof navTransitionCleanup === 'function') {
        navTransitionCleanup();
        navTransitionCleanup = null;
    }
    if (typeof window.closeDropdown === 'function') window.closeDropdown();
    if (typeof window.hideSuggestions === 'function') window.hideSuggestions();

    state.currentSection = 'nav';
    isTransitioning = true;

    if (typeof window !== 'undefined') {
        window.scrollTo(0, 0);
        if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
        if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
    }

    const navContent = dom.navContent || $('navContent');
    if (navContent) {
        navContent.style.scrollBehavior = 'auto';
        navContent.scrollTop = 0;
        requestAnimationFrame(() => {
            navContent.style.scrollBehavior = '';
        });
    }

    saveSection('nav');
    updateSectionAccessibility('nav');
    updateGearVisibility();
    syncThemeForSection('nav');

    // 下滑提示淡出
    try {
        if (!storageGet(CONFIG.KEYS.NAV_DISCOVERED)) {
            storageSet(CONFIG.KEYS.NAV_DISCOVERED, 1);
            const hint = dom.scrollDownHint || $('scrollDownHint');
            if (hint) {
                hint.style.transition = 'opacity 0.6s ease';
                hint.style.opacity = '0';
                setTimeout(() => { hint.style.display = 'none'; }, CONFIG.TIMERS.HINT_FADE);
            }
        }
    } catch {}

    const startSection = dom.startSection || $('startSection');
    const nav = dom.navSection || $('navSection');

    document.body.classList.add('in-nav-mode');

    if (startSection) {
        startSection.style.transform = '';
        startSection.style.transition = '';
        startSection.classList.add('screen-pushed-up');
    }
    if (nav) {
        nav.style.transform = '';
        nav.style.transition = '';
        nav.classList.remove('nav-hidden');
        nav.classList.add('nav-visible');
        // Safari 关键对齐：强制触发一次同步 Layout，消除首帧离屏优化导致的动画截断
        void nav.offsetHeight;
        nav.classList.add('screen-pushed-in');
    }

    requestAnimationFrame(() => {
        if (typeof window.refreshSidebarNavCache === 'function') window.refreshSidebarNavCache();
        if (typeof window.updateSidebarActive === 'function') window.updateSidebarActive();
        if (typeof window.initFaviconObserver === 'function') window.initFaviconObserver();
    });

    const finishSwitchToNav = () => {
        if (transitionTimer) {
            clearTimeout(transitionTimer);
            transitionTimer = null;
        }
        if (typeof navTransitionCleanup === 'function') {
            navTransitionCleanup();
            navTransitionCleanup = null;
        }
        if (state.currentSection === 'nav') {
            isTransitioning = false;
            if (typeof window !== 'undefined') {
                window.scrollTo(0, 0);
                if (document.activeElement && typeof document.activeElement.blur === 'function') {
                    document.activeElement.blur();
                }
            }
        }
    };

    if (typeof document !== 'undefined' && nav) {
        const onEnd = (e) => {
            if (e.target === nav && (e.propertyName === 'transform' || e.propertyName === '-webkit-transform')) {
                finishSwitchToNav();
            }
        };
        nav.addEventListener('transitionend', onEnd);
        navTransitionCleanup = () => nav.removeEventListener('transitionend', onEnd);
    }

    transitionTimer = setTimeout(finishSwitchToNav, (CONFIG.GESTURE.TRANSITION_MS || 580) + 150);
}

export function switchToStart() {
    if (state.currentSection === 'start' && !isTransitioning) return;
    if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('nr');
        if (document.body.classList.contains('tab-blurred')) {
            document.body.classList.remove('tab-blurred');
        }
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }
    }
    if (transitionTimer) {
        clearTimeout(transitionTimer);
        transitionTimer = null;
    }
    if (typeof navTransitionCleanup === 'function') {
        navTransitionCleanup();
        navTransitionCleanup = null;
    }
    state.currentSection = 'start';
    isTransitioning = true;

    if (typeof window !== 'undefined') {
        window.scrollTo(0, 0);
        if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
        if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
    }

    const navContent = dom.navContent || $('navContent');
    if (navContent) navContent.scrollTop = 0;

    saveSection('start');
    updateSectionAccessibility('start');
    updateGearVisibility();
    syncThemeForSection('start');

    const startSection = dom.startSection || $('startSection');
    const nav = dom.navSection || $('navSection');

    document.body.classList.remove('in-nav-mode');

    if (startSection) {
        startSection.style.transform = '';
        startSection.style.transition = '';
        void startSection.offsetHeight;
        startSection.classList.remove('screen-pushed-up');
    }
    if (nav) {
        nav.style.transform = '';
        nav.style.transition = '';
        void nav.offsetHeight;
        nav.classList.remove('screen-pushed-in');
    }

    const finishSwitchToStart = () => {
        if (transitionTimer) {
            clearTimeout(transitionTimer);
            transitionTimer = null;
        }
        if (typeof navTransitionCleanup === 'function') {
            navTransitionCleanup();
            navTransitionCleanup = null;
        }
        if (state.currentSection === 'start') {
            isTransitioning = false;
            if (typeof window !== 'undefined') {
                window.scrollTo(0, 0);
                updateGearVisibility();
            }
            if (nav) {
                nav.classList.remove('nav-visible');
                nav.classList.add('nav-hidden');
            }
        }
    };

    if (typeof document !== 'undefined' && nav) {
        const onEnd = (e) => {
            if (e.target === nav && (e.propertyName === 'transform' || e.propertyName === '-webkit-transform')) {
                finishSwitchToStart();
            }
        };
        nav.addEventListener('transitionend', onEnd);
        navTransitionCleanup = () => nav.removeEventListener('transitionend', onEnd);
    }

    transitionTimer = setTimeout(finishSwitchToStart, (CONFIG.GESTURE.TRANSITION_MS || 580) + 150);
}

export function handleAppWakeUp(wasPersisted = false) {
    if (typeof window.updateClock === 'function') window.updateClock();

    document.querySelectorAll('.is-clicked').forEach(el => el.classList.remove('is-clicked'));
    document.querySelectorAll('.fade-in, .animate-item-in, .category-title-pulse').forEach(el => {
        el.classList.remove('fade-in', 'animate-item-in', 'category-title-pulse');
    });
    document.body.classList.remove('bookmark-dragging');
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));

    if (typeof window.resetActiveTiltCard === 'function') {
        window.resetActiveTiltCard();
    }
    if (document.activeElement && typeof document.activeElement.blur === 'function' && document.activeElement !== document.body && document.activeElement !== (dom.searchInput || $('searchInput'))) {
        document.activeElement.blur();
    }
    reconcileScreenState(undefined, true);

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.getRegistration().then(reg => {
            if (reg) reg.update().catch(() => {});
        }).catch(() => {});
    }

    const startSec = dom.startSection || $('startSection');
    const navSec = dom.navSection || $('navSection');
    [startSec, navSec].forEach(sec => {
        if (sec) {
            sec.style.willChange = 'auto';
            sec.style.display = 'none';
            void sec.offsetHeight;
            sec.style.display = '';
            sec.style.willChange = 'transform';
        }
    });

    if (typeof window.updateWeather === 'function') {
        window.updateWeather(false).catch(() => {});
    }
}

export function initScreenGestures() {
    if (typeof document === 'undefined') return;

    window.switchToNav = switchToNav;
    window.switchToStart = switchToStart;
    window.reconcileScreenState = reconcileScreenState;
    window.isScreenTransitioning = isScreenTransitioning;

    reconcileScreenState(getSavedSection() === 'nav' ? 'nav' : 'start');

    // 1. 鼠标滚轮调度：离散意图直接触发，状态锁 (isTransitioning) 天然吞咽余震
    document.addEventListener('wheel', (e) => {
        if (isTransitioning || !OverlayStack.isEmpty()) {
            if (isTransitioning && e.cancelable) e.preventDefault();
            return;
        }

        const delta = normDelta(e);
        const absDelta = Math.abs(delta);
        if (absDelta < Math.abs(e.deltaX || 0)) return;

        const navContent = dom.navContent || $('navContent');

        if (state.currentSection === 'start') {
            if (delta >= 40) {
                if (e.cancelable) e.preventDefault();
                switchToNav();
            }
        } else if (state.currentSection === 'nav') {
            if (delta <= -40 && (!navContent || navContent.scrollTop <= 0)) {
                if (e.cancelable) e.preventDefault();
                switchToStart();
            }
        }
    }, { passive: false });

    // 2. 移动端触屏手势调度
    let startTouchX = 0;
    let startTouchY = 0;
    let touchStartTime = 0;
    const SWIPE_THRESHOLD = CONFIG.GESTURE.SWIPE_THRESHOLD || 40;

    document.addEventListener('touchstart', (e) => {
        if (isTransitioning || !OverlayStack.isEmpty()) return;
        if (!e.touches || e.touches.length !== 1) {
            isTouchHandled = true;
            return;
        }
        if (e.target && typeof e.target.closest === 'function' && (e.target.closest('#sidebar') || e.target.closest('#weatherWidget') || e.target.closest('#editBookmarksBtn'))) {
            isTouchHandled = true;
            return;
        }
        startTouchX = e.touches[0].clientX;
        startTouchY = e.touches[0].clientY;
        touchStartTime = performance.now();
        isTouchHandled = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (isTransitioning || isTouchHandled || !OverlayStack.isEmpty()) return;
        if (!e.touches || e.touches.length === 0) return;

        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const deltaX = Math.abs(startTouchX - currentX);
        const deltaY = startTouchY - currentY;

        if (deltaX > Math.abs(deltaY)) return;

        const navContent = dom.navContent || $('navContent');

        if (state.currentSection === 'start') {
            if (deltaY >= SWIPE_THRESHOLD) {
                isTouchHandled = true;
                if (e.cancelable) e.preventDefault();
                switchToNav();
            }
        } else if (state.currentSection === 'nav') {
            if (deltaY <= -SWIPE_THRESHOLD && navContent && navContent.scrollTop <= 0) {
                isTouchHandled = true;
                if (e.cancelable) e.preventDefault();
                switchToStart();
            }
        }
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
        if (isTransitioning || isTouchHandled || !OverlayStack.isEmpty()) return;
        const endTouchY = (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0].clientY : startTouchY;
        const deltaY = startTouchY - endTouchY;
        const dt = Math.max(1, performance.now() - touchStartTime);
        const velocity = Math.abs(deltaY) / dt;

        const isFlick = Math.abs(deltaY) >= (CONFIG.GESTURE.FLICK_MIN_DISTANCE || 25) && velocity > (CONFIG.GESTURE.FLICK_MIN_VELOCITY || 0.25);
        const navContent = dom.navContent || $('navContent');

        if (state.currentSection === 'start') {
            if (deltaY >= SWIPE_THRESHOLD || (deltaY > 0 && isFlick)) {
                isTouchHandled = true;
                switchToNav();
            }
        } else if (state.currentSection === 'nav') {
            if ((deltaY <= -SWIPE_THRESHOLD || (deltaY < 0 && isFlick)) && navContent && navContent.scrollTop <= 0) {
                isTouchHandled = true;
                switchToStart();
            }
        }
    }, { passive: true });

    document.addEventListener('touchcancel', () => {
        isTouchHandled = false;
    }, { passive: true });

    // 3. 页面唤醒自愈多通道
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            handleAppWakeUp();
        }
    }, { passive: true });

    window.addEventListener('pageshow', (e) => {
        handleAppWakeUp(!!(e && e.persisted));
    }, { passive: true });
}
