import { dom } from '../state/dom.js';
import { OverlayStack } from './overlay-stack.js';

/** @type {(() => void) | null} */
let activeConfirmCleanup = null;

/**
 * @param {string} message
 * @param {(() => void) | null | undefined} [onConfirm]
 * @param {string} [title]
 * @param {Element | null} [triggerEl]
 * @param {string} [okText]
 * @param {'danger' | 'neutral' | string} [tone]
 * @param {string} [cancelText]
 */
export function showConfirm(message, onConfirm, title = '重置确认', triggerEl = null, okText = '', tone = 'danger', cancelText = '取消') {
    const modal = dom.confirmModal;
    const titleEl = dom.confirmTitle;
    const msgEl = dom.confirmMsg;
    const okBtn = dom.confirmOkBtn;
    const cancelBtn = dom.confirmCancelBtn;

    if (!modal || !okBtn || !cancelBtn || !msgEl) {
        if (typeof window !== 'undefined' && window.confirm(message)) onConfirm?.();
        return;
    }

    if (activeConfirmCleanup) {
        activeConfirmCleanup();
        activeConfirmCleanup = null;
    }

    const currentModal = modal;
    const currentOkBtn = okBtn;
    const currentCancelBtn = cancelBtn;

    const isNotify = onConfirm == null;
    currentModal.classList.toggle('confirm-neutral', tone === 'neutral');
    currentModal.setAttribute('role', tone === 'neutral' ? 'dialog' : 'alertdialog');
    currentOkBtn.textContent = isNotify ? '知道了' : (okText || '确认');
    currentCancelBtn.textContent = cancelText;
    currentCancelBtn.classList.toggle('hidden', isNotify);

    if (titleEl) titleEl.textContent = title;
    msgEl.textContent = message;
    /** @type {HTMLElement | null} */
    let confirmTriggerEl = /** @type {HTMLElement | null} */ (triggerEl || document.activeElement || dom.resetEditBtn);
    OverlayStack.push('confirmModal', cleanup, confirmTriggerEl);
    if (confirmTriggerEl && typeof confirmTriggerEl.setAttribute === 'function') {
        confirmTriggerEl.setAttribute('aria-expanded', 'true');
    }

    function cleanup() {
        activeConfirmCleanup = null;
        OverlayStack.pop('confirmModal');
        currentCancelBtn.classList.remove('hidden');
        currentOkBtn.removeEventListener('click', handleOk);
        currentCancelBtn.removeEventListener('click', handleCancel);
        currentModal.removeEventListener('click', handleBackdropClick);
        if (confirmTriggerEl && typeof confirmTriggerEl.focus === 'function') {
            const opener = confirmTriggerEl;
            confirmTriggerEl = null;
            opener.setAttribute('aria-expanded', 'false');
        }
    }

    function handleOk() { cleanup(); onConfirm?.(); }
    function handleCancel() { cleanup(); }
    /** @param {MouseEvent} e */
    function handleBackdropClick(e) {
        if (e.target === currentModal) cleanup();
    }

    currentOkBtn.addEventListener('click', handleOk);
    if (!isNotify) currentCancelBtn.addEventListener('click', handleCancel);
    currentModal.addEventListener('click', handleBackdropClick);
    activeConfirmCleanup = cleanup;
}
