import { cancelDragSort } from './drag-sort.js';
/** 页面唤醒协调；屏幕模块只负责屏幕状态。 */
import { updateClock, stopClockTimer } from '../modules/clock.js';
import { updateWeather } from '../modules/weather.js';
import { checkServiceWorkerUpdate } from './service-worker-updates.js';
import { resetActiveCard } from './gestures.js';
import { dom } from '../state/dom.js';
import { reconcileScreenState } from './screen-state.js';
import { resetScreenInput, blurNonEditableActive } from './screen-input.js';

/**
 * @param {boolean} [wasPersisted]
 */
export function handleAppWakeUp(wasPersisted = false) {
    updateClock();

    document.querySelectorAll('.is-clicked').forEach(el => el.classList.remove('is-clicked'));
    document.querySelectorAll('.fade-in, .animate-item-in, .category-title-pulse').forEach(el => {
        el.classList.remove('fade-in', 'animate-item-in', 'category-title-pulse');
    });
    cancelDragSort();
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));

    resetActiveCard();
    blurNonEditableActive();
    resetScreenInput();
    reconcileScreenState(undefined, true);

    checkServiceWorkerUpdate();

    if (wasPersisted) {
        const startSec = dom.startSection;
        if (startSec) startSec.style.willChange = 'transform';
    }

    updateWeather(false).catch(() => {});
}

export function initAppWakeEvents() {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopClockTimer();
        else handleAppWakeUp();
    }, { passive: true });
    window.addEventListener('pageshow', e => handleAppWakeUp(e.persisted), { passive: true });
}
