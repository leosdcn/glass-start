import { t } from './i18n.js';
import { CONFIG } from '../config/constants.js';
import { dom } from '../state/dom.js';
import { state } from '../state/store.js';
import { OverlayStack } from './overlay-stack.js';
import { showConfirm } from './dialogs.js';

/** @type {ServiceWorkerRegistration | null} */
let registration = null;
let initialized = false;
let checking = false;
let lastCheckAt = 0;
/** @type {{ worker: ServiceWorker, search: string, timer: ReturnType<typeof setTimeout> } | null} */
let activation = null;

function showUpdateNotice(message = t('ui.update.available')) {
    if (activation) return;
    if (dom.updateNoticeText) dom.updateNoticeText.textContent = message;
    dom.updateNotice?.classList.remove('hidden');
}

function finishActivation() {
    const finished = activation;
    if (!finished) return null;
    clearTimeout(finished.timer);
    activation = null;
    if (dom.updateReloadBtn) {
        dom.updateReloadBtn.disabled = false;
    }
    return finished;
}

function canReloadPage() {
    return !state.editOpen && OverlayStack.isEmpty();
}

function currentSearch() {
    return dom.searchInput?.value ?? '';
}

/** @param {string} confirmedSearch */
function reloadIfSafe(confirmedSearch) {
    if (canReloadPage() && currentSearch() === confirmedSearch) {
        location.reload();
    } else {
        showUpdateNotice();
    }
}

/** @param {ServiceWorker} worker @param {string} search */
function applyUpdate(worker, search) {
    if (activation || !canReloadPage()) return;
    if (worker === navigator.serviceWorker.controller) {
        reloadIfSafe(search);
        return;
    }
    if (worker !== registration?.waiting) return;
    const failed = () => {
        finishActivation();
        showUpdateNotice(t('ui.update.incomplete.please.retry'));
    };
    activation = { worker, search, timer: setTimeout(failed, CONFIG.TIMERS.SW_UPDATE_TIMEOUT) };
    if (dom.updateReloadBtn) {
        dom.updateReloadBtn.disabled = true;
        if (dom.updateNoticeText) dom.updateNoticeText.textContent = t('ui.updating');
    }
    try { worker.postMessage({ type: CONFIG.SW_MESSAGES.ACTIVATE_UPDATE }); }
    catch { failed(); }
}

/**
 * @param {ServiceWorkerRegistration} reg
 */
function watchRegistration(reg) {
    registration = reg;
    const inspectWaiting = () => {
        if (reg.waiting && navigator.serviceWorker.controller) showUpdateNotice();
    };
    const watchInstalling = () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
            if (worker.state === 'installed') inspectWaiting();
        });
    };
    reg.addEventListener('updatefound', watchInstalling);
    watchInstalling();
    inspectWaiting();
}

// 唤醒与定时检查共用节流；失败不清缓存，联网后可立即重试。
export async function checkServiceWorkerUpdate(force = false) {
    if (!registration || checking || document.hidden) return;
    if (registration.waiting && navigator.serviceWorker.controller) showUpdateNotice();
    if (!force && Date.now() - lastCheckAt < CONFIG.TIMERS.SW_UPDATE_CHECK_INTERVAL) return;
    checking = true;
    lastCheckAt = Date.now();
    try { await registration.update(); } catch {}
    finally { checking = false; }
}

export function initServiceWorkerUpdates() {
    if (initialized || !('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
    initialized = true;
    const initialController = navigator.serviceWorker.controller;
    let previousController = initialController;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        const controller = navigator.serviceWorker.controller;
        if (!controller || controller === previousController) return;
        const hadController = !!previousController;
        previousController = controller;
        const finished = finishActivation();
        if (finished?.worker === controller) {
            reloadIfSafe(finished.search);
        } else if (hadController || finished) {
            showUpdateNotice();
        }
    });
    dom.updateReloadBtn?.addEventListener('click', () => {
        // 弹窗开启时不打断草稿；背景按钮同时受 OverlayStack 的 inert 保护。
        if (activation || !canReloadPage()) return;
        const controller = navigator.serviceWorker.controller;
        const target = registration?.waiting ?? (controller !== initialController ? controller : null);
        if (!target) return;
        const search = currentSearch();
        const message = t('ui.reload.to.use.the.new.version') +
            (search ? t('ui.your.current.search.will.be.cleared') : '');
        showConfirm(message, () => applyUpdate(target, search), t('ui.new.version.ready'), {
            triggerEl: dom.updateReloadBtn, okText: t('ui.update.now'), tone: 'neutral', cancelText: t('ui.later')
        });
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
        watchRegistration(reg);
        checkServiceWorkerUpdate(true);
    }).catch(() => {});
    window.addEventListener('online', () => checkServiceWorkerUpdate(true));
    setInterval(checkServiceWorkerUpdate, CONFIG.TIMERS.SW_UPDATE_CHECK_INTERVAL);
}
