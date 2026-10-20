/** 搜索引擎切换、书签分级匹配与网络联想；请求序号隔离迟到响应。 */
import { rankBookmarkSuggestions, getFuzzyScore as scoreBookmarkQuery } from '../utils/bookmark-search.js';
export { damerauLevenshteinDistance } from '../utils/bookmark-search.js';
import { getCategoryCatalog, searchUrlKey } from '../utils/category-catalog.js';
import { CONFIG, engines } from '../config/constants.js';
import { escapeHtml, safeUrl, normalizeUrl, storageSet } from '../utils/helpers.js';
import { state, pageData } from '../state/store.js';
import { dom, $ } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';

/** @type {import('../types').SuggestionItem[]} */
let suggestionItems = [];
export function getSuggestionCount() { return suggestionItems.length; }
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
    const nodes = menu?.querySelectorAll('.suggestion-item') || [];
    nodes.forEach((node, i) => {
        node.classList.toggle('active', i === selectedSuggestionIdx);
        node.setAttribute('aria-selected', String(i === selectedSuggestionIdx));
    });
    if (keyboard) menu?.classList.add('keyboard-nav');
    const item = suggestionItems[selectedSuggestionIdx];
    if (input) {
        if (updateInput) input.value = item?.text ?? originalQuery;
        if (item) input.setAttribute('aria-activedescendant', 'sug-opt-' + selectedSuggestionIdx);
        else input.removeAttribute('aria-activedescendant');
    }
    if (keyboard && item) nodes[selectedSuggestionIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
/** @type {HTMLScriptElement | null} */
export let suggestionScriptTag = null;
export let selectedSuggestionIdx = -1;
export let originalQuery = '';
/** @type {ReturnType<typeof setTimeout> | null} */
export let suggestDebounceTimer = null;
export let activeSuggestReqId = 0;
/** @type {(() => void) | null} */
let activeSuggestCleanup = null;
/** @param {number} val */
export function setActiveSuggestReqId(val) {
    activeSuggestReqId = val;
}
/** @param {number} val */
export function setSelectedSuggestionIdx(val) {
    selectedSuggestionIdx = val;
}
/** @param {string} val */
export function setOriginalQuery(val) {
    originalQuery = val;
}

/**
 * 输入防抖与关闭清理共用同一个计时器；执行时读取当前搜索引擎。
 * @param {string} query
 */
export function scheduleSuggestions(query) {
    if (suggestDebounceTimer !== null) {
        clearTimeout(suggestDebounceTimer);
    }
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
    const curEngine = state.engine || 'bing';
    const order = ['bing', 'google', 'wikipedia'];
    /** @type {Record<string, { name: string; isSvg: boolean; svg: string; url: string }>} */
    const engineMap = engines;
    dropdownMenu.innerHTML = order.map(key => {
        const eng = engineMap[key];
        if (!eng) return '';
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
    state.open = !state.open;
    const dropdownMenu = dom.dropdownMenu;
    const engineBtn = dom.engineBtn;
    dropdownMenu?.classList.toggle('active', state.open);
    dropdownMenu?.setAttribute('aria-hidden', (!state.open).toString());
    engineBtn?.setAttribute('aria-expanded', state.open.toString());
    if (state.open) {
        OverlayStack.push('dropdown', closeDropdown);
    } else {
        OverlayStack.pop('dropdown');
    }
}

/**
 * 主动收起搜索引擎下拉菜单并从 OverlayStack 出栈
 * @returns {void}
 */
export function closeDropdown() {
    state.open = false;
    OverlayStack.pop('dropdown');
    const dropdownMenu = dom.dropdownMenu;
    const engineBtn = dom.engineBtn;
    dropdownMenu?.classList.remove('active');
    dropdownMenu?.setAttribute('aria-hidden', 'true');
    engineBtn?.setAttribute('aria-expanded', 'false');
}

/**
 * 设置当前搜索引擎
 * @param {string} key - engines 中的引擎标识
 * @param {boolean} [save=true] - 是否持久化到 localStorage
 */
export function setEngine(key, save = true) {
    /** @type {Record<string, { name: string; isSvg: boolean; svg: string; url: string }>} */
    const engineMap = engines;
    const validEngine = engineMap[key] ? key : 'bing';
    state.engine = validEngine;
    const engineObj = engineMap[validEngine] || engineMap.bing;
    const engineName = dom.engineName;
    const engineBtn = dom.engineBtn;
    const engineIcon = dom.engineIcon;
    const dropdownMenu = dom.dropdownMenu;
    const searchInput = dom.searchInput;

    if (engineName) engineName.textContent = engineObj.name;
    if (engineBtn) {
        engineBtn.setAttribute('aria-label', `选择搜索引擎（当前：${engineObj.name}）`);
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
export function doSearch(queryOverride, newTab = false) {
    const searchInput = dom.searchInput;
    const q = (queryOverride !== undefined ? queryOverride : (searchInput ? searchInput.value : '')).trim();
    if (!q) return;
    hideSuggestions();
    closeDropdown();
    /** @type {Record<string, { name: string; isSvg: boolean; svg: string; url: string }>} */
    const engineMap = engines;
    const engineObj = engineMap[state.engine] || engineMap.bing;
    const targetUrl = engineObj.url + encodeURIComponent(q);
    if (newTab) {
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
    } else {
        window.location.href = targetUrl;
    }
}

/**
 * 打开本站书签 URL（带安全协议校验与域名自动补全）
 * @param {string} url - 目标网址
 * @param {boolean} [newTab=false] - 是否在新标签页打开
 */
export function openBookmarkUrl(url, newTab = false) {
    if (!url) return;
    let trimmed = url.trim();
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
    hideSuggestions();
    closeDropdown();
    if (newTab) {
        window.open(trimmed, '_blank', 'noopener,noreferrer');
    } else {
        window.location.href = trimmed;
    }
}

/**
 * 随机探索/手气不错：从本地书签库中随机挑选并访问一个站点
 * @param {boolean} [newTab=true] - 是否在新标签页打开
 */
let diceAngle = 0;
export function openRandomBookmark(newTab = true) {
    /** @type {import('../types').BookmarkItem[]} */
    const list = [];
    const seen = new Set();
    if (pageData && Array.isArray(pageData.categories)) {
        pageData.categories.forEach(cat => {
            if (Array.isArray(cat.bookmarks)) {
                cat.bookmarks.forEach(bm => {
                    if (bm && bm.url && typeof bm.url === 'string' && !seen.has(bm.url)) {
                        seen.add(bm.url);
                        list.push(bm);
                    }
                });
            }
        });
    }
    if (list.length === 0 && pageData && Array.isArray(pageData.bookmarks)) {
        pageData.bookmarks.forEach(bm => {
            if (bm && bm.url && typeof bm.url === 'string' && !seen.has(bm.url)) {
                seen.add(bm.url);
                list.push(bm);
            }
        });
    }
    if (list.length === 0) return;
    const randomBm = list[Math.floor(Math.random() * list.length)];

    const randomBtn = dom.randomBookmarkBtn;
    if (randomBtn) {
        diceAngle += CONFIG.PHYSICS.DICE_ROTATION_STEP;
        const svg = randomBtn.querySelector('svg');
        if (svg) svg.style.transform = `rotate(${diceAngle}deg)`;
    }

    setTimeout(() => {
        openBookmarkUrl(randomBm.url, newTab);
    }, CONFIG.TIMERS.STAGGER_OPEN);
}

/** @type {import('../types').SearchCandidateModel | null} */
let cachedSearchCandidates = null;
/** @type {import('../types').BookmarkItem[] | null} */
let lastCandidatesBookmarksRef = null;
/** @type {import('../types').CategoryCatalog | null} */
let lastCandidatesCatalogRef = null;

export function invalidateSearchCandidates() {
    cachedSearchCandidates = null;
    lastCandidatesBookmarksRef = null;
    lastCandidatesCatalogRef = null;
}

export function getSearchCandidates() {
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
    if (pageData && Array.isArray(pageData.bookmarks)) {
        for (const bm of pageData.bookmarks) {
            if (bm && bm.url) addCandidate(bm, searchUrlKey(bm.url), '快捷书签');
        }
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
export function getLocalBookmarkSuggestions(query, limit = CONFIG.SUGGEST.MAX_LOCAL_ITEMS) {
    return rankBookmarkSuggestions(query, getSearchCandidates(), CONFIG.SUGGEST, limit);
}

/**
 * @param {string} query
 * @param {string} target
 * @returns {number}
 */
export function getFuzzyScore(query, target) {
    return scoreBookmarkQuery(query, target, CONFIG.SUGGEST.FUZZY);
}

/**
 * 渲染搜索联想下拉面板
 * @param {import('../types').BookmarkSuggestion[]} [localList]
 * @param {string[]} [netList]
 * @param {boolean} [preserveSelection=false]
 * @param {boolean} [isNetLoading=false]
 * @returns {void}
 */
export function renderSuggestions(localList = [], netList = [], preserveSelection = false, isNetLoading = false) {
    const suggestionMenu = dom.suggestionMenu;
    const searchInput = dom.searchInput;
    if (!suggestionMenu) return;
    const prevIdx = preserveSelection ? selectedSuggestionIdx : -1;
    const maxNetCount = Math.max(0, CONFIG.SUGGEST.MAX_TOTAL_ITEMS - (localList ? localList.length : 0));
    const safeNetList = (netList || []).slice(0, maxNetCount);
    suggestionItems = [
        ...(localList || []).map(bm => (/** @type {import('../types').SuggestionBookmarkItem} */ ({type: 'bookmark', text: bm.name, url: bm.url}))),
        ...safeNetList.map(text => (/** @type {import('../types').SuggestionQueryItem} */ ({type: 'query', text})))
    ];
    selectedSuggestionIdx = -1;

    if ((!localList || localList.length === 0) && (!netList || netList.length === 0) && !isNetLoading) {
        hideSuggestions();
        return;
    }

    let html = '';
    let globalIdx = 0;

    /**
     * @param {string} title
     * @param {boolean} [isFirst=false]
     */
    const renderSectionHeader = (title, isFirst = false) => `
        <div class="suggestion-section-header mx-3.5 px-0 ${isFirst ? 'pt-1.5' : 'pt-2'} pb-1.5 mb-1 text-2xs font-medium tracking-wider text-white/40 uppercase select-none">
            <span class="inline-block pb-0.5">${title}</span>
        </div>
    `;

    // 本地书签分组
    if (localList && localList.length > 0) {
        html += renderSectionHeader('书签', true);
        localList.forEach(bm => {
            const safeIcon = bm.icon ? safeUrl(bm.icon) : '';
            const iconHtml = (safeIcon && safeIcon !== '#')
                ? `<img src="${safeIcon}" width="20" height="20" decoding="async" class="w-5 h-5 rounded-md object-cover shrink-0 pointer-events-none select-none" alt="" data-hide-on-error="1" draggable="false">`
                : `<svg class="w-5 h-5 text-white/40 shrink-0 pointer-events-none select-none" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"/></svg>`;
            
            html += `
                <div id="sug-opt-${globalIdx}"
                     role="option" aria-selected="false" 
                     data-type="bookmark" 
                     data-url="${escapeHtml(bm.url)}" 
                     data-suggestion="${escapeHtml(bm.name)}" 
                     data-idx="${globalIdx}"
                     class="suggestion-item group px-3.5 py-2.5 my-0.5 apple-radius text-sm text-white/90 flex items-center gap-3 glass-interactive cursor-pointer hover:text-white">
                    ${iconHtml}
                    <div class="truncate flex-1 min-w-0 flex items-center gap-2">
                        <span class="truncate font-medium text-white/95">${escapeHtml(bm.name)}</span>
                        ${bm.desc ? `<span class="truncate text-xs text-white/45 hidden sm:inline">${escapeHtml(bm.desc)}</span>` : ''}
                    </div>
                    <span class="text-2xs px-2 py-0.5 apple-radius bg-white/10 border border-white/15 text-white/60 shrink-0">${escapeHtml(bm.category || '')}</span>
                </div>
            `;
            globalIdx++;
        });
    }

    // 网络建议分组

    if (safeNetList.length > 0) {
        if (localList && localList.length > 0) {
            html += renderSectionHeader('搜索', false);
        }
        safeNetList.forEach(item => {
            html += `
                <div id="sug-opt-${globalIdx}"
                     role="option" aria-selected="false" 
                     data-type="query" 
                     data-suggestion="${escapeHtml(item)}" 
                     data-idx="${globalIdx}"
                     class="suggestion-item group px-3.5 py-2.5 my-0.5 apple-radius text-sm text-white/85 flex items-center gap-3 glass-interactive cursor-pointer hover:text-white">
                    <svg class="w-5 h-5 text-white/40 group-hover:text-white/80 shrink-0 pointer-events-none select-none transition-colors" aria-hidden="true"><use href="#icon-search"/></svg>
                    <span class="truncate flex-1 min-w-0 font-normal tracking-wide">${escapeHtml(item)}</span>
                </div>
            `;
            globalIdx++;
        });
    } else if (isNetLoading) {
        if (localList && localList.length > 0) {
            html += renderSectionHeader('搜索', false);
        }
        const skeletonCount = Math.max(1, CONFIG.SUGGEST.MAX_TOTAL_ITEMS - (localList ? localList.length : 0));
        for (let k = 0; k < skeletonCount; k++) {
            const widthClass = k % 2 === 0 ? 'w-44' : 'w-28';
            html += `
                <div class="px-3.5 py-2.5 my-0.5 apple-radius flex items-center gap-3 select-none pointer-events-none animate-pulse">
                    <svg class="w-5 h-5 text-white/20 shrink-0 pointer-events-none select-none" aria-hidden="true"><use href="#icon-search"/></svg>
                    <div class="h-5 bg-white/15 apple-radius ${widthClass}"></div>
                </div>
            `;
        }
    }

    const range = document.createRange();
    const fragment = range.createContextualFragment(html);
    suggestionMenu.replaceChildren(fragment);
    suggestionMenu.classList.add('active');
    suggestionMenu.setAttribute('aria-hidden', 'false');
    if (searchInput) searchInput.setAttribute('aria-expanded', 'true');
    OverlayStack.push('suggestions', hideSuggestions);

    if (prevIdx >= 0) selectSuggestion(Math.min(prevIdx, suggestionItems.length - 1));
    else searchInput?.removeAttribute('aria-activedescendant');
}

/**
 * 收起联想下拉面板、作废未决网络请求并从 OverlayStack 出栈
 * @returns {void}
 */
export function hideSuggestions() {
    suggestionItems = [];
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

    activeSuggestCleanup?.();
    const localList = getLocalBookmarkSuggestions(query, CONFIG.SUGGEST.MAX_LOCAL_ITEMS);
    renderSuggestions(localList, [], false, true);

    activeSuggestReqId++;
    const reqId = activeSuggestReqId;

    const cbName = `__glassSuggestCb_${reqId}`;
    const controller = engineKey === 'wikipedia' ? new AbortController() : null;
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
        if (activeSuggestCleanup === cleanup) activeSuggestCleanup = null;
    };

    const handleSuggestFallback = () => {
        cleanup();
        if (reqId !== activeSuggestReqId) return;
        if (localList && localList.length > 0) {
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
        const safeList = (Array.isArray(list) ? list : []).filter(item => typeof item === 'string' && item.trim().length > 0);
        const netList = safeList.slice(0, maxNetCount);
        if (localList.length > 0 || netList.length > 0) {
            renderSuggestions(localList, netList, true);
        } else {
            hideSuggestions();
        }
    };

    if (controller) {
        // Wikipedia 支持 CORS；复用现有超时、清理和请求序号守卫。
        fetch(`https://zh.wikipedia.org/w/api.php?action=opensearch&format=json&search=${encodeURIComponent(query)}&origin=*`, {
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
    if (script) {
        script.onerror = handleSuggestFallback;

        if (engineKey === 'bing') {
            script.src = `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(query)}&JsonType=callback&JsonCallback=${cbName}`;
        } else if (engineKey === 'google') {
            script.src = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}&callback=${cbName}`;
        }

        document.body.appendChild(script);
    }
}
