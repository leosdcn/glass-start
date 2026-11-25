/** 搜索联想候选生成、下拉面板渲染与网络 JSONP/Fetch 请求调度。 */
import { t, getLocale } from '../core/i18n.js';
import { rankBookmarkSuggestions, tokenizeSearchText } from '../utils/bookmark-search.js';
import { getCategoryCatalog } from '../utils/category-catalog.js';
import { bookmarkUrlKey } from '../utils/bookmark-model.js';
import { CONFIG, DEFAULT_CATEGORIES } from '../config/constants.js';
import { escapeHtml, safeUrl } from '../utils/helpers.js';
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
/** 当前选中的建议列表项索引（-1 为未选中，公共状态 / 供外部与测试读取） */
let selectedSuggestionIdx = -1;
/** @type {ReturnType<typeof setTimeout> | null} 防抖定时器句柄 */
let suggestDebounceTimer = null;
/** 异步建议请求自增计数序列号（测试探针，用于防竞态乱序覆盖） */
let activeSuggestReqId = 0;
/** @type {(() => void) | null} */
let activeSuggestCleanup = null;
/** @type {string | null} */
let suggestionQueryKey = null;

/** @param {string} query */
export function parseSearchLink(query) {
    if (/\s/.test(query)) return null;
    try {
        if (/^https?:\/\/[^/]/i.test(query)) return new URL(query);
        if (/^\/\/[^/]/.test(query)) return new URL('https:' + query);
        return null;
    } catch {
        return null;
    }
}

/** @param {number} index */
export function getSuggestionItem(index) {
    return suggestionItems[index];
}

export function getSelectedSuggestionIdx() { return selectedSuggestionIdx; }
export function getActiveSuggestReqId() { return activeSuggestReqId; }

/**
 * @param {number} index
 * @param {{ keyboard?: boolean }} [options]
 */
export function selectSuggestion(index, { keyboard = false } = {}) {
    const menu = dom.suggestionMenu;
    const input = dom.searchInput;
    selectedSuggestionIdx = suggestionItems[index] ? index : -1;
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
        const activeId = item ? 'sug-opt-' + selectedSuggestionIdx : null;
        if (input.getAttribute('aria-activedescendant') !== activeId) {
            if (activeId) input.setAttribute('aria-activedescendant', activeId);
            else input.removeAttribute('aria-activedescendant');
        }
    }
    if (keyboard && changed && node) {
        const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
        node.scrollIntoView({ block: 'nearest', behavior });
    }
}

/**
 * 处理搜索建议的方向键导航
 * @param {KeyboardEvent} e
 * @returns {boolean} 是否处理了导航按键
 */
export function handleSuggestionKeyNav(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const isNavDown = e.key === 'ArrowDown';
    const isNavUp = e.key === 'ArrowUp';
    if (!isNavDown && !isNavUp) return false;

    const suggestionCount = suggestionItems.length;
    if (!suggestionCount) return false;

    if (isNavDown) {
        e.preventDefault();
        const next = selectedSuggestionIdx + 1;
        selectSuggestion(next < suggestionCount ? next : -1, { keyboard: true });
        return true;
    }

    if (isNavUp) {
        e.preventDefault();
        selectSuggestion(selectedSuggestionIdx < 0 ? suggestionCount - 1 : selectedSuggestionIdx - 1, { keyboard: true });
        return true;
    }

    return false;
}

/**
 * 输入变化立即更新本地候选，网络请求防抖。
 * @param {string} query
 */
export function scheduleSuggestions(query) {
    query = query.trim();
    if (!query) {
        hideSuggestions();
        return;
    }
    const engineKey = state.engine;
    const cacheKey = `${getLocale()}:${engineKey}:${query}`;
    if (suggestionQueryKey === cacheKey) {
        if (selectedSuggestionIdx >= 0) selectSuggestion(-1);
        return;
    }
    if (OverlayStack.topModal()) return;
    fetchSuggestionsForQuery(engineKey, query, true, cacheKey);
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
    const englishBookmarks = window.__GLASS_I18N__?.catalogs?.en?.bookmarks;
    const presetNamesByUrl = new Map(DEFAULT_CATEGORIES.flatMap(category => category.bookmarks.map(({ url, name }) => {
        const englishName = englishBookmarks?.[url]?.name;
        const names = englishName && englishName !== name ? [name, englishName] : [name];
        return [bookmarkUrlKey(url), names.map(name => name.toLowerCase())];
    })));
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
        const nameLower = (bm.name || '').toLowerCase();
        const alternateNamesLower = presetNamesByUrl.get(normUrl)?.filter(name => name !== nameLower);
        const descLower = (bm.desc || '').toLowerCase();
        const cleanUrl = normUrl.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
        candidates.push({
            bm,
            normUrl,
            defaultCat,
            nameLower,
            nameTokens: tokenizeSearchText(nameLower),
            alternateNamesLower,
            alternateNameTokens: alternateNamesLower?.map(tokenizeSearchText),
            descLower,
            urlLower: (bm.url || '').toLowerCase(),
            cleanUrl,
            otherTokens: tokenizeSearchText(`${cleanUrl} ${descLower}`)
        });
    };
    for (const bm of pageData.bookmarks) {
        const key = bookmarkUrlKey(bm.url);
        if (key) addCandidate(bm, key, t('ui.quick.bookmarks'));
    }
    for (const { bm, normUrl, defaultCat } of catalog.entries) addCandidate(bm, normUrl, defaultCat);

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

/**
 * @param {import('../types').BookmarkSuggestion} bm
 * @param {number} idx
 */
function getBookmarkSuggestionHTML(bm, idx) {
    const safeIcon = bm.icon ? safeUrl(bm.icon) : '';
    const iconHtml = (safeIcon && safeIcon !== '#')
        ? `<img src="${safeIcon}" width="20" height="20" class="w-5 h-5 rounded-md object-cover shrink-0 pointer-events-none select-none" alt="" data-hide-on-error="1" draggable="false">`
        : `<svg class="w-5 h-5 text-white/40 shrink-0 pointer-events-none select-none" aria-hidden="true"><use href="#icon-bookmark"/></svg>`;

    return `
        <div id="sug-opt-${idx}"
             role="option" aria-selected="false" 
             data-url="${escapeHtml(bm.url)}"
             data-idx="${idx}"
             class="suggestion-item px-3.5 py-2.5 my-0.5 apple-radius text-sm text-white/90 flex items-center gap-3 glass-interactive cursor-pointer hover:text-white">
            ${iconHtml}
            <div class="truncate flex-1 min-w-0 flex items-center gap-2">
                <span class="truncate font-medium text-white/95">${escapeHtml(bm.name)}</span>
                ${bm.desc ? `<span class="truncate text-xs text-white/45 hidden sm:inline">${escapeHtml(bm.desc)}</span>` : ''}
            </div>
            <span class="text-2xs px-2 py-0.5 apple-radius bg-white/10 border border-white/15 text-white/60 shrink-0">${escapeHtml(bm.category || '')}</span>
        </div>
    `;
}

/** @type {HTMLElement | null} */
let localGroup = null;
/** @type {HTMLElement | null} */
let netGroup = null;
let lastRenderedLocalKey = '';

/** @param {import('../types').BookmarkSuggestion[]} list */
function getLocalListSignature(list) {
    return JSON.stringify(list.map(({ url, name, icon, desc, category }) => [url, name, icon, desc, category]));
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
    if (!suggestionMenu || !searchInput) return;
    const prevIdx = preserveSelection ? selectedSuggestionIdx : -1;
    const maxNetCount = Math.max(0, CONFIG.SUGGEST.MAX_TOTAL_ITEMS - localList.length);
    const safeNetList = netList.slice(0, maxNetCount);
    const localKey = getLocalListSignature(localList);
    const signature = JSON.stringify([isNetLoading, localKey, safeNetList]);
    const isOpen = OverlayStack.has('suggestions');
    if (signature === lastSuggestionsSignature && isOpen) {
        if (!preserveSelection && selectedSuggestionIdx >= 0) selectSuggestion(-1);
        return;
    }
    if (localList.length === 0 && safeNetList.length === 0 && !isNetLoading) {
        hideSuggestions();
        return;
    }
    if (!isOpen && !OverlayStack.push('suggestions', hideSuggestions, searchInput, suggestionMenu)) return;
    suggestionItems = [
        ...localList.map(bm => (/** @type {import('../types').SuggestionBookmarkItem} */ ({ type: 'bookmark', text: bm.name, url: bm.url }))),
        ...safeNetList.map(text => (/** @type {import('../types').SuggestionQueryItem} */ ({ type: 'query', text })))
    ];
    const waitingForOptions = isNetLoading && suggestionItems.length === 0;
    if (waitingForOptions) suggestionMenu.setAttribute('aria-busy', 'true');

    // 确保内部的分组子容器已就绪
    if (!localGroup || !netGroup || !suggestionMenu.contains(localGroup) || !suggestionMenu.contains(netGroup)) {
        localGroup = document.createElement('div');
        localGroup.setAttribute('role', 'group');
        localGroup.setAttribute('aria-label', t('ui.bookmark'));

        netGroup = document.createElement('div');
        netGroup.setAttribute('role', 'group');
        netGroup.setAttribute('aria-label', t('ui.search.suggestions'));

        suggestionMenu.replaceChildren(localGroup, netGroup);
        lastRenderedLocalKey = '';
    }

    // 本地书签分组：仅当本地数据真正变更或首次挂载时才渲染，避免网络联想返回时重新生成节点导致图片闪烁
    if (!isOpen || lastRenderedLocalKey !== localKey) {
        lastRenderedLocalKey = localKey;
        localGroup.innerHTML = localList.map(getBookmarkSuggestionHTML).join('');
    }

    // 网络建议分组：支持从骨架屏平滑更新为联想词，或在无网络结果时清空
    netGroup.setAttribute('aria-hidden', String(safeNetList.length === 0));
    if (safeNetList.length > 0) {
        let netHtml = '';
        let globalIdx = localList.length;
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
        netGroup.innerHTML = netHtml;
    } else if (isNetLoading) {
        let skeletonHtml = '';
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
        netGroup.innerHTML = skeletonHtml;
    } else {
        netGroup.innerHTML = '';
    }

    suggestionNodes = suggestionMenu.querySelectorAll('.suggestion-item');
    lastSuggestionsSignature = signature;
    selectSuggestion(Math.min(prevIdx, suggestionItems.length - 1));
    if (!waitingForOptions) suggestionMenu.removeAttribute('aria-busy');
}

/** 作废未决联想，保留已渲染的候选。 */
export function cancelSuggestionRequest() {
    suggestionQueryKey = null;
    if (suggestDebounceTimer !== null) {
        clearTimeout(suggestDebounceTimer);
        suggestDebounceTimer = null;
    }
    activeSuggestReqId++;
    activeSuggestCleanup?.();
}

/** 收起联想下拉面板并从 OverlayStack 出栈。 */
export function hideSuggestions() {
    suggestionItems = [];
    suggestionNodes = [];
    selectedSuggestionNode = null;
    lastSuggestionsSignature = '';
    lastRenderedLocalKey = '';
    cancelSuggestionRequest();
    const wasOpen = !!OverlayStack.pop('suggestions');
    const suggestionMenu = dom.suggestionMenu;
    const searchInput = dom.searchInput;
    if (suggestionMenu) {
        suggestionMenu.classList.remove('keyboard-nav');
        suggestionMenu.removeAttribute('aria-busy');
        if (wasOpen) {
            // 先关闭交互，等 CSS 隐藏面板后再移除内容，保持退场高度。
            const clearGroups = () => {
                if (OverlayStack.has('suggestions') || getComputedStyle(suggestionMenu).visibility !== 'hidden') return;
                localGroup?.replaceChildren();
                netGroup?.replaceChildren();
            };
            const exit = suggestionMenu.getAnimations().find(animation =>
                'transitionProperty' in animation && animation.transitionProperty === 'visibility');
            if (exit) void exit.finished.then(clearGroups, clearGroups);
            else clearGroups();
        }
    }
    searchInput?.removeAttribute('aria-activedescendant');
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
 * @param {boolean} [deferNetwork]
 */
export function fetchSuggestions(engineKey, query, deferNetwork = false) {
    if (OverlayStack.topModal()) return;
    fetchSuggestionsForQuery(engineKey, query.trim(), deferNetwork);
}

/**
 * @param {string} engineKey
 * @param {string} query 已去首尾空白的查询
 * @param {boolean} deferNetwork
 * @param {string} [queryKey]
 */
function fetchSuggestionsForQuery(engineKey, query, deferNetwork, queryKey) {
    if (!query || parseSearchLink(query)) {
        hideSuggestions();
        return;
    }
    const cacheKey = queryKey ?? `${getLocale()}:${engineKey}:${query}`;
    const sameQuery = suggestionQueryKey === cacheKey;
    const preserveSelection = suggestDebounceTimer !== null && sameQuery;

    // compositionend 后的 input、重复选择当前引擎等入口共享正在进行的请求和列表。
    if (activeSuggestCleanup && sameQuery) return;
    cancelSuggestionRequest();
    const reqId = activeSuggestReqId;
    suggestionQueryKey = cacheKey;
    const localList = getLocalBookmarkSuggestions(query, CONFIG.SUGGEST.MAX_LOCAL_ITEMS);

    const cachedEntry = suggestCache.get(cacheKey);
    if (cachedEntry && (Date.now() - cachedEntry.timestamp < SUGGEST_CACHE_TTL)) {
        renderSuggestions(localList, cachedEntry.list, preserveSelection);
        return;
    }

    const start = () => {
        suggestDebounceTimer = null;
        if (OverlayStack.topModal()) {
            suggestionQueryKey = null;
            return;
        }
        renderSuggestions(localList, [], deferNetwork || preserveSelection, true);
        requestNetworkSuggestions(engineKey, query, cacheKey, localList, reqId);
    };
    if (deferNetwork) {
        if (localList.length || OverlayStack.has('suggestions')) {
            // 防抖期间用骨架替换旧建议，已展开的面板无需重新退场和入场。
            renderSuggestions(localList, [], preserveSelection, true);
        }
        suggestDebounceTimer = setTimeout(start, CONFIG.SUGGEST.DEBOUNCE_MS);
    } else {
        start();
    }
}

/**
 * @param {string} engineKey
 * @param {string} query
 * @param {string} cacheKey
 * @param {import('../types').BookmarkSuggestion[]} localList
 * @param {number} reqId
 */
function requestNetworkSuggestions(engineKey, query, cacheKey, localList, reqId) {
    // 显式使用构建标记，让扩展产物裁掉 JSONP 的创建、注册和清理。
    const cbName = window.__GLASS_EXTENSION__ ? '' : `__glassSuggestCb_${reqId}`;
    const controller = window.__GLASS_EXTENSION__ || engineKey === 'wikipedia' ? new AbortController() : null;
    const script = !window.__GLASS_EXTENSION__ && !controller ? document.createElement('script') : null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeoutTimer = null;

    const cleanup = () => {
        if (timeoutTimer !== null) {
            clearTimeout(timeoutTimer);
            timeoutTimer = null;
        }
        controller?.abort();
        if (!window.__GLASS_EXTENSION__ && script) {
            delete /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window))[cbName];
            script.onerror = null;
            script.remove();
        }
        if (activeSuggestCleanup === cleanup) {
            activeSuggestCleanup = null;
        }
    };

    const handleSuggestFallback = () => {
        cleanup();
        if (reqId !== activeSuggestReqId) return;
        renderSuggestions(localList, [], true);
    };

    activeSuggestCleanup = cleanup;
    timeoutTimer = setTimeout(handleSuggestFallback, CONFIG.SUGGEST.JSONP_TIMEOUT);

    /** @param {any} data */
    const handleSuggestData = data => {
        if (reqId !== activeSuggestReqId) { cleanup(); return; }
        if (!Array.isArray(data)) return handleSuggestFallback();
        const nested = Array.isArray(data[1]);
        if (nested && typeof data[0] !== 'string') return handleSuggestFallback();
        /** @type {unknown[]} */
        const list = nested ? data[1] : data.map(item => item?.phrase ?? item);
        const safeList = list.filter(/** @returns {item is string} */ item => typeof item === 'string' && item.trim().length > 0);
        if ((list.length && !safeList.length) || (!nested && list.length !== safeList.length)) {
            return handleSuggestFallback();
        }
        cleanup();
        suggestCache.delete(cacheKey);
        if (suggestCache.size >= MAX_SUGGEST_CACHE_SIZE) {
            const oldest = suggestCache.keys().next().value;
            if (oldest) suggestCache.delete(oldest);
        }
        const cachedList = safeList.slice(0, CONFIG.SUGGEST.MAX_TOTAL_ITEMS);
        suggestCache.set(cacheKey, { list: cachedList, timestamp: Date.now() });
        renderSuggestions(localList, cachedList, true);
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

    if (!window.__GLASS_EXTENSION__ && script) {
        /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window))[cbName] = handleSuggestData;
        script.onerror = handleSuggestFallback;

        if (engineKey === 'bing') {
            script.src = `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(query)}&JsonType=callback&JsonCallback=${cbName}`;
        } else if (engineKey === 'google') {
            script.src = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}&callback=${cbName}`;
        }

        document.body.appendChild(script);
    }
}
