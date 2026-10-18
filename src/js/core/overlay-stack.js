/**
 * 统一 UI 状态与多层弹窗响应栈
 * 管理 LIFO 栈、弹窗可见性、焦点和滚动锁；Escape 事件由 events.js 分发。
 */

import { CONFIG } from '../config/constants.js';

export const MODAL_OVERLAY_IDS = new Set([
    'editModal',
    'shortcutModal',
    'creditsModal',
    'confirmModal',
    'bookmarkPicker'
]);

// 只有层叠栈拥有弹窗可见性；每次切换取消上一轮动画和延迟隐藏。
/** @type {Map<string, { frame: number; timer: ReturnType<typeof setTimeout> | number }>} */
const visibilityOperations = new Map();
/** @param {string} id */
function beginVisibilityOperation(id) {
    const previous = visibilityOperations.get(id);
    if (previous) {
        cancelAnimationFrame(previous.frame);
        clearTimeout(previous.timer);
    }
    const operation = { frame: 0, timer: 0 };
    visibilityOperations.set(id, operation);
    return operation;
}

/** @param {string} id */
function showModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    const operation = beginVisibilityOperation(id);
    modal.removeAttribute('hidden');
    modal.removeAttribute('aria-hidden');
    operation.frame = requestAnimationFrame(() => {
        if (visibilityOperations.get(id) !== operation || !OverlayStack.stack.some(entry => entry.id === id)) return;
        modal.classList.add('active');
        if (OverlayStack.topModal() === modal) OverlayStack.focusTop();
        visibilityOperations.delete(id);
    });
}

/** @param {string} id */
function hideModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    const operation = beginVisibilityOperation(id);
    if (document.activeElement && modal.contains(document.activeElement) && 'blur' in document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('active');
    const finish = () => {
        if (visibilityOperations.get(id) !== operation || OverlayStack.stack.some(entry => entry.id === id)) return;
        modal.setAttribute('hidden', '');
        visibilityOperations.delete(id);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else operation.timer = setTimeout(finish, CONFIG.TIMERS.MODAL_HIDE_DELAY);
}

// 暂存原始 inert 状态，退栈时恢复，保留屏幕切换和既有禁用区域的状态。
/** @type {Map<HTMLElement, boolean>} */
const isolatedElements = new Map();
/**
 * @param {Element | null | undefined} element
 * @returns {element is HTMLElement}
 */
function visibleFocusTarget(element) {
    return !!(element && element instanceof HTMLElement && element.isConnected && element !== document.body && element !== document.documentElement &&
        typeof element.focus === 'function' &&
        !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
        (element.offsetWidth > 0 || element.offsetHeight > 0) &&
        getComputedStyle(element).visibility === 'visible');
}

/** @type {import('../types').IOverlayStack} */
export const OverlayStack = {
    stack: [],

    push(id, closeFn, trigger = document.activeElement) {
        this.pop(id);
        this.stack.push({ id, close: closeFn, trigger });
        if (MODAL_OVERLAY_IDS.has(id)) showModal(id);
        this.syncModalAccessibility();
        if (MODAL_OVERLAY_IDS.has(id)) {
            document.body.classList.add('overflow-hidden', 'touch-none');
        }
    },

    pop(id) {
        let removed = null;
        if (id) {
            const idx = this.stack.findIndex(item => item.id === id);
            if (idx !== -1) {
                removed = this.stack.splice(idx, 1)[0];
            }
        } else {
            removed = this.stack.pop() || null;
        }
        if (removed && MODAL_OVERLAY_IDS.has(removed.id)) hideModal(removed.id);
        const hasOpenModal = this.stack.some(item => MODAL_OVERLAY_IDS.has(item.id));
        if (!hasOpenModal) {
            document.body.classList.remove('overflow-hidden', 'touch-none');
        }
        this.syncModalAccessibility();
        if (removed && MODAL_OVERLAY_IDS.has(removed.id)) {
            requestAnimationFrame(() => this.restoreFocus(removed.trigger));
        }
        return removed;
    },

    topModal() {
        const entry = [...this.stack].reverse().find(item => MODAL_OVERLAY_IDS.has(item.id));
        return entry ? document.getElementById(entry.id) : null;
    },

    setBaseInert(element, value) {
        if (isolatedElements.has(element)) isolatedElements.set(element, value);
        else element.inert = value;
    },

    syncModalAccessibility() {
        for (const [element, previous] of isolatedElements) element.inert = previous;
        isolatedElements.clear();
        let active = this.topModal();
        // 沿当前弹窗到 body 的路径隔离兄弟区域，绝不隔离包含弹窗的祖先。
        while (active && active !== document.body) {
            const parent = active.parentElement;
            if (!parent) break;
            for (const sibling of parent.children) {
                if (sibling === active || ['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName) || !(sibling instanceof HTMLElement)) continue;
                isolatedElements.set(sibling, sibling.inert);
                sibling.inert = true;
            }
            active = parent;
        }
    },

    focusTop() {
        const modal = this.topModal();
        if (!modal || modal.hasAttribute('hidden')) return;
        const targets = [...modal.querySelectorAll('[autofocus], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
        const target = targets.find(visibleFocusTarget);
        if (target) target.focus({ preventScroll: true });
        else {
            modal.setAttribute('tabindex', '-1');
            modal.focus({ preventScroll: true });
        }
    },

    restoreFocus(trigger) {
        const modal = this.topModal();
        if (visibleFocusTarget(trigger) && (!modal || (trigger && modal.contains(trigger)))) {
            trigger.focus({ preventScroll: true });
        } else if (modal) {
            if (!modal.contains(document.activeElement)) this.focusTop();
        } else if (!visibleFocusTarget(document.activeElement)) {
            const fallback = [...document.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]')].find(visibleFocusTarget);
            fallback?.focus({ preventScroll: true });
        }
    },

    top() {
        return this.stack[this.stack.length - 1] || null;
    },

    isEmpty() {
        return this.stack.length === 0;
    }
};
