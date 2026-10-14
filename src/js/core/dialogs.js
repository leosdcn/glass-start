import { dom } from '../state/dom.js';
import { OverlayStack } from './overlay-stack.js';

let activeConfirmCleanup = null;

export function showConfirm(message, onConfirm, title = '重置确认', triggerEl = null, okText = '') {
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

    const isNotify = onConfirm == null;
    okBtn.textContent = isNotify ? '知道了' : (okText || '确认');
    cancelBtn.classList.toggle('hidden', isNotify);

    if (titleEl) titleEl.textContent = title;
    msgEl.textContent = message;
    let confirmTriggerEl = triggerEl || document.activeElement || dom.resetEditBtn;
    OverlayStack.push('confirmModal', cleanup, confirmTriggerEl);
    if (confirmTriggerEl && typeof confirmTriggerEl.setAttribute === 'function') {
        confirmTriggerEl.setAttribute('aria-expanded', 'true');
    }

    function cleanup() {
        activeConfirmCleanup = null;
        OverlayStack.pop('confirmModal');
        cancelBtn.classList.remove('hidden');
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', handleCancel);
        modal.removeEventListener('click', handleBackdropClick);
        if (confirmTriggerEl && typeof confirmTriggerEl.focus === 'function') {
            const opener = confirmTriggerEl;
            confirmTriggerEl = null;
            opener.setAttribute('aria-expanded', 'false');
        }
    }

    function handleOk() { cleanup(); onConfirm?.(); }
    function handleCancel() { cleanup(); }
    function handleBackdropClick(e) {
        if (e.target === modal) cleanup();
    }

    okBtn.addEventListener('click', handleOk);
    if (!isNotify) cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackdropClick);
    activeConfirmCleanup = cleanup;
}
