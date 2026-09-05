/**
 * ==============================================================================
 * Glass Start — 双屏有限状态机与手势导航调度引擎 (src/js/core/screen-state.js)
 * ==============================================================================
 * 遵循 5 大防 BFCache 与生命周期失步铁律：
 * 1. 类名语义零污染（切屏入口首行清理 .nr）；
 * 2. 状态自愈 100% 声明式（零内联 transition:none 异步竞态）；
 * 3. 页面唤醒覆盖 visibilitychange 与 pageshow 双通道；
 * 4. 入场动画自动脱壳；
 * 5. 健全性双重校验。
 */
import { CONFIG } from '../config/constants.js';
import { storageGet, storageSet } from '../utils/helpers.js';
import { state } from '../state/store.js';
import { dom, $ } from '../state/dom.js';
import { OverlayStack } from './overlay-stack.js';
import { syncThemeForSection } from './theme-engine.js';

let scrollAccum = 0;
let resetAccumTimer = null;
let isTransitioning = false;
let transitionTimer = null;
let navTransitionCleanup = null;
let lastTransitionEndTime = 0;
let swallowMomentum = false;
let swallowStartTs = 0;
let swallowDir = null; // 'down' | 'up' | null
let isTouchHandled = false;

// 动态有效滚动阈值支持
let baseThreshold = CONFIG.GESTURE.WHEEL_THRESHOLD;
if (typeof window !== 'undefined') {
    try {
        const urlParam = new URLSearchParams(window.location.search).get('threshold');
        if (urlParam && !isNaN(Number(urlParam))) baseThreshold = Number(urlParam);
    } catch {}
}
export const getScrollThreshold = () => (typeof window !== 'undefined' && window.__SCROLL_THRESHOLD__) ?? baseThreshold;

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

export function resetAccumAfterDelay() {
    if (resetAccumTimer) clearTimeout(resetAccumTimer);
    resetAccumTimer = setTimeout(() => { scrollAccum = 0; }, CONFIG.TIMERS.SCROLL_RESET);
}

export function clearAccum() {
    scrollAccum = 0;
    if (resetAccumTimer) {
        clearTimeout(resetAccumTimer);
        resetAccumTimer = null;
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
 */
export function reconcileScreenState(targetSection) {
    if (transitionTimer) {
        clearTimeout(transitionTimer);
        transitionTimer = null;
    }
    if (typeof navTransitionCleanup === 'function') {
        navTransitionCleanup();
        navTransitionCleanup = null;
    }
    isTransitioning = false;
    swallowMomentum = false;
    swallowDir = null;
    isTouchHandled = false;
    clearAccum();

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

    // 严禁内联 transition:none，清空内联样式 100% 交由 CSS 状态类管理
    if (startSection) {
        startSection.style.transform = '';
        startSection.style.transition = '';
    }
    if (nav) {
        nav.style.transform = '';
        nav.style.transition = '';
    }

    if (sec === 'nav') {
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
        if (startSection) {
            startSection.classList.remove('screen-pushed-up');
        }
        if (nav) {
            nav.classList.remove('screen-pushed-in', 'nav-visible');
            nav.classList.add('nav-hidden');
        }
    }

    // 首行与尾部清除 nr 预水合类
    if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('nr');
    }
}

export function switchToNav() {
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
    clearAccum();

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
    if (startSection) {
        startSection.style.transform = '';
        startSection.style.transition = '';
        startSection.classList.add('screen-pushed-up');
    }
    if (nav) {
        nav.style.transform = '';
        nav.style.transition = '';
        nav.classList.remove('nav-hidden');
        nav.classList.add('nav-visible', 'screen-pushed-in');
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
            lastTransitionEndTime = performance.now();
            clearAccum();
            if (typeof window !== 'undefined') {
                window.scrollTo(0, 0);
                if (document.activeElement && typeof document.activeElement.blur === 'function') {
                    document.activeElement.blur();
                }
            }
        }
    };

    if (typeof document !== 'undefined') {
        const onEnd = (e) => {
            if (e.target === nav && e.propertyName === 'transform') {
                finishSwitchToNav();
            }
        };
        document.addEventListener('transitionend', onEnd);
        navTransitionCleanup = () => document.removeEventListener('transitionend', onEnd);
    }

    transitionTimer = setTimeout(finishSwitchToNav, CONFIG.GESTURE.TRANSITION_MS + 40);
}

export function switchToStart() {
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
    clearAccum();

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
    if (startSection) {
        startSection.style.transform = '';
        startSection.style.transition = '';
        startSection.classList.remove('screen-pushed-up');
    }
    if (nav) {
        nav.style.transform = '';
        nav.style.transition = '';
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
            lastTransitionEndTime = performance.now();
            clearAccum();
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

    if (typeof document !== 'undefined') {
        const onEnd = (e) => {
            if (e.target === nav && e.propertyName === 'transform') {
                finishSwitchToStart();
            }
        };
        document.addEventListener('transitionend', onEnd);
        navTransitionCleanup = () => document.removeEventListener('transitionend', onEnd);
    }

    transitionTimer = setTimeout(finishSwitchToStart, CONFIG.GESTURE.TRANSITION_MS + 40);
}

export function normDelta(e) {
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 16;
    else if (e.deltaMode === 2) d *= 400;
    return d;
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
    reconcileScreenState();

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

    let lastWheelTime = 0;
    const SCROLL_THRESHOLD = getScrollThreshold();

    document.addEventListener('wheel', (e) => {
        const now = performance.now();
        const dt = now - lastWheelTime;
        lastWheelTime = now;
        const delta = normDelta(e);
        const absDelta = Math.abs(delta);
        const vertical = absDelta >= Math.abs(e.deltaX || 0);

        if (swallowMomentum) {
            if (!vertical || !OverlayStack.isEmpty()) return;
            const curDir = delta > 0 ? 'down' : delta < 0 ? 'up' : null;
            if (curDir && curDir !== swallowDir) {
                swallowMomentum = false;
                swallowDir = null;
            } else if (dt >= CONFIG.GESTURE.MOMENTUM_QUIET_MS || now - swallowStartTs >= CONFIG.GESTURE.MOMENTUM_MAX_MS) {
                swallowMomentum = false;
                swallowDir = null;
            } else {
                if (vertical && e.cancelable) e.preventDefault();
                return;
            }
        }

        if (isTransitioning || !OverlayStack.isEmpty()) {
            if (isTransitioning && e.cancelable) e.preventDefault();
            return;
        }
        if (now - lastTransitionEndTime < 100) {
            if (e.cancelable) e.preventDefault();
            return;
        }

        const down = delta > 0;
        const velocity = dt > 0 ? absDelta / dt : 0;
        const isFastGesture = absDelta >= CONFIG.GESTURE.FAST_WHEEL_STEP || velocity > CONFIG.GESTURE.FAST_WHEEL_VELOCITY;
        const effectiveThreshold = isFastGesture ? CONFIG.GESTURE.FAST_WHEEL_THRESHOLD : SCROLL_THRESHOLD;

        const navContent = dom.navContent || $('navContent');

        if (state.currentSection === 'start') {
            if (!down) {
                scrollAccum = Math.max(0, scrollAccum + delta);
                resetAccumAfterDelay();
                return;
            }
            e.preventDefault();
            scrollAccum += delta;
            resetAccumAfterDelay();
            if (scrollAccum >= effectiveThreshold) {
                switchToNav();
                if (isFastGesture) {
                    swallowMomentum = true;
                    swallowStartTs = now;
                    swallowDir = 'down';
                }
            }
        } else {
            if (!down && navContent && navContent.scrollTop <= 0) {
                e.preventDefault();
                scrollAccum += absDelta;
                resetAccumAfterDelay();
                if (scrollAccum >= effectiveThreshold) {
                    switchToStart();
                    if (isFastGesture) {
                        swallowMomentum = true;
                        swallowStartTs = now;
                        swallowDir = 'up';
                    }
                }
            } else {
                clearAccum();
            }
        }
    }, { passive: false });

    // 触屏滑动监听
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
        const absDeltaY = Math.abs(deltaY);

        if (deltaX > absDeltaY) return;

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

        const isFlick = Math.abs(deltaY) >= CONFIG.GESTURE.FLICK_MIN_DISTANCE && velocity > CONFIG.GESTURE.FLICK_MIN_VELOCITY;
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

    // 唤醒自愈多通道监听
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            handleAppWakeUp();
        }
    }, { passive: true });

    window.addEventListener('pageshow', (e) => {
        handleAppWakeUp(!!(e && e.persisted));
    }, { passive: true });
}
