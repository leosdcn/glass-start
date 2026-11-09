/**
 * 双屏状态与过渡生命周期。
 * CSS 状态类控制位置，所有切屏入口共享过渡锁；唤醒显式强制校准。
 */
import { CONFIG } from '../config/constants.js';
import { storageRemove, storageSet } from '../utils/storage.js';
import { state } from '../state/store.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from './overlay-stack.js';
import { syncWallpaperTheme } from './theme-engine.js';
import { resetActiveCard } from './gestures.js';

/**
 * @typedef {Object} ScreenNavHandlers
 * @property {() => void} [onPrepareNav] 准备渲染导航区（渲染分类与可视图标）
 * @property {() => void} [onRefreshNav] 导航区进入后刷新（侧边栏、观察器及懒加载）
 * @property {() => void} [onBeforeNavTransition] 开始切向导航屏时（关闭下拉与联想）
 */

/** @type {ScreenNavHandlers} */
let screenNavHandlers = {};

/**
 * 注册切屏相关的业务钩子，解除 core 对具体业务模块的下向依赖。
 * @param {ScreenNavHandlers} handlers
 */
export function setScreenNavHandlers(handlers) {
    screenNavHandlers = { ...screenNavHandlers, ...handlers };
}

let isTransitioning = false;
let sectionInitialized = false;
/** @type {ReturnType<typeof setTimeout>|null} */
let transitionTimer = null;
/** @type {AbortController|null} */
let transitionAbortController = null;
/** @type {Set<() => void>} */
const screenSettledCallbacks = new Set();

/** @param {() => void} callback */
export function afterScreenTransition(callback) {
    if (isTransitioning) screenSettledCallbacks.add(callback);
    else queueMicrotask(callback);
}

/** @param {WheelEvent} e */
function preventTransitionScroll(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !OverlayStack.isEmpty()) return;
    if (e.cancelable) e.preventDefault();
}

// 普通切屏与唤醒校准共用任务清理，防止旧动画回调干扰下一次切换。
function clearTransitionTasks() {
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = null;
    if (transitionAbortController) {
        transitionAbortController.abort();
        transitionAbortController = null;
    }
    document.body.classList.remove('is-screen-transitioning');
    // 等当前任务完成收尾或唤醒校准，再交还给等待方。
    for (const callback of screenSettledCallbacks) queueMicrotask(callback);
    screenSettledCallbacks.clear();
}

function resetPageScroll() {
    if (window.scrollX === 0 && window.scrollY === 0) return;
    window.scrollTo(0, 0);
    if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
    if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
}

function prepareScreenTransition() {
    // 先撤销旧过渡，再启用新合成层；反过来会立即清掉刚添加的状态类。
    clearTransitionTasks();
    // 先失焦再改变切屏样式，避免 blur() 同步提交一次整屏样式重算。
    const active = /** @type {HTMLElement|null} */ (document.activeElement);
    active?.blur();
    document.body.classList.remove('tab-blurred');
    document.body.classList.add('is-screen-transitioning');

    transitionAbortController = new AbortController();
    document.addEventListener('wheel', preventTransitionScroll, {
        passive: false,
        signal: transitionAbortController.signal
    });
}

function isReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * @param {HTMLElement|null|undefined} nav
 * @param {'start'|'nav'} targetSection
 * @param {() => void} onComplete
 */
function waitForScreenTransition(nav, targetSection, onComplete) {
    const signal = transitionAbortController?.signal;
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
    if (nav && signal) {
        /** @param {TransitionEvent} e */
        const onEnd = e => {
            if (e.target === nav && (e.propertyName === 'transform' || e.propertyName === '-webkit-transform' || e.propertyName === 'opacity')) finish();
        };
        nav.addEventListener('transitionend', onEnd, { signal });
    }
    // 切屏前已提交过样式，这里再读 transitionDuration 会让浏览器同步重算整棵树；
    // 减弱动效立即完成，其余由 transitionend 和兜底计时器驱动。
    if (!nav || isReducedMotion()) {
        finish();
        return;
    }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (signal) {
        motion.addEventListener('change', () => { if (motion.matches) finish(); }, { signal });
    }
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
            startSection.inert = true;
        }
        if (nav) {
            nav.removeAttribute('aria-hidden');
            nav.inert = false;
        }
    } else {
        if (startSection) {
            startSection.removeAttribute('aria-hidden');
            startSection.inert = false;
        }
        if (nav) {
            nav.setAttribute('aria-hidden', 'true');
            nav.inert = true;
        }
    }
}

/**
 * @param {'start'|'nav'} s
 */
function saveSection(s) {
    sectionInitialized = true;
    state.currentSection = s;
    try { sessionStorage.setItem('startpage_section', s); } catch {}
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
    screenNavHandlers.onRefreshNav?.();
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
        screenNavHandlers.onPrepareNav?.();
    }
    saveSection(section);
    updateSectionAccessibility(section);
    syncWallpaperTheme();

    for (const el of [start, nav]) {
        if (!el) continue;
        if (el.style.transform) el.style.transform = '';
        const targetTransition = immediate ? 'none' : '';
        if (el.style.transition !== targetTransition) el.style.transition = targetTransition;
    }
    if (inNav) nav?.classList.remove('nav-hidden');
    else if (immediate) finishNavExit();
    document.documentElement.dataset.screen = section;
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
    dom.navSection?.classList.add('nav-hidden');
}

/**
 * 无明确目标且仍在过渡时默认跳过；唤醒可强制立即恢复。
 * @param {'nav'|'start'} [targetSection]
 * @param {boolean} [force=false]
 */
export function reconcileScreenState(targetSection, force = false) {
    if (!targetSection && !force && isTransitioning) return;
    const section = targetSection || (sectionInitialized ? state.currentSection
        : document.documentElement.dataset.screen === 'nav' ? 'nav' : 'start');
    // 先读取滚动布局，再清理过渡样式，避免唤醒时提前提交一轮整屏样式重算。
    resetPageScroll();
    if (section === 'start') resetNavScroll();
    clearTransitionTasks();
    isTransitioning = false;
    applySection(section, true);
    document.documentElement.classList.remove('screen-restoring');
    if (section === 'nav') refreshNav();
}

function discoverNav() {
    const root = document.documentElement;
    if (root.hasAttribute('data-nav-discovered')) return;
    storageSet(CONFIG.KEYS.NAV_DISCOVERED, 1);
    root.setAttribute('data-nav-discovered', '');
}

export function resetNavDiscovery() {
    if (!storageRemove(CONFIG.KEYS.NAV_DISCOVERED)) return false;
    document.documentElement.removeAttribute('data-nav-discovered');
    return true;
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
        screenNavHandlers.onBeforeNavTransition?.();
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
    if (section === 'nav') {
        afterScreenTransition(() => {
            if (state.currentSection === 'nav') dom.navContent?.focus({ preventScroll: true });
        });
    }
}

export function switchToNav() {
    switchSection('nav');
}

export function switchToStart() {
    switchSection('start');
}

const VALID_TRANSITION_MODES = new Set(['sheet', 'classic']);

/**
 * @returns {string}
 */
export function getTransitionMode() {
    try {
        const saved = localStorage.getItem(CONFIG.KEYS.TRANSITION_MODE);
        return (saved && VALID_TRANSITION_MODES.has(saved)) ? saved : 'sheet';
    } catch {
        return 'sheet';
    }
}

/**
 * @param {string} mode
 * @returns {boolean}
 */
export function setTransitionMode(mode) {
    if (!VALID_TRANSITION_MODES.has(mode)) return false;
    try {
        localStorage.setItem(CONFIG.KEYS.TRANSITION_MODE, mode);
    } catch {
        return false;
    }
    document.documentElement.dataset.transitionMode = mode;
    syncTransitionSwitcherActive(mode);
    return true;
}

/**
 * @param {string} mode
 */
export function syncTransitionSwitcherActive(mode) {
    document.querySelectorAll('.settings-transition-btn').forEach(btn => {
        const el = /** @type {HTMLElement} */ (btn);
        const isActive = el.dataset.mode === mode;
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

export function initTransitionSwitcher() {
    const mode = getTransitionMode();
    document.documentElement.dataset.transitionMode = mode;
    syncTransitionSwitcherActive(mode);
}
