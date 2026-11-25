/** 快捷键速查与开源致谢静态弹窗渲染与生命周期。 */
import { t } from '../core/i18n.js';
import { CONFIG, IS_MAC } from '../config/constants.js';
import { escapeHtml, safeUrl } from '../utils/helpers.js';
import { getCategoryIconHTML } from '../utils/favicon.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';
import { hideSuggestions } from './search-suggestions.js';

/** @type {Record<string, string>} */
const KBD = {
    'kbd-any': `<kbd class="kbd-badge">${escapeHtml(t('ui.any.character.key'))}</kbd>`,
    'kbd-slash': IS_MAC ? '<kbd>⌘</kbd><kbd>/</kbd>' : '<kbd>Ctrl</kbd><kbd>/</kbd>',
    'kbd-bg': IS_MAC ? '<kbd>⌘</kbd><kbd>B</kbd>' : '<kbd>Ctrl</kbd><kbd>B</kbd>',
    'kbd-newtab': IS_MAC ? '<kbd>⌘</kbd><kbd>↵</kbd>' : '<kbd>Alt</kbd><kbd>↵</kbd>',
    'kbd-tab': IS_MAC ? '<kbd>Tab</kbd><span class="text-white/35 text-2xs select-none">/</span><kbd>⇧ Tab</kbd>' : '<kbd>Tab</kbd><span class="text-white/35 text-2xs select-none">/</span><kbd>Shift+Tab</kbd>'
};

function renderShortcutModalList() {
    const container = dom.shortcutModalList;
    if (!container || container.hasChildNodes()) return;
    container.innerHTML = CONFIG.SHORTCUTS.map(sec => `
        <div class="flex flex-col">
            <h4 class="text-xs font-semibold text-white/80 mb-2 px-1 flex items-center select-none">${escapeHtml(sec.group)}</h4>
            <div class="flex-1 flex flex-col justify-between">
                ${sec.items.map(item => `
                    <div class="shortcut-row">
                        <span class="text-white/85 text-xs select-none">${escapeHtml(item.desc)}</span>
                        <span class="keycap shrink-0">${item.kbdId ? (KBD[item.kbdId] || `<kbd>${escapeHtml(item.fallback || '')}</kbd>`) : (item.rawHtml || '')}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
}

function renderCreditsModalList() {
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

/** @param {Element | null} [trigger] */
export function openShortcutModal(trigger = document.activeElement) {
    const modal = dom.shortcutModal;
    if (!modal) return;
    renderShortcutModalList();
    hideSuggestions();
    OverlayStack.push('shortcutModal', closeShortcutModal, trigger);
}

export function closeShortcutModal() {
    const modal = dom.shortcutModal;
    if (!modal) return;
    OverlayStack.pop('shortcutModal');
}

/** @param {Element | null} [trigger] */
export function openCreditsModal(trigger = document.activeElement) {
    const modal = dom.creditsModal;
    if (!modal) return;
    renderCreditsModalList();
    OverlayStack.push('creditsModal', closeCreditsModal, trigger);
}

export function closeCreditsModal() {
    const modal = dom.creditsModal;
    if (!modal) return;
    OverlayStack.pop('creditsModal');
}
