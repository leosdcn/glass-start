import { updateClock } from '../modules/clock.js';
import { updateWeather } from '../modules/weather.js';
/**
 * 双屏有限状态机与手势调度引擎
 * CSS 状态类控制屏幕位置，过渡锁与惯性门控协调切屏。
 * pageshow / visibilitychange 共用唤醒校准；装配时同步确定离屏起点。
 */
import { CONFIG } from '../config/constants.js';
import { storageGet, storageSet } from '../utils/helpers.js';
import { state } from '../state/store.js';
import { dom, $ } from '../state/dom.js';
import { OverlayStack } from './overlay-stack.js';
import { syncThemeForSection } from './theme-engine.js';
import { resetActiveCard } from './gestures.js';
import { closeDropdown, hideSuggestions } from '../modules/search.js';
import { refreshSidebarNavCache, updateSidebarActive, initFaviconObserver } from '../modules/bookmarks.js';

let isTransitioning = false;
let transitionTimer = null;
let navTransitionCleanup = null;
let isTouchHandled = false;

// 普通切屏与唤醒校准共用任务清理，防止旧动画回调干扰下一次切换。
function clearTransitionTasks() {
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = null;
    navTransitionCleanup?.();
    navTransitionCleanup = null;
}

function resetPageScroll() {
    if (typeof window === 'undefined') return;
    window.scrollTo(0, 0);
    if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
    if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
}

function prepareScreenTransition() {
    if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('nr');
        document.body.classList.remove('tab-blurred');
        document.activeElement?.blur?.();
    }
    clearTransitionTasks();
}

function waitForScreenTransition(nav, targetSection, onComplete) {
    const finish = () => {
        clearTransitionTasks();
        if (state.currentSection !== targetSection) return;
        isTransitioning = false;
        onComplete();
    };
    if (typeof document !== 'undefined' && nav) {
        const onEnd = e => {
            if (e.target === nav && (e.propertyName === 'transform' || e.propertyName === '-webkit-transform')) finish();
        };
        nav.addEventListener('transitionend', onEnd);
        navTransitionCleanup = () => nav.removeEventListener('transitionend', onEnd);
    }
    transitionTimer = setTimeout(finish, CONFIG.GESTURE.TRANSITION_MS + CONFIG.GESTURE.TIMEOUT_BUFFER_MS);
}

const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 400;

export function normDelta(e) {
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= LINE_HEIGHT_PX;
    else if (e.deltaMode === 2) d *= PAGE_HEIGHT_PX;
    return d;
}

export function updateSectionAccessibility(sec) {
    const startSection = dom.startSection || $('startSection');
    const nav = dom.navSection || $('navSection');
    if (sec === 'nav') {
        if (startSection) {
            startSection.setAttribute('aria-hidden', 'true');
            OverlayStack.setBaseInert(startSection, true);
        }
        if (nav) {
            nav.removeAttribute('aria-hidden');
            OverlayStack.setBaseInert(nav, false);
        }
    } else {
        if (startSection) {
            startSection.removeAttribute('aria-hidden');
            OverlayStack.setBaseInert(startSection, false);
        }
        if (nav) {
            nav.setAttribute('aria-hidden', 'true');
            OverlayStack.setBaseInert(nav, true);
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
 * 校准屏幕状态与样式；无明确目标且处于过渡时默认跳过，force 可强制执行。
 * @param {'nav'|'start'} [targetSection]
 * @param {boolean} [force=false]
 */
export function reconcileScreenState(targetSection, force = false) {
    if (!targetSection && !force && isTransitioning) {
        return;
    }
    clearTransitionTasks();
    isTransitioning = false;
    isTouchHandled = false;

    const sec = (targetSection === 'nav' || targetSection === 'start')
        ? targetSection
        : (getSavedSection() || 'start');

    saveSection(sec);
    updateSectionAccessibility(sec);
    updateGearVisibility();
    syncThemeForSection(sec);

    resetPageScroll();

    const navContent = dom.navContent || $('navContent');
    if (navContent && sec === 'start') {
        navContent.scrollTop = 0;
    }

    const startSection = dom.startSection || $('startSection');
    const nav = dom.navSection || $('navSection');

    // 清除残留 transform / transition，由 CSS 状态类决定屏幕位置。
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
        refreshSidebarNavCache();
        updateSidebarActive();
        initFaviconObserver();
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
    prepareScreenTransition();
    closeDropdown();
    hideSuggestions();

    state.currentSection = 'nav';
    isTransitioning = true;

    resetPageScroll();

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
        nav.classList.add('screen-pushed-in');
    }

    waitForScreenTransition(nav, 'nav', () => {
        // 分类与图标检查留到切屏结束，避免与入场首帧的栅格化争用主线程。
        refreshSidebarNavCache();
        updateSidebarActive();
        initFaviconObserver();
        if (typeof window !== 'undefined') {
            window.scrollTo(0, 0);
            document.activeElement?.blur?.();
        }
    });
}

export function switchToStart() {
    if (state.currentSection === 'start' && !isTransitioning) return;
    prepareScreenTransition();
    state.currentSection = 'start';
    isTransitioning = true;

    resetPageScroll();

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
        startSection.classList.remove('screen-pushed-up');
    }
    if (nav) {
        nav.style.transform = '';
        nav.style.transition = '';
        nav.classList.remove('screen-pushed-in');
    }

    waitForScreenTransition(nav, 'start', () => {
        if (typeof window !== 'undefined') {
            window.scrollTo(0, 0);
            updateGearVisibility();
        }
        if (nav) {
            nav.classList.remove('nav-visible');
            nav.classList.add('nav-hidden');
        }
    });
}

export function handleAppWakeUp(wasPersisted = false) {
    updateClock();

    document.querySelectorAll('.is-clicked').forEach(el => el.classList.remove('is-clicked'));
    document.querySelectorAll('.fade-in, .animate-item-in, .category-title-pulse').forEach(el => {
        el.classList.remove('fade-in', 'animate-item-in', 'category-title-pulse');
    });
    document.body.classList.remove('bookmark-dragging');
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));

    resetActiveCard();
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

    updateWeather(false).catch(() => {});
}

export function initScreenGestures() {
    if (typeof document === 'undefined') return;


    reconcileScreenState(getSavedSection() === 'nav' ? 'nav' : 'start');
    // Safari 装配时同步确定离屏起点，避免首次切屏缺少过渡起点。
    const nav = dom.navSection || $('navSection');
    if (nav) void nav.offsetHeight;

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
            if (delta >= CONFIG.GESTURE.SWIPE_THRESHOLD) {
                if (e.cancelable) e.preventDefault();
                switchToNav();
            }
        } else if (state.currentSection === 'nav') {
            if (delta <= -CONFIG.GESTURE.SWIPE_THRESHOLD && (!navContent || navContent.scrollTop <= 0)) {
                if (e.cancelable) e.preventDefault();
                switchToStart();
            }
        }
    }, { passive: false });

    // 2. 移动端触屏手势调度
    let startTouchX = 0;
    let startTouchY = 0;
    let touchStartTime = 0;
    const SWIPE_THRESHOLD = CONFIG.GESTURE.SWIPE_THRESHOLD;

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
