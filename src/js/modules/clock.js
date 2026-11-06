/** 时钟与日期显示、整分钟计时器生命周期。 */
import { formatDate } from '../core/i18n.js';
import { dom } from '../state/dom.js';

/** @type {ReturnType<typeof setTimeout>|null} */
let clockTimerId = null;

export function stopClockTimer() {
    if (clockTimerId) {
        clearTimeout(clockTimerId);
        clockTimerId = null;
    }
}

function scheduleClockTick() {
    stopClockTimer();
    if (typeof document !== 'undefined' && document.hidden) return;
    const now = Date.now();
    // 按下一整分钟加缓冲安排更新，避免读到上一分钟；后台计时器仍可能延迟。
    const delay = Math.max(50, 60000 - (now % 60000) + 50);
    clockTimerId = setTimeout(() => {
        updateClock();
    }, delay);
}

export function updateClock() {
    if (typeof document !== 'undefined' && document.hidden) {
        stopClockTimer();
        return;
    }
    const n = new Date();
    const hh = String(n.getHours()).padStart(2, '0');
    const mm = String(n.getMinutes()).padStart(2, '0');
    const curTimeStr = `${hh}:${mm}`;
    const clockEl = dom.clock;
    const dateEl = dom.date;

    if (clockEl && clockEl.textContent !== curTimeStr) {
        clockEl.innerHTML = `${hh}<span class="clock-colon mx-0.5 sm:mx-1">:</span>${mm}`;
        clockEl.setAttribute('datetime', curTimeStr);
    }
    if (dateEl) {
        const date = formatDate(n);
        if (dateEl.textContent !== date) dateEl.textContent = date;
    }
    scheduleClockTick();
}
