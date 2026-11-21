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

const POINTER_FOCUS = 'data-pointer-modal-focus';
let lastInputWasPointer = false;
if (typeof window !== 'undefined') {
    const enableFocusRing = () => {
        lastInputWasPointer = false;
        document.activeElement?.removeAttribute(POINTER_FOCUS);
    };
    window.addEventListener('pointerdown', () => { lastInputWasPointer = true; }, true);
    window.addEventListener('keydown', enableFocusRing, true);
    window.addEventListener('click', e => {
        if (!e.isTrusted) return;
        if (e.detail > 0) lastInputWasPointer = true;
        else enableFocusRing();
    }, true);
    window.addEventListener('focusout', e => {
        if (e.target instanceof Element) e.target.removeAttribute(POINTER_FOCUS);
    }, true);
}

function hidePointerFocusRing() {
    // 输入控件保留浏览器的焦点提示。
    const target = document.activeElement;
    if (lastInputWasPointer && target instanceof HTMLElement &&
        !target.matches('body, html, input, select, textarea, :read-write')) {
        target.setAttribute(POINTER_FOCUS, '');
    }
}

/** @param {HTMLDialogElement} modal */
function showModal(modal) {
    const { id } = modal;
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
        modal.addEventListener('pointercancel', () => {
            isPointerDownOnBackdrop = false;
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
    hidePointerFocusRing();
}

/** @param {Element | null | undefined} trigger @param {string} panelId @param {boolean} expanded */
function setExpanded(trigger, panelId, expanded) {
    if (trigger?.getAttribute('aria-controls')?.split(/\s+/).includes(panelId)) {
        trigger.setAttribute('aria-expanded', String(expanded));
    }
}

/**
 * @param {Element | null | undefined} element
 * @returns {element is HTMLElement}
 */
function visibleFocusTarget(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected ||
        element === document.body || element === document.documentElement ||
        element.closest('[inert], [hidden], [aria-hidden="true"], :disabled')) {
        return false;
    }
    if (typeof element.checkVisibility === 'function') {
        return element.checkVisibility({ visibilityProperty: true });
    }
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
        (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0);
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** @param {Element | null | undefined} trigger @param {HTMLElement | null} modal */
function restoreFocus(trigger, modal) {
    if ((!modal || modal.contains(trigger ?? null)) && visibleFocusTarget(trigger)) {
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

    push(id, closeFn, trigger = document.activeElement, panel) {
        const isModal = MODAL_OVERLAY_IDS.has(id);
        const modal = isModal ? document.getElementById(id) : null;
        if (isModal ? !(modal instanceof HTMLDialogElement) : this.topModal()) return false;
        if (modal) {
            for (const item of this.stack.slice().reverse()) {
                if (!MODAL_OVERLAY_IDS.has(item.id)) item.close();
            }
        }
        this.pop(id);
        this.stack.push({ id, close: closeFn, trigger, panel });
        if (modal instanceof HTMLDialogElement) {
            showModal(modal);
            document.body.classList.add('overflow-hidden', 'touch-none');
        } else if (panel) {
            panel.inert = false;
            panel.classList.add('active');
            panel.setAttribute('aria-hidden', 'false');
        }
        setExpanded(trigger, panel?.id ?? id, true);
        return true;
    },

    pop(id) {
        const idx = id ? this.stack.findIndex(item => item.id === id) : this.stack.length - 1;
        if (idx < 0) return null;
        const [removed] = this.stack.splice(idx, 1);
        setExpanded(removed.trigger, removed.panel?.id ?? removed.id, false);
        if (MODAL_OVERLAY_IDS.has(removed.id)) {
            const previousFocus = document.activeElement;
            const modal = document.getElementById(removed.id);
            if (modal instanceof HTMLDialogElement) {
                // 先释放原生模态，CSS 可以继续绘制退场画面。
                modal.close();
                modal.inert = true;
            }
            const remainingModal = this.topModal();
            if (!remainingModal) document.body.classList.remove('overflow-hidden', 'touch-none');
            restoreFocus(removed.trigger, remainingModal);
            if (document.activeElement !== previousFocus) hidePointerFocusRing();
        } else if (removed.panel) {
            const { panel, trigger } = removed;
            const containedFocus = panel.contains(document.activeElement);
            panel.inert = true;
            panel.classList.remove('active');
            if (containedFocus && visibleFocusTarget(trigger)) trigger.focus({ preventScroll: true });
            panel.setAttribute('aria-hidden', 'true');
        }
        return removed;
    },

    closeOutsidePanels(target) {
        if (!this.stack.length) return;
        for (const { panel, trigger, close } of this.stack.slice().reverse()) {
            if (panel && !panel.contains(target) && !trigger?.contains(target)) close();
        }
    },

    topModal() {
        for (let i = this.stack.length - 1; i >= 0; i--) {
            const { id } = this.stack[i];
            if (MODAL_OVERLAY_IDS.has(id)) return document.getElementById(id);
        }
        return null;
    },

    top() {
        return this.stack[this.stack.length - 1] || null;
    },

    has(id) {
        return this.stack.some(entry => entry.id === id);
    },

    isEmpty() {
        return this.stack.length === 0;
    }
};
