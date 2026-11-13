/** 双屏输入仲裁；原生内容滚动与切屏意图分开处理。 */
import { CONFIG } from '../config/constants.js';
import { dom } from '../state/dom.js';
import { state } from '../state/store.js';
import { OverlayStack } from './overlay-stack.js';
import { isScreenTransitioning, switchToNav, switchToStart } from './screen-state.js';

const EXCLUDED_TARGETS = '#sidebar, #weatherWidget, #editBookmarksBtn, input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** 滚轮手势会话状态机：集中维护滚动窗口、方向与惯性到顶余量吸收。 */
const wheelSession = {
    time: -Infinity,
    windowStart: 0,
    direction: 0,
    distance: 0,
    consumed: false,
    navWasAtTop: true,
    navTopArrivalTime: -Infinity,
    navCoastingToTop: false,

    reset() {
        this.time = -Infinity;
        this.windowStart = 0;
        this.direction = 0;
        this.distance = 0;
        this.consumed = false;
        this.navWasAtTop = isNavAtTop();
        this.navTopArrivalTime = -Infinity;
        this.navCoastingToTop = false;
    },

    /** @param {number} now */
    restartWindow(now) {
        this.distance = 0;
        this.windowStart = now;
    },

    consume() {
        this.consumed = true;
    }
};

/** @type {{ id: number, x: number, y: number, time: number, canReturn: boolean }|null} */
let touch = null;
let navTouchMoveBlocked = false;

function clearTouchGesture() {
    touch = null;
}

/** 局部监听必须在手指落下前安装，才能可靠取消真实浏览器滚动。 @param {Event} event */
function handleActiveTouchMove(event) {
    handleTouch(/** @type {TouchEvent} */ (event), false, true);
}

function syncNavTouchMove() {
    const block = isNavAtTop();
    if (block === navTouchMoveBlocked || !dom.navContent) return;
    navTouchMoveBlocked = block;
    if (block) dom.navContent.addEventListener('touchmove', handleActiveTouchMove, { passive: false });
    else dom.navContent.removeEventListener('touchmove', handleActiveTouchMove);
}

export function resetScreenInput() {
    wheelSession.reset();
    clearTouchGesture();
    syncNavTouchMove();
}

/**
 * 失焦非输入型可聚焦元素（如链接、卡片、按钮），避免保持高亮；正在编辑的输入框与搜索栏除外。
 */
export function blurNonEditableActive() {
    const active = /** @type {HTMLElement|null} */ (document.activeElement);
    if (active && active !== document.body && active !== dom.searchInput && !active.closest('dialog:modal') &&
        !active.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
        active.blur();
    }
}

/** @param {EventTarget|null} target */
function isExcluded(target) {
    return target instanceof Element && !!target.closest(EXCLUDED_TARGETS);
}

function isNavAtTop() {
    return !dom.navContent || dom.navContent.scrollTop <= 0;
}

export function canScrollStartDown() {
    const start = dom.startContent;
    return Boolean(start && start.scrollTop + start.clientHeight < start.scrollHeight - 1);
}

/** @param {Event} e */
function recordNavScroll(e) {
    const atTop = isNavAtTop();
    syncNavTouchMove();
    if (!atTop && state.currentSection === 'nav') {
        clearTouchGesture();
        wheelSession.navCoastingToTop = false;
    }
    if (atTop && !wheelSession.navWasAtTop) {
        wheelSession.navTopArrivalTime = e.timeStamp;
        wheelSession.navCoastingToTop = true;
    }
    wheelSession.navWasAtTop = atTop;
}

/** @param {WheelEvent} e */
function handleWheel(e) {
    // 缩放、横向滚动交给浏览器，不作为切屏手势。
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    const delta = e.deltaY * unit;
    if (!Number.isFinite(delta) || !delta || Math.abs(delta) < Math.abs(e.deltaX * unit)) return;
    const now = performance.now();
    const direction = Math.sign(delta);
    if (now - wheelSession.time >= CONFIG.GESTURE.WHEEL_IDLE_MS || direction !== wheelSession.direction) {
        wheelSession.restartWindow(now);
        wheelSession.consumed = false;
        wheelSession.navCoastingToTop = false;
    }
    wheelSession.time = now;
    wheelSession.direction = direction;

    if (isExcluded(e.target) || !OverlayStack.isEmpty() || isScreenTransitioning()) {
        wheelSession.consume();
        return;
    }
    if (wheelSession.consumed) return;
    if (state.currentSection === 'start' && direction > 0 && canScrollStartDown()) {
        wheelSession.consume();
        return;
    }
    // 一轮手势中只要还在滚内容，就不能在到顶后被余下事件带回首屏。
    if (state.currentSection === 'nav') {
        if (!isNavAtTop() || !wheelSession.navWasAtTop || wheelSession.navCoastingToTop) {
            wheelSession.restartWindow(now);
            return;
        }
    }
    if (now - wheelSession.windowStart >= CONFIG.GESTURE.WHEEL_IDLE_MS) {
        wheelSession.restartWindow(now);
    }
    wheelSession.distance += delta;
    const entering = state.currentSection === 'start' && wheelSession.distance >= CONFIG.GESTURE.SWIPE_THRESHOLD;
    const leaving = state.currentSection === 'nav' && wheelSession.distance <= -CONFIG.GESTURE.SWIPE_THRESHOLD;
    if (!entering && !leaving) return;
    wheelSession.consume();
    if (entering) switchToNav();
    else switchToStart();
}

/** @param {TouchEvent} e */
function handleTouchStart(e) {
    clearTouchGesture();
    if (isScreenTransitioning() || !OverlayStack.isEmpty() || isExcluded(e.target) || e.touches.length !== 1) return;
    if (state.currentSection === 'nav' && !isNavAtTop()) return;
    if (state.currentSection === 'start' && canScrollStartDown()) return;
    const point = e.touches[0];
    touch = { id: point.identifier, x: point.clientX, y: point.clientY, time: performance.now(), canReturn: isNavAtTop() };
}

/**
 * 位移沿用原阈值；轻扫沿用原平均速度规则。
 * 是否允许返回在手指落下时确定，滑动中滚到顶部不会改成切屏。
 * @param {TouchEvent} e
 * @param {boolean} ending
 * @param {boolean} [cancelScroll]
 */
function handleTouch(e, ending, cancelScroll = false) {
    const gesture = touch;
    if (!gesture) return;
    if (isScreenTransitioning() || !OverlayStack.isEmpty() || (!ending && e.touches.length !== 1)) {
        clearTouchGesture();
        return;
    }
    if (state.currentSection === 'nav' && !isNavAtTop()) {
        clearTouchGesture();
        return;
    }
    const points = ending ? e.changedTouches : e.touches;
    const point = Array.from(points).find(item => item.identifier === gesture.id);
    if (!point) return;
    const dy = gesture.y - point.clientY;
    const dx = gesture.x - point.clientX;
    if (ending) clearTouchGesture();
    if (Math.abs(dx) > Math.abs(dy)) return;
    const distance = Math.abs(dy);
    const flick = ending && distance >= CONFIG.GESTURE.FLICK_MIN_DISTANCE
        && distance / Math.max(1, performance.now() - gesture.time) > CONFIG.GESTURE.FLICK_MIN_VELOCITY;
    if (distance < CONFIG.GESTURE.SWIPE_THRESHOLD && !flick) return;
    const entering = state.currentSection === 'start' && dy > 0;
    const leaving = state.currentSection === 'nav' && dy < 0 && gesture.canReturn && isNavAtTop();
    if (!entering && !leaving) return;
    clearTouchGesture();
    if (!ending && cancelScroll && e.cancelable) e.preventDefault();
    if (entering) switchToNav();
    else switchToStart();
}

export function initScreenGestures() {
    resetScreenInput();
    dom.navContent?.addEventListener('scroll', recordNavScroll, { passive: true });
    // 平时仅观察意图，允许浏览器独立滚动；切屏期的临时阻止由屏幕模块管理。
    document.addEventListener('wheel', handleWheel, { passive: true });
    document.addEventListener('pointerdown', resetScreenInput, { passive: true });
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    // 首屏滚到底、导航页滚到顶后，下一次触摸才允许切屏。
    dom.startSection?.addEventListener('touchmove', handleActiveTouchMove, { passive: false });
    document.addEventListener('touchmove', e => handleTouch(e, false), { passive: true });
    document.addEventListener('touchend', e => handleTouch(e, true), { passive: true });
    document.addEventListener('touchcancel', clearTouchGesture, { passive: true });
    window.addEventListener('blur', resetScreenInput, { passive: true });
    window.addEventListener('pagehide', resetScreenInput, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) resetScreenInput(); }, { passive: true });
}
