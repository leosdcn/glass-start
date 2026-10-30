import { t, formatDate } from '../core/i18n.js';
/** 按分钟更新时间与日期，渲染平台快捷键提示和鸣谢列表。 */
import { CONFIG, IS_MAC } from '../config/constants.js';
import { escapeHtml, safeUrl } from '../utils/helpers.js';
import { dom } from '../state/dom.js';
import { getCategoryIconHTML } from './bookmarks.js';

/** @type {Record<string, string>} */
const KBD = {
    'kbd-any': `<kbd class="kbd-text">${escapeHtml(t('ui.any.character.key'))}</kbd>`,
    'kbd-slash': IS_MAC ? '<kbd>⌘</kbd><kbd>/</kbd>' : '<kbd>Ctrl</kbd><kbd>/</kbd>',
    'kbd-bg': IS_MAC ? '<kbd>⌘</kbd><kbd>B</kbd>' : '<kbd>Ctrl</kbd><kbd>B</kbd>',
    'kbd-newtab': IS_MAC ? '<kbd>⌘</kbd><kbd>↵</kbd>' : '<kbd>Alt</kbd><kbd>↵</kbd>',
    'kbd-tab': IS_MAC ? '<kbd>Tab</kbd><span class="text-white/35 text-2xs select-none">/</span><kbd>⇧ Tab</kbd>' : '<kbd>Tab</kbd><span class="text-white/35 text-2xs select-none">/</span><kbd>Shift+Tab</kbd>'
};

export function renderShortcutModalList() {
    const container = dom.shortcutModalList;
    if (!container || container.hasChildNodes()) return;
    container.innerHTML = CONFIG.SHORTCUTS.map(sec => `
        <div>
            <h4 class="text-2xs font-semibold uppercase tracking-wider text-white/45 mb-1.5 px-1">${escapeHtml(sec.group)}</h4>
            <div class="inset-card">
                ${sec.items.map(item => `
                    <div class="inset-card-row">
                        <span class="text-white/85 text-xs">${escapeHtml(item.desc)}</span>
                        <span class="keycap shrink-0">${item.kbdId ? (KBD[item.kbdId] || `<kbd>${escapeHtml(item.fallback || '')}</kbd>`) : (item.rawHtml || '')}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

export function renderCreditsModalList() {
    const container = dom.creditsList;
    if (!container || container.hasChildNodes()) return;
    container.innerHTML = CONFIG.CREDITS.map(item => `
        <div class="py-3 first:pt-1 last:pb-1 flex items-center justify-between gap-3">
            <div class="flex items-center gap-2.5 min-w-0">
                <span class="size-5 shrink-0 select-none flex items-center justify-center">${getCategoryIconHTML(item.icon, 'size-4.5')}</span>
                <div class="truncate">
                    <div class="font-medium text-white/90 truncate">${escapeHtml(item.name)}</div>
                    <div class="text-2xs text-white/55 truncate mt-0.5">${escapeHtml(item.desc)}</div>
                </div>
            </div>
            <a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer" class="shrink-0 text-2xs px-2.5 py-1 rounded-md bg-white/8 hover:bg-white/15 border border-white/12 hover:border-white/20 text-white/80 hover:text-white glass-interactive flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50" title="${escapeHtml(t('credits.license', { name: item.name }))}">
                ${escapeHtml(item.license)}
                <svg class="size-2.5 opacity-70" aria-hidden="true"><use href="#icon-external"/></svg>
            </a>
        </div>
    `).join('');
}

export let lastDateDay = -1;
export let lastTimeStr = '';
/**
 * @param {string} val
 */
export function setLastTimeStr(val) {
    lastTimeStr = val;
}

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


    if (curTimeStr !== lastTimeStr) {
        lastTimeStr = curTimeStr;
        if (clockEl) {
            clockEl.innerHTML = `${hh}<span class="clock-colon mx-0.5 sm:mx-1">:</span>${mm}`;
            clockEl.setAttribute('datetime', curTimeStr);
        }
    }
    const day = n.getDate();
    if (day !== lastDateDay) {
        lastDateDay = day;
        if (dateEl) {
            dateEl.textContent = formatDate(n);
        }
    }
    scheduleClockTick();
}

/**
 * @param {number} value
 */
export function setLastDateDay(value) { lastDateDay = value; }
