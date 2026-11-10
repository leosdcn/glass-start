/**
 * 管理浮层的关闭顺序和滚动锁。原生 dialog 负责模态隔离和键盘焦点。
 */

export const MODAL_OVERLAY_IDS = new Set([
    'editModal',
    'shortcutModal',
    'creditsModal',
    'confirmModal',
    'bookmarkPicker',
    'languageModal'
]);

/** @type {WeakSet<HTMLDialogElement>} */
const boundDialogs = new WeakSet();

/** @param {string} id */
function showModal(id) {
    const modal = document.getElementById(id);
    if (!(modal instanceof HTMLDialogElement)) return;
    if (!boundDialogs.has(modal)) {
        modal.addEventListener('cancel', e => {
            e.preventDefault();
            const top = OverlayStack.top();
            if (top?.id === id) top.close();
        });
        let isPointerDownOnBackdrop = false;
        modal.addEventListener('pointerdown', e => {
            isPointerDownOnBackdrop = e.target === modal;
        });
        modal.addEventListener('click', e => {
            const top = OverlayStack.top();
            if (e.target === modal && isPointerDownOnBackdrop && top?.id === id) top.close();
            isPointerDownOnBackdrop = false;
        });
        boundDialogs.add(modal);
    }
    modal.inert = false;
    modal.showModal();
}

/**
 * @param {Element | null | undefined} element
 * @returns {element is HTMLElement}
 */
function visibleFocusTarget(element) {
    return element instanceof HTMLElement && element.isConnected &&
        element !== document.body && element !== document.documentElement &&
        !element.closest('[inert], [hidden], [aria-hidden="true"], :disabled') &&
        element.checkVisibility({ visibilityProperty: true });
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** @param {Element | null | undefined} trigger */
function restoreFocus(trigger) {
    const modal = OverlayStack.topModal();
    if (visibleFocusTarget(trigger) && (!modal || modal.contains(trigger))) {
        if (document.activeElement !== trigger) trigger.focus({ preventScroll: true });
    } else if (!visibleFocusTarget(document.activeElement) || (modal && !modal.contains(document.activeElement))) {
        const scope = modal || document;
        const preferred = modal?.querySelector('[role="tab"][aria-selected="true"]');
        const target = visibleFocusTarget(preferred) ? preferred : [...scope.querySelectorAll(FOCUSABLE)].find(visibleFocusTarget);
        (target || modal)?.focus({ preventScroll: true });
    }
}

/** @type {import('../types').IOverlayStack} */
export const OverlayStack = {
    stack: [],

    push(id, closeFn, trigger = document.activeElement) {
        const modal = MODAL_OVERLAY_IDS.has(id);
        if (!modal && this.topModal()) return false;
        if (modal) {
            for (const item of this.stack.slice().reverse()) {
                if (!MODAL_OVERLAY_IDS.has(item.id)) item.close();
            }
        }
        this.pop(id);
        this.stack.push({ id, close: closeFn, trigger });
        if (modal) {
            showModal(id);
            document.body.classList.add('overflow-hidden', 'touch-none');
        }
        return true;
    },

    pop(id) {
        const idx = id ? this.stack.findIndex(item => item.id === id) : this.stack.length - 1;
        if (idx < 0) return null;
        const [removed] = this.stack.splice(idx, 1);
        if (MODAL_OVERLAY_IDS.has(removed.id)) {
            const modal = document.getElementById(removed.id);
            if (modal instanceof HTMLDialogElement) {
                // 先释放原生模态，CSS 可以继续绘制退场画面。
                modal.close();
                modal.inert = true;
            }
            if (!this.topModal()) document.body.classList.remove('overflow-hidden', 'touch-none');
            restoreFocus(removed.trigger);
        }
        return removed;
    },

    topModal() {
        const entry = [...this.stack].reverse().find(item => MODAL_OVERLAY_IDS.has(item.id));
        return entry ? document.getElementById(entry.id) : null;
    },

    top() {
        return this.stack[this.stack.length - 1] || null;
    },

    isEmpty() {
        return this.stack.length === 0;
    }
};
