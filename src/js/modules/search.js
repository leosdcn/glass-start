import { t, getLocale, localizeBookmarkUrl } from '../core/i18n.js';
/** 搜索引擎切换、书签分级匹配与网络联想；请求序号隔离迟到响应。 */
import { rankBookmarkSuggestions } from '../utils/bookmark-search.js';
import { getCategoryCatalog, searchUrlKey } from '../utils/category-catalog.js';
import { CONFIG, engines } from '../config/constants.js';
import { DEFAULT_ENGINE } from '../config/engines.js';
import { escapeHtml, safeUrl } from '../utils/helpers.js';
import { storageSet } from '../utils/storage.js';
import { state, pageData } from '../state/store.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';

/** @type {import('../types').SuggestionItem[]} */
let suggestionItems = [];
let lastSuggestionsSignature = '';
/** @type {NodeListOf<HTMLElement> | HTMLElement[]} */
let suggestionNodes = [];
/** @type {HTMLElement | null} */
let selectedSuggestionNode = null;
let selectionUpdatesInput = false;
/**
 * @param {number} index
 * @param {boolean} [newTab]
 */
export function activateSuggestion(index, newTab) {
    const item = suggestionItems[index];
    if (item?.type === 'bookmark') openBookmarkUrl(item.url, newTab);
    else doSearch(item?.text, newTab);
}
/**
 * @param {number} index
 * @param {{ keyboard?: boolean; updateInput?: boolean }} [options]
 */
export function selectSuggestion(index, { keyboard = false, updateInput = true } = {}) {
    const menu = dom.suggestionMenu;
    const input = dom.searchInput;
    selectedSuggestionIdx = suggestionItems[index] ? index : -1;
    selectionUpdatesInput = updateInput;
    const node = suggestionNodes[selectedSuggestionIdx] || null;
    const changed = node !== selectedSuggestionNode;
    if (changed) {
        selectedSuggestionNode?.classList.remove('active');
        selectedSuggestionNode?.setAttribute('aria-selected', 'false');
        node?.classList.add('active');
        node?.setAttribute('aria-selected', 'true');
        selectedSuggestionNode = node;
    }
    if (keyboard && !menu?.classList.contains('keyboard-nav')) menu?.classList.add('keyboard-nav');
    const item = suggestionItems[selectedSuggestionIdx];
    if (input) {
        if (updateInput && input.value !== (item?.text ?? originalQuery)) input.value = item?.text ?? originalQuery;
        const activeId = item ? 'sug-opt-' + selectedSuggestionIdx : null;
        if (input.getAttribute('aria-activedescendant') !== activeId) {
            if (activeId) input.setAttribute('aria-activedescendant', activeId);
            else input.removeAttribute('aria-activedescendant');
        }
    }
    if (keyboard && changed && item) node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// ——— 搜索建议状态与测试探针导出 ———
// 注：部分变量通过 live binding 导出供 testing/bridge.js 及 CDP 自动化测试断言
/** @type {HTMLScriptElement | null} 当前活跃的 JSONP 脚本节点（测试探针 / 清理用） */
export let suggestionScriptTag = null;
/** 当前选中的建议列表项索引（-1 为未选中，公共状态 / 供外部与测试读取） */
export let selectedSuggestionIdx = -1;
/** 键盘上下切换前用户键入的原始关键词（公共状态） */
export let originalQuery = '';
/** @type {ReturnType<typeof setTimeout> | null} 防抖定时器句柄 */
let suggestDebounceTimer = null;
/** 异步建议请求自增计数序列号（测试探针，用于防竞态乱序覆盖） */
export let activeSuggestReqId = 0;
/** @type {(() => void) | null} */
let activeSuggestCleanup = null;
/** @type {string | null} */
let suggestionQueryKey = null;

/** @param {string} val 更新原始搜索词 */
export function setOriginalQuery(val) {
    originalQuery = val;
}

/**
 * 处理搜索建议的键盘上下键导航
 * @param {KeyboardEvent} e
 * @param {((hasVal: boolean) => void)} [onActionButtonsUpdate]
 * @returns {boolean} 是否处理了导航按键
 */
export function handleSuggestionKeyNav(e, onActionButtonsUpdate) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    // 防抖期间等新候选，避免方向键改走全局切屏入口。
    if (suggestDebounceTimer !== null && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        return true;
    }
    const isSuggestActive = dom.suggestionMenu?.classList.contains('active');
    const suggestionCount = isSuggestActive ? suggestionItems.length : 0;
    if (suggestionCount <= 0) return false;

    const searchInput = dom.searchInput;
    const updateActiveSuggestion = () => {
        selectSuggestion(selectedSuggestionIdx, { keyboard: true });
        if (onActionButtonsUpdate && searchInput) onActionButtonsUpdate(!!searchInput.value);
    };

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (selectedSuggestionIdx === -1 && searchInput) {
            originalQuery = searchInput.value;
        }
        let nextIdx = selectedSuggestionIdx + 1;
        if (nextIdx >= suggestionCount) {
            nextIdx = -1;
        }
        selectedSuggestionIdx = nextIdx;
        updateActiveSuggestion();
        return true;
    }

    if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectedSuggestionIdx === -1 && searchInput) {
            originalQuery = searchInput.value;
            selectedSuggestionIdx = suggestionCount - 1;
        } else {
            selectedSuggestionIdx = selectedSuggestionIdx - 1;
        }
        updateActiveSuggestion();
        return true;
    }

    return false;
}

/**
 * 输入防抖与关闭清理共用同一个计时器；执行时读取当前搜索引擎。
 * @param {string} query
 */
export function scheduleSuggestions(query) {
    query = query.trim();
    if (suggestionQueryKey === `${getLocale()}:${state.engine}:${query}`) {
        if (selectedSuggestionIdx >= 0) selectSuggestion(-1, { updateInput: false });
        return;
    }
    // 新输入立即让旧候选失效，网络请求仍防抖。
    hideSuggestions();
    if (!query) return;
    suggestDebounceTimer = setTimeout(() => {
        suggestDebounceTimer = null;
        fetchSuggestions(state.engine, query);
    }, CONFIG.SUGGEST.DEBOUNCE_MS);
}

/**
 * 渲染搜索引擎下拉切换菜单项 HTML
 * @returns {void}
 */
export function renderEngineDropdown() {
    const dropdownMenu = dom.dropdownMenu;
    if (!dropdownMenu) return;
    const curEngine = state.engine || DEFAULT_ENGINE;
    /** @type {Record<string, { name: string; svg: string; url: string }>} */
    const engineMap = engines;
    dropdownMenu.innerHTML = Object.entries(engineMap).map(([key, eng]) => {
        const isChecked = key === curEngine;
        const iconHtml = `<span class="engine-icon size-5 aspect-square shrink-0 rounded pointer-events-none select-none flex items-center justify-center">${eng.svg}</span>`;
        return `<button type="button" data-engine="${key}" role="menuitemradio" aria-checked="${isChecked}" class="w-full flex items-center gap-3 px-3 py-2.5 apple-radius hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 glass-interactive text-left text-sm select-none">
            ${iconHtml} ${eng.name}
        </button>`;
    }).join('');
}

/**
 * 切换搜索引擎下拉菜单的展开/收起状态并同步 OverlayStack
 * @returns {void}
 */
export function toggleDropdown() {
    const dropdownMenu = dom.dropdownMenu;
    const engineBtn = dom.engineBtn;
    const nextOpen = !dropdownMenu?.classList.contains('active');
    dropdownMenu?.classList.toggle('active', nextOpen);
    dropdownMenu?.setAttribute('aria-hidden', (!nextOpen).toString());
    engineBtn?.setAttribute('aria-expanded', nextOpen.toString());
    if (nextOpen) {
        OverlayStack.push('dropdown', closeDropdown);
        const activeItem = /** @type {HTMLElement | null} */ (dropdownMenu?.querySelector('[data-engine][aria-checked="true"]') || dropdownMenu?.querySelector('[data-engine]'));
        activeItem?.focus();
    } else {
        OverlayStack.pop('dropdown');
    }
}

/**
 * 主动收起搜索引擎下拉菜单并从 OverlayStack 出栈
 * @returns {void}
 */
export function closeDropdown() {
    OverlayStack.pop('dropdown');
    const dropdownMenu = dom.dropdownMenu;
    const engineBtn = dom.engineBtn;
    const hadFocus = !!(dropdownMenu && document.activeElement && dropdownMenu.contains(document.activeElement));
    dropdownMenu?.classList.remove('active');
    dropdownMenu?.setAttribute('aria-hidden', 'true');
    engineBtn?.setAttribute('aria-expanded', 'false');
    if (hadFocus) engineBtn?.focus();
}

/**
 * 设置当前搜索引擎
 * @param {string} key - engines 中的引擎标识
 * @param {boolean} [save=true] - 是否持久化到 localStorage
 */
export function setEngine(key, save = true) {
    /** @type {Record<string, { name: string; svg: string; url: string }>} */
    const engineMap = engines;
    const validEngine = Object.hasOwn(engineMap, key) ? key : DEFAULT_ENGINE;
    state.engine = validEngine;
    const engineObj = engineMap[validEngine] || engineMap[DEFAULT_ENGINE];
    const engineName = dom.engineName;
    const engineBtn = dom.engineBtn;
    const engineIcon = dom.engineIcon;
    const dropdownMenu = dom.dropdownMenu;
    const searchInput = dom.searchInput;

    if (engineName) engineName.textContent = engineObj.name;
    if (engineBtn) {
        engineBtn.setAttribute('aria-label', t('engine.current', { name: engineObj.name }));
    }
    if (engineIcon) {
        engineIcon.style.display = '';
        engineIcon.innerHTML = engineObj.svg;
    }
    if (dropdownMenu) {
        dropdownMenu.querySelectorAll('[role="menuitemradio"]').forEach(btn => {
            if (btn instanceof HTMLElement) {
                btn.setAttribute('aria-checked', btn.dataset.engine === validEngine ? 'true' : 'false');
            }
        });
    }
    closeDropdown();
    if (save) storageSet(CONFIG.KEYS.PREFERRED_ENGINE, validEngine);
    if (searchInput && searchInput.value.trim()) {
        fetchSuggestions(validEngine, searchInput.value.trim());
    }
}

/** 
 * 执行搜索
 * @param {string} [queryOverride] - 可选直接传入建议词
 * @param {boolean} [newTab=false] - 是否在新标签页中打开
 */
function doSearch(queryOverride, newTab = false) {
    const searchInput = dom.searchInput;
    const q = (queryOverride !== undefined ? queryOverride : (searchInput ? searchInput.value : '')).trim();
    if (!q) return;
    closeDropdown();
    /** @type {Record<string, { name: string; svg: string; url: string }>} */
    const engineMap = engines;
    const engineObj = engineMap[state.engine] || engineMap[DEFAULT_ENGINE];
    const targetUrl = engineObj.url + encodeURIComponent(q);
    if (newTab) {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
    } else {
        hideSuggestions();
        window.location.href = targetUrl;
    }
}

/**
 * 打开本站书签 URL（带安全协议校验与域名自动补全）
 * @param {string} url - 目标网址
 * @param {boolean} [newTab=false] - 是否在新标签页打开
 */
function openBookmarkUrl(url, newTab = false) {
    if (!url) return;
    let trimmed = localizeBookmarkUrl(url.trim());
    if (/^(javascript|data|vbscript|file|blob):/i.test(trimmed)) {
        console.warn('⚠️ 拦截高危伪协议书签 URL:', trimmed);
        return;
    }
    if (!/^(https?:|\/|\.\/|#)/i.test(trimmed)) {
        if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(trimmed)) {
            trimmed = 'https://' + trimmed;
        } else {
            console.warn('⚠️ 拦截非安全协议书签 URL:', trimmed);
            return;
        }
    }
    closeDropdown();
    if (newTab) {
        window.open(trimmed, '_blank', 'noopener,noreferrer');
    } else {
        hideSuggestions();
        window.location.href = trimmed;
    }
}

/**
 * 随机探索/手气不错：从本地书签库中随机挑选并访问一个站点
 */
let diceAngle = 0;
export function openRandomBookmark() {
    /** @type {import('../types').BookmarkItem[]} */
    const list = [];
    const seen = new Set();
    /** @param {import('../types').BookmarkItem} bm */
    const addBookmark = bm => {
        if (bm?.url && !seen.has(bm.url)) {
            seen.add(bm.url);
            list.push(bm);
        }
    };
    pageData.bookmarks.forEach(addBookmark);
    getCategoryCatalog(pageData.categories).entries.forEach(entry => addBookmark(entry.bm));
    if (list.length === 0) return;
    const randomBm = list[Math.floor(Math.random() * list.length)];

    const randomBtn = dom.randomBookmarkBtn;
    if (randomBtn) {
        diceAngle += CONFIG.PHYSICS.DICE_ROTATION_STEP;
        const svg = randomBtn.querySelector('svg');
        if (svg) svg.style.transform = `rotate(${diceAngle}deg)`;
    }

    setTimeout(() => {
        hideSuggestions();
        openBookmarkUrl(randomBm.url, true);
    }, CONFIG.TIMERS.STAGGER_OPEN);
}

/** @type {import('../types').SearchCandidateModel | null} */
let cachedSearchCandidates = null;
/** @type {import('../types').BookmarkItem[] | null} */
let lastCandidatesBookmarksRef = null;
/** @type {import('../types').CategoryCatalog | null} */
let lastCandidatesCatalogRef = null;

function getSearchCandidates() {
    const catalog = getCategoryCatalog(pageData.categories);
    if (cachedSearchCandidates && lastCandidatesBookmarksRef === pageData.bookmarks && lastCandidatesCatalogRef === catalog) {
        return cachedSearchCandidates;
    }
    const urlToCategoryMap = catalog.searchCategories;
    /** @type {import('../types').SearchCandidateItem[]} */
    const candidates = [];
    const seenNormUrls = new Set();
    /**
     * @param {import('../types').BookmarkItem} bm
     * @param {string} normUrl
     * @param {string} defaultCat
     */
    const addCandidate = (bm, normUrl, defaultCat) => {
        if (seenNormUrls.has(normUrl)) return;
        seenNormUrls.add(normUrl);
        candidates.push({
            bm,
            normUrl,
            defaultCat,
            nameLower: (bm.name || '').toLowerCase(),
            descLower: (bm.desc || '').toLowerCase(),
            urlLower: (bm.url || '').toLowerCase()
        });
    };
    for (const bm of pageData.bookmarks) {
        if (bm.url) addCandidate(bm, searchUrlKey(bm.url), t('ui.quick.bookmarks'));
    }
    for (const {bm, normUrl, defaultCat} of catalog.entries) addCandidate(bm, normUrl, defaultCat);

    cachedSearchCandidates = { candidates, urlToCategoryMap };
    lastCandidatesBookmarksRef = pageData.bookmarks;
    lastCandidatesCatalogRef = catalog;

    return cachedSearchCandidates;
}

/**
 * @param {string} query
 * @param {number} [limit]
 * @returns {import('../types').BookmarkSuggestion[]}
 */
function getLocalBookmarkSuggestions(query, limit = CONFIG.SUGGEST.MAX_LOCAL_ITEMS) {
    return rankBookmarkSuggestions(query, getSearchCandidates(), CONFIG.SUGGEST, limit);
}

/** 内容未变化时才复用候选节点，避免同一 URL 的编辑结果仍显示旧内容。
 * @param {import('../types').BookmarkSuggestion} bm
 */
function bookmarkSuggestionKey(bm) {
    return JSON.stringify([bm.url, bm.name, bm.icon, bm.desc || '', bm.category || '']);
}

/**
 * @param {import('../types').BookmarkSuggestion} bm
 * @param {number} idx
 */
function getBookmarkSuggestionHTML(bm, idx) {
    const safeIcon = bm.icon ? safeUrl(bm.icon) : '';
    const iconHtml = (safeIcon && safeIcon !== '#')
        ? `<img src="${safeIcon}" width="20" height="20" class="w-5 h-5 rounded-md object-cover shrink-0 pointer-events-none select-none" alt="" data-hide-on-error="1" draggable="false">`
        : `<svg class="w-5 h-5 text-white/40 shrink-0 pointer-events-none select-none" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"/></svg>`;

    return `
        <div id="sug-opt-${idx}"
             role="option" aria-selected="false" 
             data-url="${escapeHtml(bm.url)}"
             data-bookmark-key="${escapeHtml(bookmarkSuggestionKey(bm))}"
             data-idx="${idx}"
             class="suggestion-item group px-3.5 py-2.5 my-0.5 apple-radius text-sm text-white/90 flex items-center gap-3 glass-interactive cursor-pointer hover:text-white">
            ${iconHtml}
            <div class="truncate flex-1 min-w-0 flex items-center gap-2">
                <span class="truncate font-medium text-white/95">${escapeHtml(bm.name)}</span>
                ${bm.desc ? `<span class="truncate text-xs text-white/45 hidden sm:inline">${escapeHtml(bm.desc)}</span>` : ''}
            </div>
            <span class="text-2xs px-2 py-0.5 apple-radius bg-white/10 border border-white/15 text-white/60 shrink-0">${escapeHtml(bm.category || '')}</span>
        </div>
    `;
}

/**
 * 渲染搜索联想下拉面板
 * @param {import('../types').BookmarkSuggestion[]} [localList]
 * @param {string[]} [netList]
 * @param {boolean} [preserveSelection=false]
 * @param {boolean} [isNetLoading=false]
 * @returns {void}
 */
function renderSuggestions(localList = [], netList = [], preserveSelection = false, isNetLoading = false) {
    const suggestionMenu = dom.suggestionMenu;
    const searchInput = dom.searchInput;
    if (!suggestionMenu) return;
    const prevIdx = preserveSelection ? selectedSuggestionIdx : -1;
    const restoreInput = selectionUpdatesInput;
    const maxNetCount = Math.max(0, CONFIG.SUGGEST.MAX_TOTAL_ITEMS - localList.length);
    const safeNetList = netList.slice(0, maxNetCount);
    const signature = JSON.stringify([isNetLoading, localList.map(bookmarkSuggestionKey), safeNetList]);
    if (signature === lastSuggestionsSignature && suggestionMenu.classList.contains('active')) {
        if (!preserveSelection && selectedSuggestionIdx >= 0) selectSuggestion(-1, { updateInput: false });
        return;
    }
    suggestionItems = [
        ...localList.map(bm => (/** @type {import('../types').SuggestionBookmarkItem} */ ({type: 'bookmark', text: bm.name, url: bm.url}))),
        ...safeNetList.map(text => (/** @type {import('../types').SuggestionQueryItem} */ ({type: 'query', text})))
    ];
    selectedSuggestionIdx = -1;

    if (localList.length === 0 && netList.length === 0 && !isNetLoading) {
        hideSuggestions();
        return;
    }

    const existingBookmarkMap = new Map();
    suggestionMenu.querySelectorAll(':scope > .suggestion-item[data-url]').forEach(el => {
        const u = el.getAttribute('data-url');
        if (u) existingBookmarkMap.set(u, /** @type {HTMLElement} */ (el));
    });

    const range = document.createRange();
    const fragment = document.createDocumentFragment();
    let globalIdx = 0;

    /**
     * @param {string} title
     * @param {boolean} [isFirst=false]
     */
    const renderSectionHeader = (title, isFirst = false) => `
        <div role="presentation" class="suggestion-section-header mx-3.5 px-0 ${isFirst ? 'pt-1.5' : 'pt-2'} pb-2 mb-1 text-2xs font-medium tracking-wider text-white/40 uppercase select-none">${title}</div>
    `;

    // 本地书签分组：就地复用已挂载的 DOM 节点，避免网络联想两阶段重刷时图片销毁与重解码闪烁
    if (localList.length > 0) {
        fragment.appendChild(range.createContextualFragment(renderSectionHeader(t('ui.bookmark'), true)));
        localList.forEach(bm => {
            const existing = existingBookmarkMap.get(bm.url);
            if (existing && existing.getAttribute('data-bookmark-key') === bookmarkSuggestionKey(bm)) {
                existing.id = `sug-opt-${globalIdx}`;
                existing.setAttribute('data-idx', String(globalIdx));
                existing.setAttribute('aria-selected', 'false');
                existing.classList.remove('active');
                fragment.appendChild(existing);
            } else {
                fragment.appendChild(range.createContextualFragment(getBookmarkSuggestionHTML(bm, globalIdx)));
            }
            globalIdx++;
        });
    }

    // 网络建议分组
    if (safeNetList.length > 0) {
        let netHtml = (localList.length > 0 ? renderSectionHeader(t('ui.search'), false) : '');
        safeNetList.forEach(item => {
            const idx = globalIdx++;
            netHtml += `
                <div id="sug-opt-${idx}"
                     role="option" aria-selected="false" 
                     data-idx="${idx}"
                     class="suggestion-item group px-3.5 py-2.5 my-0.5 apple-radius text-sm text-white/85 flex items-center gap-3 glass-interactive cursor-pointer hover:text-white">
                    <svg class="w-5 h-5 text-white/40 group-hover:text-white/80 shrink-0 pointer-events-none select-none transition-colors" aria-hidden="true"><use href="#icon-search"/></svg>
                    <span class="truncate flex-1 min-w-0 font-normal tracking-wide">${escapeHtml(item)}</span>
                </div>
            `;
        });
        fragment.appendChild(range.createContextualFragment(netHtml));
    } else if (isNetLoading) {
        let skeletonHtml = (localList.length > 0 ? renderSectionHeader(t('ui.search'), false) : '');
        const skeletonCount = Math.max(1, CONFIG.SUGGEST.MAX_TOTAL_ITEMS - localList.length);
        for (let k = 0; k < skeletonCount; k++) {
            const widthClass = k % 2 === 0 ? 'w-44' : 'w-28';
            skeletonHtml += `
                <div aria-hidden="true" class="px-3.5 py-2.5 my-0.5 apple-radius flex items-center gap-3 select-none pointer-events-none animate-pulse">
                    <svg class="w-5 h-5 text-white/20 shrink-0 pointer-events-none select-none" aria-hidden="true"><use href="#icon-search"/></svg>
                    <div class="h-5 bg-white/15 apple-radius ${widthClass}"></div>
                </div>
            `;
        }
        fragment.appendChild(range.createContextualFragment(skeletonHtml));
    }

    suggestionMenu.replaceChildren(fragment);
    suggestionNodes = suggestionMenu.querySelectorAll('.suggestion-item');
    selectedSuggestionNode = null;
    lastSuggestionsSignature = signature;
    suggestionMenu.classList.add('active');
    suggestionMenu.setAttribute('aria-hidden', 'false');
    if (searchInput) searchInput.setAttribute('aria-expanded', 'true');
    if (!OverlayStack.stack.some(entry => entry.id === 'suggestions')) {
        OverlayStack.push('suggestions', hideSuggestions);
    }

    if (prevIdx >= 0) selectSuggestion(Math.min(prevIdx, suggestionItems.length - 1), { updateInput: restoreInput });
    else searchInput?.removeAttribute('aria-activedescendant');
}

/**
 * 收起联想下拉面板、作废未决网络请求并从 OverlayStack 出栈
 * @returns {void}
 */
export function hideSuggestions() {
    suggestionItems = [];
    suggestionNodes = [];
    selectedSuggestionNode = null;
    selectionUpdatesInput = false;
    lastSuggestionsSignature = '';
    suggestionQueryKey = null;
    if (suggestDebounceTimer !== null) {
        clearTimeout(suggestDebounceTimer);
        suggestDebounceTimer = null;
    }
    activeSuggestReqId++;
    activeSuggestCleanup?.();
    OverlayStack.pop('suggestions');
    const suggestionMenu = dom.suggestionMenu;
    const searchInput = dom.searchInput;
    if (suggestionMenu) {
        suggestionMenu.classList.remove('active', 'keyboard-nav');
        suggestionMenu.setAttribute('aria-hidden', 'true');
    }
    if (searchInput) {
        searchInput.setAttribute('aria-expanded', 'false');
        searchInput.removeAttribute('aria-activedescendant');
    }
    selectedSuggestionIdx = -1;
}

/** @type {Map<string, { list: string[]; timestamp: number }>} */
const suggestCache = new Map();
const SUGGEST_CACHE_TTL = 60000;
const MAX_SUGGEST_CACHE_SIZE = 50;

/**
 * 核心实时建议拉取函数
 * @param {string} engineKey
 * @param {string} query
 */
export function fetchSuggestions(engineKey, query) {
    if (suggestDebounceTimer !== null) {
        clearTimeout(suggestDebounceTimer);
        suggestDebounceTimer = null;
    }
    query = (query || '').trim();
    if (!query) {
        hideSuggestions();
        return;
    }

    const cacheKey = `${getLocale()}:${engineKey}:${query}`;
    // compositionend 后的 input、重复选择当前引擎等入口共享正在进行的请求和列表。
    if (activeSuggestCleanup && suggestionQueryKey === cacheKey) return;
    activeSuggestCleanup?.();
    activeSuggestReqId++;
    suggestionQueryKey = cacheKey;
    const localList = getLocalBookmarkSuggestions(query, CONFIG.SUGGEST.MAX_LOCAL_ITEMS);

    const cachedEntry = suggestCache.get(cacheKey);
    if (cachedEntry && (Date.now() - cachedEntry.timestamp < SUGGEST_CACHE_TTL)) {
        const maxNetCount = Math.max(0, CONFIG.SUGGEST.MAX_TOTAL_ITEMS - localList.length);
        const netList = cachedEntry.list.slice(0, maxNetCount);
        if (localList.length > 0 || netList.length > 0) {
            renderSuggestions(localList, netList, false);
        } else {
            hideSuggestions();
        }
        return;
    }

    renderSuggestions(localList, [], false, true);

    const reqId = activeSuggestReqId;

    const cbName = `__glassSuggestCb_${reqId}`;
    const controller = window.__GLASS_EXTENSION__ || engineKey === 'wikipedia' ? new AbortController() : null;
    const script = controller ? null : document.createElement('script');
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeoutTimer = null;

    const cleanup = () => {
        if (timeoutTimer !== null) {
            clearTimeout(timeoutTimer);
            timeoutTimer = null;
        }
        controller?.abort();
        if (script) {
            try { delete /** @type {any} */ (window)[cbName]; } catch {}
            script.onload = null;
            script.onerror = null;
            script.remove();
        }
        if (suggestionScriptTag === script) suggestionScriptTag = null;
        if (activeSuggestCleanup === cleanup) {
            activeSuggestCleanup = null;
        }
    };

    const handleSuggestFallback = () => {
        cleanup();
        if (reqId !== activeSuggestReqId) return;
        if (localList.length > 0) {
            renderSuggestions(localList, [], true, false);
        } else {
            hideSuggestions();
        }
    };

    activeSuggestCleanup = cleanup;
    timeoutTimer = setTimeout(handleSuggestFallback, CONFIG.SUGGEST.JSONP_TIMEOUT);

    /** @param {any} data */
    const handleSuggestData = data => {
        cleanup();
        if (reqId !== activeSuggestReqId) return;
        let list = [];
        if (Array.isArray(data)) {
            list = Array.isArray(data[1]) ? data[1] : data.map(item => (typeof item === 'object' && item && item.phrase) ? item.phrase : item);
        }
        const maxNetCount = Math.max(0, CONFIG.SUGGEST.MAX_TOTAL_ITEMS - localList.length);
        const safeList = list.filter(item => typeof item === 'string' && item.trim().length > 0);
        if (suggestCache.size >= MAX_SUGGEST_CACHE_SIZE) {
            const oldest = suggestCache.keys().next().value;
            if (oldest) suggestCache.delete(oldest);
        }
        suggestCache.set(cacheKey, { list: safeList, timestamp: Date.now() });
        const netList = safeList.slice(0, maxNetCount);
        if (localList.length > 0 || netList.length > 0) {
            renderSuggestions(localList, netList, true);
        } else {
            hideSuggestions();
        }
    };

    if (controller) {
        // 扩展使用域名权限读取 JSON，禁止把远程响应作为脚本执行。
        let url = `https://${getLocale() === 'en' ? 'en' : 'zh'}.wikipedia.org/w/api.php?action=opensearch&format=json&search=${encodeURIComponent(query)}&origin=*`;
        if (window.__GLASS_EXTENSION__) {
            if (engineKey === 'bing') url = `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(query)}`;
            else if (engineKey === 'google') url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`;
        }
        fetch(url, {
            signal: controller.signal,
            credentials: 'omit'
        }).then(response => {
            if (!response.ok) throw new Error('Suggestion request failed');
            return response.json();
        }).then(handleSuggestData).catch(() => {
            if (!controller.signal.aborted) handleSuggestFallback();
        });
        return;
    }

    /** @type {any} */ (window)[cbName] = handleSuggestData;
    suggestionScriptTag = script;
    if (!window.__GLASS_EXTENSION__ && script) {
        script.onerror = handleSuggestFallback;

        if (engineKey === 'bing') {
            script.src = `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(query)}&JsonType=callback&JsonCallback=${cbName}`;
        } else if (engineKey === 'google') {
            script.src = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}&callback=${cbName}`;
        }

        document.body.appendChild(script);
    }
}
