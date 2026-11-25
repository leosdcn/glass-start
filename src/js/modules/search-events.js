/** 搜索输入、输入法、候选与引擎菜单的控件事件；跨业务关闭和全局快捷键由 events.js 协调。 */
import { state } from '../state/store.js';
import { dom } from '../state/dom.js';
import { settleAnimation } from '../core/motion.js';
import { OverlayStack } from '../core/overlay-stack.js';
import { handleRovingKeyNav } from '../utils/helpers.js';
import { activateSuggestion, selectSuggestion, fetchSuggestions, cancelSuggestionRequest, cancelSearchSubmission, hideSuggestions, closeDropdown, setEngine, getSelectedSuggestionIdx, scheduleSuggestions, handleSuggestionKeyNav, submitImageSearch } from './search.js';
import { getImageSearchEngine } from './image-search.js';

let isComposing = false;
/** @type {boolean | null} 记录按钮当前展示状态，避免输入期间无状态变化的重复 DOM 属性写入 */
let lastHasVal = null;

/** @param {boolean} hasVal */
function updateSearchActionButtons(hasVal) {
    const next = !!hasVal;
    if (lastHasVal === next) return;
    lastHasVal = next;

    const { searchClearBtn, imageSearchBtn, searchInput } = dom;
    const actionButtons = [
        { btn: searchClearBtn, visible: next },
        { btn: imageSearchBtn, visible: !next }
    ];
    for (const { btn, visible } of actionButtons) {
        if (!btn) continue;
        btn.classList.toggle('hidden', !visible);
        btn.inert = !visible;
        btn.setAttribute('aria-hidden', String(!visible));
        if (!visible && document.activeElement === btn) searchInput?.focus();
    }
}

function bindSearchInputEvents() {
    const { searchInput, searchClearBtn, imageSearchStatus } = dom;
    lastHasVal = null;
    updateSearchActionButtons(!!searchInput?.value);

    if (searchInput) {
        searchInput.addEventListener('compositionstart', () => {
            isComposing = true;
            cancelSearchSubmission();
            cancelSuggestionRequest();
            selectSuggestion(-1);
        });
        searchInput.addEventListener('compositionend', () => {
            isComposing = false;
            const val = searchInput.value;
            updateSearchActionButtons(!!val);
            fetchSuggestions(state.engine, val);
        });
        searchInput.addEventListener('click', () => {
            if (isComposing) return;
            const val = searchInput.value.trim();
            if (val && !OverlayStack.has('suggestions')) fetchSuggestions(state.engine, val);
        });
        searchInput.addEventListener('input', () => {
            cancelSearchSubmission();
            if (imageSearchStatus) imageSearchStatus.textContent = '';
            const val = searchInput.value;
            updateSearchActionButtons(!!val);
            if (!isComposing) scheduleSuggestions(val);
        });
        searchInput.addEventListener('focusout', e => {
            // 候选区按下时保留输入焦点，键盘移到其他控件时收起。
            if (e.relatedTarget) hideSuggestions();
        });
    }

    searchClearBtn?.addEventListener('click', e => {
        e.preventDefault();
        cancelSearchSubmission();
        if (searchInput) searchInput.value = '';
        if (imageSearchStatus) imageSearchStatus.textContent = '';
        updateSearchActionButtons(false);
        hideSuggestions();
        searchInput?.focus();
    });
}

function bindSuggestionMenuEvents() {
    const suggestionMenu = dom.suggestionMenu;
    if (!suggestionMenu) return;

    suggestionMenu.addEventListener('pointerdown', e => {
        if (isComposing) e.preventDefault();
    });
    suggestionMenu.addEventListener('mousedown', e => {
        if (e.target instanceof Element && e.target.closest('.suggestion-item')) e.preventDefault();
    });
    /** @param {MouseEvent} e */
    const handleSuggestionClick = e => {
        if (isComposing) return;
        const auxiliary = e.type === 'auxclick';
        if (auxiliary && e.button !== 1) return;
        const targetEl = e.target instanceof Element ? e.target : null;
        const item = /** @type {HTMLElement|null} */ (targetEl?.closest('.suggestion-item'));
        if (!item || !item.dataset.idx) return;
        if (auxiliary) e.preventDefault();
        activateSuggestion(Number(item.dataset.idx), auxiliary || e.altKey || e.metaKey || e.ctrlKey);
    };
    suggestionMenu.addEventListener('click', handleSuggestionClick);
    suggestionMenu.addEventListener('auxclick', handleSuggestionClick);
    suggestionMenu.addEventListener('mouseover', e => {
        if (isComposing) return;
        if (suggestionMenu.classList.contains('keyboard-nav')) suggestionMenu.classList.remove('keyboard-nav');
        const targetEl = e.target instanceof Element ? e.target : null;
        const item = /** @type {HTMLElement|null} */ (targetEl?.closest('.suggestion-item'));
        if (item?.dataset.idx) selectSuggestion(Number(item.dataset.idx));
    }, { passive: true });
}

function bindImageSearchEvents() {
    const { searchInput, imageSearchBtn, imageSearchInput, imageSearchStatus } = dom;
    imageSearchBtn?.addEventListener('click', e => {
        if (!imageSearchInput) return;
        e.stopPropagation();
        cancelSearchSubmission();
        closeDropdown();
        hideSuggestions();
        if (imageSearchStatus) imageSearchStatus.textContent = '';
        imageSearchInput.value = '';
        imageSearchInput.click();
    });
    imageSearchInput?.addEventListener('change', () => {
        submitImageSearch(getImageSearchEngine(), imageSearchInput);
    });

    const searchBox = searchInput?.closest('.search-box-wrapper');
    if (!(searchBox instanceof HTMLElement) || !imageSearchInput) return;

    /** @param {FileList} files */
    const submitTransferredImage = files => {
        closeDropdown();
        hideSuggestions();
        if (imageSearchStatus) imageSearchStatus.textContent = '';
        imageSearchInput.files = files;
        submitImageSearch(getImageSearchEngine(), imageSearchInput);
    };
    searchInput?.addEventListener('paste', e => {
        const files = e.clipboardData?.files;
        if (files?.length !== 1 || !files[0].type.startsWith('image/')) return;
        e.preventDefault();
        submitTransferredImage(files);
    });

    /** @param {DragEvent} e */
    const highlightImageDrop = e => {
        const transfer = e.dataTransfer;
        if (!transfer?.types.includes('Files')) return;
        e.preventDefault();
        const files = Array.from(transfer.items).filter(item => item.kind === 'file');
        const type = files[0]?.type;
        const acceptsImage = files.length <= 1 && (!type || type === 'application/octet-stream' || type.startsWith('image/'));
        transfer.dropEffect = acceptsImage ? 'copy' : 'none';
        searchBox.classList.toggle('image-dragover', acceptsImage);
    };
    searchBox.addEventListener('dragenter', highlightImageDrop);
    searchBox.addEventListener('dragover', highlightImageDrop);
    searchBox.addEventListener('dragleave', e => {
        if (e.relatedTarget instanceof Node && searchBox.contains(e.relatedTarget)) return;
        searchBox.classList.remove('image-dragover');
    });
    searchBox.addEventListener('drop', e => {
        searchBox.classList.remove('image-dragover');
        const files = e.dataTransfer?.files;
        if (!files?.length) return;
        e.preventDefault();
        if (files.length === 1) submitTransferredImage(files);
    });
}

function bindEngineDropdownEvents() {
    const dropdownMenu = dom.dropdownMenu;
    if (!dropdownMenu) return;

    dropdownMenu.addEventListener('click', e => {
        const targetEl = e.target instanceof Element ? e.target : null;
        const btn = /** @type {HTMLElement|null} */ (targetEl?.closest('[data-engine]'));
        if (!btn?.dataset.engine) return;

        const previousEngine = state.engine;
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const shouldAnimate = btn.dataset.engine !== previousEngine && !motion.matches;
        const previousSvg = shouldAnimate ? dom.engineIcon?.querySelector(':scope > svg:not([data-leaving])') : null;
        const leavingSvg = previousSvg instanceof SVGElement ? /** @type {SVGElement} */ (previousSvg.cloneNode(true)) : null;

        setEngine(btn.dataset.engine);

        if (state.engine !== previousEngine && !motion.matches && dom.engineIcon) {
            const enteringSvg = dom.engineIcon.querySelector(':scope > svg:not([data-leaving])');
            if (leavingSvg) {
                leavingSvg.dataset.leaving = '1';
                leavingSvg.setAttribute('aria-hidden', 'true');
                leavingSvg.style.position = 'absolute';
                leavingSvg.style.inset = '0';
                leavingSvg.style.pointerEvents = 'none';
                dom.engineIcon.appendChild(leavingSvg);
                const exitAnim = leavingSvg.animate(
                    [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.55)' }],
                    { duration: 100, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
                );
                settleAnimation(exitAnim, motion, () => leavingSvg.remove());
            }
            if (enteringSvg) {
                settleAnimation(enteringSvg.animate(
                    [{ opacity: 0, transform: 'scale(0.55)' }, { opacity: 1, transform: 'scale(1)' }],
                    { delay: 55, duration: 200, easing: 'cubic-bezier(0.2, 0.95, 0.25, 1)', fill: 'backwards' }
                ), motion);
            }
        }
        closeDropdown();
        const query = dom.searchInput?.value.trim();
        if (query && !isComposing) fetchSuggestions(state.engine, query);
    });
    dropdownMenu.addEventListener('keydown', e => {
        if (e.key === 'Tab') { closeDropdown(); return; }
        const items = /** @type {HTMLElement[]} */ (Array.from(dropdownMenu.querySelectorAll('[data-engine]')));
        const activeEl = /** @type {HTMLElement | null} */ (document.activeElement);
        handleRovingKeyNav(e, items, activeEl, () => {});
    });
}

export function bindSearchEvents() {
    bindSearchInputEvents();
    bindSuggestionMenuEvents();
    bindImageSearchEvents();
    bindEngineDropdownEvents();
}

/** 搜索框获得焦点时处理按键；返回 true 时全局快捷键停止分发。 @param {KeyboardEvent} e */
export function handleSearchKeydown(e) {
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
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && getSelectedSuggestionIdx() >= 0) {
        selectSuggestion(-1, { keyboard: true });
        return true;
    }
    if (handleSuggestionKeyNav(e)) return true;
    // 有查询时，上下键留在搜索框。
    return (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !!dom.searchInput?.value.trim();
}
