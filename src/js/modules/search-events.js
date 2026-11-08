/** 搜索输入、输入法、候选与引擎菜单的控件事件；跨业务关闭和全局快捷键由 events.js 协调。 */
import { CONFIG } from '../config/constants.js';
import { state } from '../state/store.js';
import { dom } from '../state/dom.js';
import { handleRovingKeyNav } from '../utils/helpers.js';
import { activateSuggestion, selectSuggestion, fetchSuggestions, hideSuggestions, closeDropdown, setEngine, openRandomBookmark, selectedSuggestionIdx, scheduleSuggestions, handleSuggestionKeyNav } from './search.js';

let isComposing = false;
let justEndedComposition = false;
/** @type {ReturnType<typeof setTimeout>|null} */
let compositionEndTimer = null;

/** @param {boolean} hasVal */
function updateSearchActionButtons(hasVal) {
    const { searchClearBtn, randomBookmarkBtn, searchInput } = dom;
    const actionButtons = [
        { btn: searchClearBtn, visible: !!hasVal },
        { btn: randomBookmarkBtn, visible: !hasVal }
    ];
    for (const { btn, visible } of actionButtons) {
        if (!btn) continue;
        btn.classList.toggle('hidden', !visible);
        btn.inert = !visible;
        btn.setAttribute('aria-hidden', String(!visible));
        if (!visible && document.activeElement === btn) searchInput?.focus();
    }
}

export function bindSearchEvents() {
    const searchInput = dom.searchInput;
    const searchClearBtn = dom.searchClearBtn;
    const randomBookmarkBtn = dom.randomBookmarkBtn;
    const suggestionMenu = dom.suggestionMenu;

    updateSearchActionButtons(!!searchInput?.value);

    if (searchInput) {
        searchInput.addEventListener('compositionstart', () => {
            isComposing = true;
            justEndedComposition = false;
            hideSuggestions();
        });

        searchInput.addEventListener('compositionend', () => {
            isComposing = false;
            justEndedComposition = true;
            if (compositionEndTimer) clearTimeout(compositionEndTimer);
            compositionEndTimer = setTimeout(() => {
                justEndedComposition = false;
            }, CONFIG.TIMERS.COMPOSITION_END_RESET);

            const val = searchInput.value;
            updateSearchActionButtons(!!val);
            fetchSuggestions(state.engine, val);
        });

        searchInput.addEventListener('click', e => {
            e.stopPropagation();
            closeDropdown();
            const val = searchInput.value.trim();
            if (val && (!suggestionMenu || !suggestionMenu.classList.contains('active'))) {
                fetchSuggestions(state.engine, val);
            }
        });

        searchInput.addEventListener('input', () => {
            const val = searchInput.value;
            updateSearchActionButtons(!!val);
            if (isComposing) return;
            scheduleSuggestions(val);
        });
    }

    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', e => {
            e.stopPropagation();
            e.preventDefault();
            if (searchInput) searchInput.value = '';
            updateSearchActionButtons(false);
            hideSuggestions();
            searchInput?.focus();
        });
    }

    if (randomBookmarkBtn) {
        randomBookmarkBtn.addEventListener('click', e => {
            e.stopPropagation();
            e.preventDefault();
            openRandomBookmark();
        });
    }

    if (suggestionMenu) {
        /** @param {MouseEvent} e */
        const handleSuggestionClick = e => {
            const auxiliary = e.type === 'auxclick';
            if (auxiliary && e.button !== 1) return;
            const targetEl = e.target instanceof Element ? e.target : null;
            const item = /** @type {HTMLElement|null} */ (targetEl?.closest('.suggestion-item'));
            if (!item || !item.dataset.idx) return;
            if (auxiliary) e.preventDefault();
            e.stopPropagation();
            const isNewTab = auxiliary || e.altKey || e.metaKey || e.ctrlKey;
            activateSuggestion(Number(item.dataset.idx), isNewTab);
        };
        suggestionMenu.addEventListener('click', handleSuggestionClick);
        suggestionMenu.addEventListener('auxclick', handleSuggestionClick);
        suggestionMenu.addEventListener('mouseover', e => {
            if (suggestionMenu.classList.contains('keyboard-nav')) suggestionMenu.classList.remove('keyboard-nav');
            const targetEl = e.target instanceof Element ? e.target : null;
            const item = /** @type {HTMLElement|null} */ (targetEl?.closest('.suggestion-item'));
            if (!item || !item.dataset.idx) return;
            selectSuggestion(Number(item.dataset.idx));
        }, { passive: true });
    }

    const dropdownMenu = dom.dropdownMenu;
    if (dropdownMenu) {
        dropdownMenu.addEventListener('click', e => {
            const targetEl = e.target instanceof Element ? e.target : null;
            const btn = /** @type {HTMLElement|null} */ (targetEl?.closest('[data-engine]'));
            if (btn && btn.dataset.engine) { e.stopPropagation(); setEngine(btn.dataset.engine); }
        });
        dropdownMenu.addEventListener('keydown', e => {
            if (e.key === 'Tab') { closeDropdown(); return; }
            const items = /** @type {HTMLElement[]} */ (Array.from(dropdownMenu.querySelectorAll('[data-engine]')));
            const activeEl = /** @type {HTMLElement | null} */ (document.activeElement);
            handleRovingKeyNav(e, items, activeEl, () => {});
        });
    }
}

/** 处理搜索框内部按键；返回 true 时全局快捷键停止分发。 @param {KeyboardEvent} e */
export function handleSearchKeydown(e) {
    if (document.activeElement !== dom.searchInput) return false;
    if (isComposing) return true;
    if (justEndedComposition) {
        if (e.key === 'Enter') e.preventDefault();
        return true;
    }
    if (e.key === 'Enter') {
        e.preventDefault();
        activateSuggestion(selectedSuggestionIdx, e.altKey || e.metaKey || e.ctrlKey);
        return true;
    }
    return handleSuggestionKeyNav(e);
}
