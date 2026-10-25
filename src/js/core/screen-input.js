/** 双屏输入仲裁；原生内容滚动与切屏意图分开处理。 */
import { CONFIG } from '../config/constants.js';
import { dom } from '../state/dom.js';
import { state } from '../state/store.js';
import { OverlayStack } from './overlay-stack.js';
import { isScreenTransitioning, switchToNav, switchToStart } from './screen-state.js';

const EXCLUDED_TARGETS = '#sidebar, #weatherWidget, #editBookmarksBtn, input, textarea, select, [contenteditable]:not([contenteditable="false"])';
let wheelTime = -Infinity;
let wheelWindowStart = 0;
let wheelDirection = 0;
let wheelDistance = 0;
let wheelConsumed = false;
// 被动 wheel 可能晚于合成线程的滚动提交；保留上次 scroll 观察到的位置。
let navWasAtTop = true;
let navTopArrivalTime = -Infinity;
let navCoastingToTop = false;
let lastWheelDelta = 0;
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
    wheelTime = -Infinity;
    wheelDirection = 0;
    wheelDistance = 0;
    wheelConsumed = false;
    navWasAtTop = isNavAtTop();
    navTopArrivalTime = -Infinity;
    navCoastingToTop = false;
    lastWheelDelta = 0;
    clearTouchGesture();
    syncNavTouchMove();
}

/** @param {EventTarget|null} target */
function isExcluded(target) {
    return target instanceof Element && !!target.closest(EXCLUDED_TARGETS);
}

function isNavAtTop() {
    return !dom.navContent || dom.navContent.scrollTop <= 0;
}

/** @param {Event} e */
function recordNavScroll(e) {
    const atTop = isNavAtTop();
    syncNavTouchMove();
    if (!atTop && state.currentSection === 'nav') {
        clearTouchGesture();
        navCoastingToTop = false;
    }
    if (atTop && !navWasAtTop) {
        navTopArrivalTime = e.timeStamp;
        navCoastingToTop = true;
        lastWheelDelta = 0;
    }
    navWasAtTop = atTop;
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
    if (now - wheelTime >= CONFIG.GESTURE.WHEEL_IDLE_MS || direction !== wheelDirection) {
        wheelDistance = 0;
        wheelConsumed = false;
        wheelWindowStart = now;
        navCoastingToTop = false;
        lastWheelDelta = 0;
    }
    wheelTime = now;
    wheelDirection = direction;

    if (isExcluded(e.target) || !OverlayStack.isEmpty()) {
        wheelConsumed = true;
        return;
    }
    if (isScreenTransitioning()) {
        wheelConsumed = true;
        return;
    }
    if (wheelConsumed) return;
    // 一轮手势中只要还在滚内容，就不能在到顶后被余下事件带回首屏。
    if (state.currentSection === 'nav') {
        if (!isNavAtTop() || !navWasAtTop) {
            wheelDistance = 0;
            wheelWindowStart = now;
            lastWheelDelta = delta;
            return;
        }
        if (navCoastingToTop) {
            // 惯性衰减阶段：只要位移持续衰减，就属于滚到顶的同轮余量，不触发切屏；
            // 出现明显加速（新的物理划动）或静默超时后才视为新一轮切屏手势。
            const mag = Math.abs(delta);
            const lastMag = Math.abs(lastWheelDelta);
            const isNewFlick = (e.timeStamp - navTopArrivalTime > 60)
                && (mag >= lastMag + 8 && mag >= 12);
            if (isNewFlick) {
                navCoastingToTop = false;
                wheelDistance = 0;
                wheelWindowStart = now;
            } else {
                lastWheelDelta = delta;
                wheelDistance = 0;
                wheelWindowStart = now;
                return;
            }
        }
    }
    lastWheelDelta = delta;
    if (now - wheelWindowStart >= CONFIG.GESTURE.WHEEL_IDLE_MS) {
        wheelDistance = 0;
        wheelWindowStart = now;
    }
    wheelDistance += delta;
    const entering = state.currentSection === 'start' && wheelDistance >= CONFIG.GESTURE.SWIPE_THRESHOLD;
    const leaving = state.currentSection === 'nav' && wheelDistance <= -CONFIG.GESTURE.SWIPE_THRESHOLD;
    if (!entering && !leaving) return;
    wheelConsumed = true;
    if (entering) switchToNav();
    else switchToStart();
}

/** @param {TouchEvent} e */
function handleTouchStart(e) {
    clearTouchGesture();
    if (isScreenTransitioning() || !OverlayStack.isEmpty() || isExcluded(e.target) || e.touches.length !== 1) return;
    if (state.currentSection === 'nav' && !isNavAtTop()) return;
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
    // 首屏没有原生内容滚动；导航列表仅在顶部准备下滑返回，中间滚动不拦截。
    dom.startSection?.addEventListener('touchmove', handleActiveTouchMove, { passive: false });
    document.addEventListener('touchmove', e => handleTouch(e, false), { passive: true });
    document.addEventListener('touchend', e => handleTouch(e, true), { passive: true });
    document.addEventListener('touchcancel', clearTouchGesture, { passive: true });
    window.addEventListener('blur', resetScreenInput, { passive: true });
    window.addEventListener('pagehide', resetScreenInput, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) resetScreenInput(); }, { passive: true });
}
