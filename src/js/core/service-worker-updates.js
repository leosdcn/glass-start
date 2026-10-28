import { t } from './i18n.js';
import { CONFIG } from '../config/constants.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from './overlay-stack.js';
import { showConfirm } from './dialogs.js';

/** @type {ServiceWorkerRegistration | null} */
let registration = null;
let initialized = false;
let checking = false;
let lastCheckAt = 0;
let updateAvailable = false;
let reloadRequested = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let reloadTimer = null;

function showUpdateNotice(message = t('ui.update.available')) {
    updateAvailable = true;
    if (dom.updateNoticeText) dom.updateNoticeText.textContent = message;
    dom.updateNotice?.classList.remove('hidden');
}

function resetUpdateAttempt() {
    reloadRequested = false;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = null;
    if (dom.updateReloadBtn) {
        dom.updateReloadBtn.disabled = false;
    }
    showUpdateNotice(t('ui.update.incomplete.please.retry'));
}

function applyUpdate() {
    if (reloadRequested) return;
    const waiting = registration?.waiting;
    if (!waiting) {
        // 另一标签页已激活新版；本页仍由用户确认后才重新载入。
        location.reload();
        return;
    }
    reloadRequested = true;
    if (dom.updateReloadBtn) {
        dom.updateReloadBtn.disabled = true;
        if (dom.updateNoticeText) dom.updateNoticeText.textContent = t('ui.updating');
    }
    reloadTimer = setTimeout(resetUpdateAttempt, CONFIG.TIMERS.SW_UPDATE_TIMEOUT);
    try { waiting.postMessage({ type: 'ACTIVATE_UPDATE' }); }
    catch { resetUpdateAttempt(); }
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
    /** @type {ServiceWorker | null} */
    let previousController = navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        const controller = navigator.serviceWorker.controller;
        if (!controller || controller === previousController) return;
        const hadController = !!previousController;
        previousController = controller;
        if (reloadRequested) {
            if (reloadTimer) clearTimeout(reloadTimer);
            reloadTimer = null;
            location.reload();
        } else if (hadController) {
            showUpdateNotice();
        }
    });
    dom.updateReloadBtn?.addEventListener('click', () => {
        // 弹窗开启时不打断草稿；背景按钮同时受 OverlayStack 的 inert 保护。
        if (!updateAvailable || reloadRequested || !OverlayStack.isEmpty()) return;
        const message = t('ui.reload.to.use.the.new.version') +
            (dom.searchInput?.value ? t('ui.your.current.search.will.be.cleared') : '');
        showConfirm(message, applyUpdate, t('ui.new.version.ready'), dom.updateReloadBtn, t('ui.update.now'), 'neutral', t('ui.later'));
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
        watchRegistration(reg);
        checkServiceWorkerUpdate(true);
    }).catch(() => {});
    window.addEventListener('online', () => checkServiceWorkerUpdate(true));
    setInterval(checkServiceWorkerUpdate, CONFIG.TIMERS.SW_UPDATE_CHECK_INTERVAL);
}
