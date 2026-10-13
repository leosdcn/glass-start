/**
 * ==============================================================================
 * Glass Start — 统一 UI 状态与多层弹窗响应栈 (src/js/core/overlay-stack.js)
 * ==============================================================================
 * 遵循 4 级 z-index 体系与 LIFO 退栈原则，管理全局 Escape 键与 Body 滚动穿透锁定。
 */

export const MODAL_OVERLAY_IDS = new Set([
    'editModal',
    'shortcutModal',
    'creditsModal',
    'confirmModal',
    'bookmarkPicker'
]);

// 暂存原始 inert 状态，退栈时恢复，保留屏幕切换和既有禁用区域的状态。
const isolatedElements = new Map();
function visibleFocusTarget(element) {
    return element?.isConnected && element !== document.body && element !== document.documentElement &&
        typeof element.focus === 'function' &&
        !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
        (element.offsetWidth > 0 || element.offsetHeight > 0) &&
        getComputedStyle(element).visibility === 'visible';
}

export const OverlayStack = {
    stack: [],

    push(id, closeFn, trigger = document.activeElement) {
        this.pop(id);
        this.stack.push({ id, close: closeFn, trigger });
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
                if (sibling === active || ['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) continue;
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
        if (visibleFocusTarget(trigger) && (!modal || modal.contains(trigger))) {
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
