/**
 * 双屏状态与过渡生命周期。
 * CSS 状态类控制位置，所有切屏入口共享过渡锁；唤醒显式强制校准。
 */
import { CONFIG } from '../config/constants.js';
import { storageGet, storageSet } from '../utils/helpers.js';
import { state } from '../state/store.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from './overlay-stack.js';
import { syncWallpaperTheme } from './theme-engine.js';
import { resetActiveCard } from './gestures.js';
import { closeDropdown, hideSuggestions } from '../modules/search.js';
import { renderNavCategories, refreshSidebarNavCache, updateSidebarActive, initFaviconObserver, activateVisibleNavIcons, activateAllNavIcons } from '../modules/bookmarks.js';

let isTransitioning = false;
/** @type {ReturnType<typeof setTimeout>|null} */
let transitionTimer = null;
/** @type {(() => void)|null} */
let navTransitionCleanup = null;

/** @param {WheelEvent} e */
function preventTransitionScroll(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !OverlayStack.isEmpty()) return;
    if (e.cancelable) e.preventDefault();
}

// 普通切屏与唤醒校准共用任务清理，防止旧动画回调干扰下一次切换。
function clearTransitionTasks() {
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = null;
    navTransitionCleanup?.();
    navTransitionCleanup = null;
    if (typeof document !== 'undefined') {
        document.removeEventListener('wheel', preventTransitionScroll);
        document.body.classList.remove('is-screen-transitioning');
    }
}

function resetPageScroll() {
    if (typeof window === 'undefined') return;
    if (window.scrollX === 0 && window.scrollY === 0) return;
    window.scrollTo(0, 0);
    if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
    if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
}

function prepareScreenTransition() {
    // 先撤销旧过渡，再启用新合成层；反过来会立即清掉刚添加的状态类。
    clearTransitionTasks();
    if (typeof document !== 'undefined') {
        document.documentElement.classList.remove('nr');
        document.body.classList.remove('tab-blurred');
        document.body.classList.add('is-screen-transitioning');
        document.addEventListener('wheel', preventTransitionScroll, { passive: false });
        const active = /** @type {HTMLElement|null} */ (document.activeElement);
        active?.blur?.();
    }
}

function isReducedMotion() {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * @param {HTMLElement|null|undefined} nav
 * @param {'start'|'nav'} targetSection
 * @param {() => void} onComplete
 */
function waitForScreenTransition(nav, targetSection, onComplete) {
    const finish = () => {
        if (state.currentSection !== targetSection) {
            clearTransitionTasks();
            return;
        }
        isTransitioning = false;
        // 先完成收尾读取再撤销临时合成层：反过来会在离场帧触发一次强制样式重算。
        try {
            onComplete();
        } finally {
            clearTransitionTasks();
        }
    };
    if (typeof document !== 'undefined' && nav) {
        /** @param {TransitionEvent} e */
        const onEnd = e => {
            if (e.target === nav && (e.propertyName === 'transform' || e.propertyName === '-webkit-transform' || e.propertyName === 'opacity')) finish();
        };
        nav.addEventListener('transitionend', onEnd);
        navTransitionCleanup = () => nav.removeEventListener('transitionend', onEnd);
    }
    // 切屏前已提交过样式，这里再读 transitionDuration 会让浏览器同步重算整棵树；
    // 动画是否生效只取决于减弱动效与首屏 .nr 直达模式，时长本身由 transitionend/兜底计时器驱动。
    if (!nav || isReducedMotion() || document.documentElement.classList.contains('nr')) {
        finish();
        return;
    }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotionChange = () => { if (motion.matches) finish(); };
    motion.addEventListener('change', onMotionChange);
    const cleanup = navTransitionCleanup;
    navTransitionCleanup = () => {
        cleanup?.();
        motion.removeEventListener('change', onMotionChange);
    };
    transitionTimer = setTimeout(finish, CONFIG.GESTURE.TRANSITION_MS + CONFIG.GESTURE.TIMEOUT_BUFFER_MS);
}

/**
 * @param {'start'|'nav'|string} sec
 */
function updateSectionAccessibility(sec) {
    const startSection = dom.startSection;
    const nav = dom.navSection;
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

/**
 * @returns {'start'|'nav'|null}
 */
function getSavedSection() {
    try {
        const val = sessionStorage.getItem('startpage_section');
        return val === 'nav' || val === 'start' ? val : null;
    } catch {
        return null;
    }
}

/**
 * @param {'start'|'nav'} s
 */
function saveSection(s) {
    state.currentSection = s;
    try { sessionStorage.setItem('startpage_section', s); } catch {}
}

function updateGearVisibility() {
    const editBtn = dom.editBookmarksBtn;
    if (editBtn) {
        editBtn.classList.toggle('hidden-on-nav', state.currentSection === 'nav');
    }
}

export function isScreenTransitioning() {
    return isTransitioning;
}

/** 清零内部滚动时禁用平滑，避免异步滚动影响下一轮手势。 */
function resetNavScroll() {
    const content = dom.navContent;
    if (!content || content.scrollTop === 0) return;
    const behavior = content.style.scrollBehavior;
    content.style.scrollBehavior = 'auto';
    content.scrollTop = 0;
    content.style.scrollBehavior = behavior;
}

function refreshNav() {
    activateAllNavIcons();
    refreshSidebarNavCache();
    updateSidebarActive();
    initFaviconObserver();
}

/**
 * 正常切换与唤醒共用目标状态；退出时等动画结束再关闭指针入口。
 * @param {'start'|'nav'} section
 * @param {boolean} immediate
 */
function applySection(section, immediate) {
    const inNav = section === 'nav';
    const start = dom.startSection;
    const nav = dom.navSection;
    if (inNav) {
        renderNavCategories();
        if (immediate) activateAllNavIcons();
        else activateVisibleNavIcons();
    }
    saveSection(section);
    updateSectionAccessibility(section);
    updateGearVisibility();
    syncWallpaperTheme();
    document.body.classList.toggle('in-nav-mode', inNav);

    for (const el of [start, nav]) {
        if (!el) continue;
        el.style.transform = '';
        el.style.transition = immediate ? 'none' : '';
    }
    start?.classList.toggle('screen-pushed-up', inNav);
    if (nav) {
        if (inNav) {
            nav.classList.remove('nav-hidden');
            nav.classList.add('nav-visible');
        }
        nav.classList.toggle('screen-pushed-in', inNav);
        if (!inNav && immediate) finishNavExit();
    }
    if (immediate) {
        // 先应用目标，再提交无动画布局，恢复 transition 后不会补播切屏。
        for (const el of [start, nav]) {
            if (!el) continue;
            void el.offsetHeight;
            el.style.transition = '';
        }
    }
}

function finishNavExit() {
    dom.navSection?.classList.remove('nav-visible');
    dom.navSection?.classList.add('nav-hidden');
}

/**
 * 无明确目标且仍在过渡时默认跳过；唤醒可强制立即恢复。
 * @param {'nav'|'start'} [targetSection]
 * @param {boolean} [force=false]
 */
export function reconcileScreenState(targetSection, force = false) {
    if (!targetSection && !force && isTransitioning) return;
    clearTransitionTasks();
    isTransitioning = false;
    const section = targetSection || getSavedSection() || 'start';
    resetPageScroll();
    if (section === 'start') resetNavScroll();
    applySection(section, true);
    document.documentElement.classList.remove('nr');
    if (section === 'nav') refreshNav();
}

function discoverNav() {
    if (storageGet(CONFIG.KEYS.NAV_DISCOVERED)) return;
    storageSet(CONFIG.KEYS.NAV_DISCOVERED, 1);
    const hint = dom.scrollDownHint;
    if (hint) {
        hint.style.transition = 'opacity 0.6s ease';
        hint.style.opacity = '0';
        setTimeout(() => { hint.style.display = 'none'; }, CONFIG.TIMERS.HINT_FADE);
    }
}

/** @param {'start'|'nav'} section */
function switchSection(section) {
    // 所有入口共用同一条规则：动画期间不反转、不重启、不排队。
    if (isTransitioning || state.currentSection === section) return;
    // 滚动校准放在改变样式之前，避免切屏首帧交错写样式、读滚动布局。
    resetPageScroll();
    if (section === 'nav') resetNavScroll();
    resetActiveCard();
    prepareScreenTransition();
    isTransitioning = true;
    if (section === 'nav') {
        closeDropdown();
        hideSuggestions();
        discoverNav();
    }
    applySection(section, false);
    waitForScreenTransition(dom.navSection, section, () => {
        if (section === 'nav') {
            refreshNav();
            resetPageScroll();
        } else {
            // 返回按钮允许从内容中间离开；先归零再隐藏整屏，
            // 避免读取 scrollTop 时刚被 nav-hidden 弄脏样式而强制重算，也避免入场前重绘列表。
            resetNavScroll();
            resetPageScroll();
            finishNavExit();
        }
    });
}

export function switchToNav() {
    switchSection('nav');
}

export function switchToStart() {
    switchSection('start');
}

/** @type {Record<string, string>} */
export const TRANSITION_MODES = Object.freeze({
    sheet: '卡片层叠',
    classic: '经典推移'
});

/**
 * @returns {string}
 */
export function getTransitionMode() {
    try {
        const saved = localStorage.getItem(CONFIG.KEYS.TRANSITION_MODE);
        return (saved && TRANSITION_MODES[saved]) ? saved : 'sheet';
    } catch {
        return 'sheet';
    }
}

/**
 * @param {string} mode
 */
export function setTransitionMode(mode) {
    if (!TRANSITION_MODES[mode]) return;
    try {
        localStorage.setItem(CONFIG.KEYS.TRANSITION_MODE, mode);
    } catch {}
    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.dataset.transitionMode = mode;
        syncTransitionSwitcherActive(mode);
    }
}

/**
 * @param {string} [mode]
 */
export function syncTransitionSwitcherActive(mode) {
    const targetMode = mode || getTransitionMode();
    document.querySelectorAll('.settings-transition-btn').forEach(btn => {
        const el = /** @type {HTMLElement} */ (btn);
        const isActive = el.dataset.mode === targetMode;
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

export function initTransitionSwitcher() {
    const mode = getTransitionMode();
    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.dataset.transitionMode = mode;
        syncTransitionSwitcherActive(mode);
    }
    const settingsGrid = document.getElementById('settingsTransitionGrid');
    if (settingsGrid) {
        settingsGrid.addEventListener('click', e => {
            const btn = /** @type {HTMLElement|null} */ (e.target instanceof HTMLElement ? e.target.closest('.settings-transition-btn') : null);
            if (!btn || !btn.dataset.mode) return;
            setTransitionMode(btn.dataset.mode);
        });
    }
}
