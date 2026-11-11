/** 搜索输入、输入法、候选与引擎菜单的控件事件；跨业务关闭和全局快捷键由 events.js 协调。 */
import { state } from '../state/store.js';
import { dom } from '../state/dom.js';
import { handleRovingKeyNav } from '../utils/helpers.js';
import { activateSuggestion, selectSuggestion, fetchSuggestions, hideSuggestions, closeDropdown, setEngine, openRandomBookmark, getSelectedSuggestionIdx, scheduleSuggestions, handleSuggestionKeyNav } from './search.js';

let isComposing = false;
/** @type {boolean | null} 记录按钮当前展示状态，避免输入期间无状态变化的重复 DOM 属性写入 */
let lastHasVal = null;

/** @param {boolean} hasVal */
function updateSearchActionButtons(hasVal) {
    const next = !!hasVal;
    if (lastHasVal === next) return;
    lastHasVal = next;

    const { searchClearBtn, randomBookmarkBtn, searchInput } = dom;
    const actionButtons = [
        { btn: searchClearBtn, visible: next },
        { btn: randomBookmarkBtn, visible: !next }
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

    lastHasVal = null;
    updateSearchActionButtons(!!searchInput?.value);

    if (searchInput) {
        searchInput.addEventListener('compositionstart', () => {
            isComposing = true;
            hideSuggestions();
        });

        searchInput.addEventListener('compositionend', () => {
            isComposing = false;
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
            if (btn?.dataset.engine) {
                e.stopPropagation();
                setEngine(btn.dataset.engine);
                closeDropdown();
                const query = dom.searchInput?.value.trim();
                if (query) fetchSuggestions(state.engine, query);
            }
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
    if (e.key === 'Enter') {
        e.preventDefault();
        activateSuggestion(getSelectedSuggestionIdx(), e.altKey || e.metaKey || e.ctrlKey);
        return true;
    }
    if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        hideSuggestions();
        return true;
    }
    if (handleSuggestionKeyNav(e)) return true;
    // 有查询时，上下键留在搜索框。
    return (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !!dom.searchInput?.value.trim();
}
