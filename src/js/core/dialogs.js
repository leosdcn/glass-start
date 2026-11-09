import { t } from './i18n.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from './overlay-stack.js';

/** @type {(() => void) | null} */
let activeConfirmCleanup = null;

/**
 * @param {string} message
 * @param {(() => void) | null | undefined} [onConfirm]
 * @param {string} [title]
 * @param {{triggerEl?: Element | null, okText?: string, tone?: string, cancelText?: string, signal?: AbortSignal}} [options]
 */
export function showConfirm(message, onConfirm, title = t('ui.confirm.reset.2'), {
    triggerEl = null, okText = '', tone = 'danger', cancelText = t('ui.cancel'), signal
} = {}) {
    if (signal?.aborted) return;
    const modal = dom.confirmModal;
    const titleEl = dom.confirmTitle;
    const msgEl = dom.confirmMsg;
    const okBtn = dom.confirmOkBtn;
    const cancelBtn = dom.confirmCancelBtn;

    if (!modal || !okBtn || !cancelBtn || !msgEl) {
        if (window.confirm(message)) onConfirm?.();
        return;
    }

    activeConfirmCleanup?.();

    const isNotify = onConfirm == null;
    modal.classList.toggle('confirm-neutral', tone === 'neutral');
    modal.setAttribute('role', tone === 'neutral' ? 'dialog' : 'alertdialog');
    okBtn.textContent = isNotify ? t('ui.got.it') : (okText || t('ui.confirm'));
    cancelBtn.textContent = cancelText;
    cancelBtn.classList.toggle('hidden', isNotify);

    if (titleEl) titleEl.textContent = title;
    msgEl.textContent = message;
    const confirmTriggerEl = triggerEl || document.activeElement || dom.resetEditBtn;
    const cleanup = () => {
        activeConfirmCleanup = null;
        OverlayStack.pop('confirmModal');
        cancelBtn.classList.remove('hidden');
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', cleanup);
        signal?.removeEventListener('abort', cleanup);
        confirmTriggerEl?.setAttribute('aria-expanded', 'false');
    };

    function handleOk() { cleanup(); onConfirm?.(); }

    OverlayStack.push('confirmModal', cleanup, confirmTriggerEl);
    confirmTriggerEl?.setAttribute('aria-expanded', 'true');
    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', cleanup);
    signal?.addEventListener('abort', cleanup, { once: true });
    activeConfirmCleanup = cleanup;
}
