/**
 * ==============================================================================
 * Glass Start — 时钟引擎、快捷键与鸣谢列表 (src/js/modules/clock.js)
 * ==============================================================================
 *
 * 核心功能：
 * 1. 实时时钟与日期更新 (updateClock)
 * 2. 平台按键映射与提示 (KBD, applyPlatformShortcuts)
 * 3. 快捷键弹窗列表渲染 (renderShortcutModalList)
 * 4. 鸣谢开源数据弹窗列表渲染 (renderCreditsModalList)
 */
import { CONFIG, IS_MAC } from '../config/constants.js';
import { escapeHtml, safeUrl } from '../utils/helpers.js';
import { dom, $ } from '../state/dom.js';

export const KBD = {
    slash: IS_MAC ? '⌘ /' : 'Ctrl + /',
    bg: IS_MAC ? '⌘ B' : 'Ctrl + B',
    newTab: IS_MAC ? '⌘ ↵' : 'Alt + ↵',
    tabTrap: IS_MAC ? 'Tab / ⇧ Tab' : 'Tab / Shift + Tab',
    hintBadge: IS_MAC ? '⌘ /' : 'Ctrl+/'
};

export function applyPlatformShortcuts() {
    const elSlash = $('kbd-slash');
    if (elSlash) elSlash.textContent = KBD.slash;
    const elBg = $('kbd-bg');
    if (elBg) elBg.textContent = KBD.bg;
    const elNewTab = $('kbd-newtab');
    if (elNewTab) elNewTab.textContent = KBD.newTab;
    const elTab = $('kbd-tab');
    if (elTab) elTab.textContent = KBD.tabTrap;
}

export function renderShortcutModalList() {
    const container = dom.shortcutModalList || $('shortcutModalList');
    if (!container) return;
    container.innerHTML = CONFIG.SHORTCUTS.map(sec => `
        <div>
            <h4 class="text-2xs font-semibold uppercase tracking-wider text-white/40 mb-1.5 px-0.5">${escapeHtml(sec.group)}</h4>
            <div class="space-y-1.5">
                ${sec.items.map(item => `
                    <div class="flex items-center justify-between gap-3 px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                        <span class="text-white/85 shrink-0 text-xs">${escapeHtml(item.desc)}</span>
                        <span class="flex items-center gap-1 font-mono text-2xs text-white/90 bg-white/10 px-2.5 py-0.5 rounded-md border border-white/10 shrink-0">${item.kbdId ? `<kbd id="${item.kbdId}">${escapeHtml(item.fallback)}</kbd>` : item.rawHtml}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
    applyPlatformShortcuts();
}

export function renderCreditsModalList() {
    const container = dom.creditsList || $('creditsList');
    if (!container || container.hasChildNodes()) return;
    container.innerHTML = CONFIG.CREDITS.map(item => `
        <div class="p-2.5 rounded-xl bg-white/5 border border-white/8 hover:bg-white/8 hover:border-white/15 transition-colors duration-150 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2.5 min-w-0">
                <span class="text-base shrink-0 select-none">${escapeHtml(item.icon)}</span>
                <div class="truncate">
                    <div class="font-medium text-white/90 truncate">${escapeHtml(item.name)}</div>
                    <div class="text-2xs text-white/50 truncate">${escapeHtml(item.desc)}</div>
                </div>
            </div>
            <a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer" class="shrink-0 text-2xs px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-white/80 hover:text-white transition-colors duration-150 flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50" title="访问 ${escapeHtml(item.name)} 官网">
                <span>${escapeHtml(item.license)}</span>
                <svg class="size-2.5 opacity-70" aria-hidden="true"><use href="#icon-external"/></svg>
            </a>
        </div>
    `).join('');
}

export let lastDateDay = -1;
export let lastTimeStr = '';
export function setLastTimeStr(val) {
    lastTimeStr = val;
}

export function updateClock() {
    if (typeof document !== 'undefined' && document.hidden) return;
    const n = new Date();
    const hh = String(n.getHours()).padStart(2, '0');
    const mm = String(n.getMinutes()).padStart(2, '0');
    const curTimeStr = `${hh}:${mm}`;
    const clockEl = dom.clock || $('clock');
    const dateEl = dom.date || $('date');

    const effectiveLastTimeStr = (typeof window !== 'undefined' && typeof window.lastTimeStr === 'string') ? window.lastTimeStr : lastTimeStr;

    if (curTimeStr !== effectiveLastTimeStr) {
        lastTimeStr = curTimeStr;
        if (typeof window !== 'undefined') window.lastTimeStr = curTimeStr;
        if (clockEl) {
            clockEl.innerHTML = `${hh}<span class="clock-colon mx-0.5 sm:mx-1">:</span>${mm}`;
            clockEl.setAttribute('datetime', curTimeStr);
        }
    }
    const day = n.getDate();
    const effectiveLastDateDay = (typeof window !== 'undefined' && typeof window.lastDateDay === 'number') ? window.lastDateDay : lastDateDay;
    if (day !== effectiveLastDateDay) {
        lastDateDay = day;
        if (typeof window !== 'undefined') window.lastDateDay = day;
        if (dateEl) {
            const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            dateEl.textContent = `${n.getMonth() + 1}月${n.getDate()}日 ${weekdays[n.getDay()]}`;
        }
    }
}
