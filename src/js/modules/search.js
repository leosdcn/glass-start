/**
 * ==============================================================================
 * Glass Start — 智能搜索与建议词引擎 (src/js/modules/search.js)
 * ==============================================================================
 * 
 * 核心功能：
 * 1. 搜索引擎切换与下拉面板 (toggleDropdown / closeDropdown / setEngine / renderEngineDropdown)
 * 2. 搜索执行与本站书签安全打开 (doSearch / openBookmarkUrl / openRandomBookmark)
 * 3. Damerau-Levenshtein 编辑距离与书签三级模糊检索匹配 (damerauLevenshteinDistance / getFuzzyScore / getLocalBookmarkSuggestions)
 * 4. 实时搜索联想与防竞态调度 (fetchSuggestions / renderSuggestions / hideSuggestions)
 */
import { CONFIG, engines } from '../config/constants.js';
import { escapeHtml, safeUrl, normalizeUrl, storageSet } from '../utils/helpers.js';
import { state, pageData } from '../state/store.js';
import { dom, $ } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';

export let suggestionScriptTag = null;
export let selectedSuggestionIdx = -1;
export let originalQuery = '';
export let suggestDebounceTimer = null;
export let activeSuggestReqId = 0;
export function setActiveSuggestReqId(val) {
    activeSuggestReqId = val;
}
export function setSelectedSuggestionIdx(val) {
    selectedSuggestionIdx = val;
}
export function setOriginalQuery(val) {
    originalQuery = val;
}

/**
 * 渲染搜索引擎下拉切换菜单项 HTML
 * @returns {void}
 */
export function renderEngineDropdown() {
    const dropdownMenu = dom.dropdownMenu || $('dropdownMenu');
    if (!dropdownMenu) return;
    const curEngine = state.engine || 'bing';
    const order = ['bing', 'google', 'wikipedia'];
    dropdownMenu.innerHTML = order.map(key => {
        const eng = engines[key];
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
    const dropdownMenu = dom.dropdownMenu || $('dropdownMenu');
    const engineBtn = dom.engineBtn || $('engineBtn');
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
    const dropdownMenu = dom.dropdownMenu || $('dropdownMenu');
    const engineBtn = dom.engineBtn || $('engineBtn');
    dropdownMenu?.classList.remove('active');
    dropdownMenu?.setAttribute('aria-hidden', 'true');
    engineBtn?.setAttribute('aria-expanded', 'false');
}

/**
 * 设置当前搜索引擎
 * @param {string} key - 引擎标识（bing/google/wikipedia）
 * @param {boolean} [save=true] - 是否持久化到 localStorage
 */
export function setEngine(key, save = true) {
    const validEngine = engines[key] ? key : 'bing';
    state.engine = validEngine;
    const engineObj = engines[validEngine] || engines.bing;
    const engineName = dom.engineName || $('engineName');
    const engineBtn = dom.engineBtn || $('engineBtn');
    const engineIcon = dom.engineIcon || $('engineIcon');
    const dropdownMenu = dom.dropdownMenu || $('dropdownMenu');
    const searchInput = dom.searchInput || $('searchInput');

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
            btn.setAttribute('aria-checked', btn.dataset.engine === validEngine ? 'true' : 'false');
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
    const searchInput = dom.searchInput || $('searchInput');
    const q = (queryOverride !== undefined ? queryOverride : (searchInput ? searchInput.value : '')).trim();
    if (!q) return;
    hideSuggestions();
    closeDropdown();
    const engineObj = engines[state.engine] || engines.bing;
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

    const randomBtn = dom.randomBookmarkBtn || $('randomBookmarkBtn');
    if (randomBtn) {
        diceAngle += CONFIG.PHYSICS.DICE_ROTATION_STEP;
        const svg = randomBtn.querySelector('svg');
        if (svg) svg.style.transform = `rotate(${diceAngle}deg)`;
    }

    setTimeout(() => {
        openBookmarkUrl(randomBm.url, newTab);
    }, CONFIG.TIMERS.STAGGER_OPEN);
}

/**
 * 计算 Damerau-Levenshtein 编辑距离（支持插入、删除、替换与相邻字符易位/拼错容错）
 * @param {string} a - 源字符串
 * @param {string} b - 目标字符串
 * @returns {number} 最小编辑距离步数
 */
export function damerauLevenshteinDistance(a, b) {
    const al = a.length, bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    const dp = Array.from({ length: al + 1 }, () => typeof Int32Array !== 'undefined' ? new Int32Array(bl + 1) : new Array(bl + 1).fill(0));
    for (let i = 0; i <= al; i++) dp[i][0] = i;
    for (let j = 0; j <= bl; j++) dp[0][j] = j;

    for (let i = 1; i <= al; i++) {
        for (let j = 1; j <= bl; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,       // deletion
                dp[i][j - 1] + 1,       // insertion
                dp[i - 1][j - 1] + cost // substitution
            );
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost); // transposition
            }
        }
    }
    return dp[al][bl];
}

/**
 * 计算关键词 q 与目标文本（或书签）的前缀拼写容错 / 模糊匹配得分 (Token Prefix Fuzzy Score)
 * @param {string} q - 用户输入的查询关键词
 * @param {string|Object} target - 目标字符串或书签对象
 * @returns {number} 匹配惩罚得分（越小越精确，未匹配返回 Infinity）
 */
export function getFuzzyScore(q, target) {
    const query = (q || '').trim().toLowerCase();
    if (query.length < CONFIG.SUGGEST.FUZZY.MIN_QUERY_LEN) return Infinity;
    const rawText = (typeof target === 'string' ? target : `${target?.name || ''} ${target?.url || ''} ${target?.desc || ''}`).toLowerCase();
    if (!rawText.trim()) return Infinity;
    const rawTokens = rawText.split(/\s+/);
    const wordTokens = rawText.split(/[^a-z0-9\u4e00-\u9fff]+/);
    const tokens = Array.from(new Set([...rawTokens, ...wordTokens].filter(t => t.length > 0)));

    const subQueries = query.split(/\s+/).filter(sq => sq.length > 0);
    if (subQueries.length === 0) return Infinity;

    let totalDist = 0;

    for (const sq of subQueries) {
        if (sq.length < 2) continue;
        const maxDist = sq.length <= CONFIG.SUGGEST.FUZZY.SHORT_QUERY_LEN ? CONFIG.SUGGEST.FUZZY.MAX_DIST_SHORT : CONFIG.SUGGEST.FUZZY.MAX_DIST_LONG;
        let minSubDist = Infinity;

        for (const token of tokens) {
            if (token.length < Math.max(2, sq.length - 1)) continue;
            const minLen = Math.max(2, sq.length - 1);
            const maxLen = Math.min(token.length, sq.length + 1);
            for (let len = minLen; len <= maxLen; len++) {
                const prefix = token.substring(0, len);
                const dist = damerauLevenshteinDistance(sq, prefix);
                if (dist < minSubDist) {
                    minSubDist = dist;
                    if (minSubDist === 0) break;
                }
            }
            if (minSubDist === 0) break;
        }

        if (minSubDist > maxDist) {
            return Infinity;
        }
        totalDist += minSubDist;
    }

    const maxTotalDist = query.length <= CONFIG.SUGGEST.FUZZY.SHORT_QUERY_LEN ? CONFIG.SUGGEST.FUZZY.MAX_DIST_SHORT : CONFIG.SUGGEST.FUZZY.MAX_DIST_LONG;
    return totalDist <= maxTotalDist ? totalDist : Infinity;
}

let cachedSearchCandidates = null;
let lastSearchCategoriesRef = null;
let lastSearchBookmarksRef = null;

export function getSearchCandidates() {
    if (cachedSearchCandidates && pageData && pageData.categories === lastSearchCategoriesRef && pageData.bookmarks === lastSearchBookmarksRef) {
        return cachedSearchCandidates;
    }
    lastSearchCategoriesRef = pageData ? pageData.categories : null;
    lastSearchBookmarksRef = pageData ? pageData.bookmarks : null;

    const toNormUrl = u => (u || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    const urlToCategoryMap = new Map();
    if (pageData && Array.isArray(pageData.categories)) {
        for (const cat of pageData.categories) {
            if (!cat || !Array.isArray(cat.bookmarks)) continue;
            for (const bm of cat.bookmarks) {
                if (bm && bm.url) {
                    const normUrl = toNormUrl(bm.url);
                    if (!urlToCategoryMap.has(normUrl)) {
                        urlToCategoryMap.set(normUrl, cat.name);
                    }
                }
            }
        }
    }

    const candidates = [];
    const seenNormUrls = new Set();
    if (pageData && Array.isArray(pageData.bookmarks)) {
        for (const bm of pageData.bookmarks) {
            if (bm && bm.url) {
                const normUrl = toNormUrl(bm.url);
                if (!seenNormUrls.has(normUrl)) {
                    seenNormUrls.add(normUrl);
                    candidates.push({ bm, normUrl, defaultCat: '快捷书签' });
                }
            }
        }
    }
    if (pageData && Array.isArray(pageData.categories)) {
        for (const cat of pageData.categories) {
            if (!cat || !Array.isArray(cat.bookmarks)) continue;
            for (const bm of cat.bookmarks) {
                if (bm && bm.url) {
                    const normUrl = toNormUrl(bm.url);
                    if (!seenNormUrls.has(normUrl)) {
                        seenNormUrls.add(normUrl);
                        candidates.push({ bm, normUrl, defaultCat: cat.name || '分类书签' });
                    }
                }
            }
        }
    }

    cachedSearchCandidates = { candidates, urlToCategoryMap };
    return cachedSearchCandidates;
}

/**
 * 在本地全站书签中根据关键词检索匹配项（包含快捷书签与分类书签）
 * @param {string} query - 搜索关键词
 * @param {number} [limit=2] - 最多返回匹配条数
 * @returns {Array<{type: string, name: string, url: string, icon: string, desc: string, category: string}>}
 */
export function getLocalBookmarkSuggestions(query, limit = CONFIG.SUGGEST.MAX_LOCAL_ITEMS) {
    const q = (query || '').trim().toLowerCase();
    if (!q || !/[a-z0-9\u4e00-\u9fff]/.test(q)) return [];
    const isFuzzyEligible = q.length >= CONFIG.SUGGEST.FUZZY.MIN_QUERY_LEN;

    const { candidates: allCandidates, urlToCategoryMap } = getSearchCandidates();
    const matches = [];

    for (let idx = 0; idx < allCandidates.length; idx++) {
        const { bm, normUrl, defaultCat } = allCandidates[idx];
        const bmName = (bm.name || '').toLowerCase();
        const bmDesc = (bm.desc || '').toLowerCase();
        const bmUrl = (bm.url || '').toLowerCase();
        const realCat = urlToCategoryMap.get(normUrl) || defaultCat;

        let tier = Infinity;

        if (bmName === q) {
            tier = CONFIG.SUGGEST.TIERS.EXACT_NAME;
        } else if (bmName.startsWith(q)) {
            tier = CONFIG.SUGGEST.TIERS.PREFIX_NAME;
        } else if (bmName.includes(q)) {
            tier = CONFIG.SUGGEST.TIERS.SUBSTRING_NAME;
        } else if (bmUrl.includes(q) || normUrl.includes(q)) {
            tier = CONFIG.SUGGEST.TIERS.URL_MATCH;
        } else if (bmDesc.includes(q)) {
            tier = CONFIG.SUGGEST.TIERS.DESC_MATCH;
        } else if (isFuzzyEligible) {
            const nameFuzzyScore = getFuzzyScore(q, bm.name || '');
            if (nameFuzzyScore !== Infinity) {
                tier = CONFIG.SUGGEST.TIERS.FUZZY_NAME_BASE + nameFuzzyScore;
            } else {
                const otherFuzzyScore = getFuzzyScore(q, `${normUrl} ${bm.desc || ''}`);
                if (otherFuzzyScore !== Infinity) {
                    tier = CONFIG.SUGGEST.TIERS.FUZZY_OTHER_BASE + otherFuzzyScore;
                }
            }
        }

        if (tier !== Infinity) {
            matches.push({
                tier,
                idx,
                item: {
                    type: 'bookmark',
                    name: bm.name || '未命名书签',
                    url: bm.url,
                    icon: bm.icon || '',
                    desc: bm.desc || '',
                    category: realCat
                }
            });
        }
    }

    matches.sort((a, b) => (a.tier - b.tier) || (a.idx - b.idx));
    return matches.slice(0, limit).map(m => m.item);
}

/**
 * 渲染搜索联想下拉面板
 * @param {Array<Object>} [localList=[]]
 * @param {Array<string>} [netList=[]]
 * @param {boolean} [preserveSelection=false]
 * @param {boolean} [isNetLoading=false]
 * @returns {void}
 */
export function renderSuggestions(localList = [], netList = [], preserveSelection = false, isNetLoading = false) {
    const suggestionMenu = dom.suggestionMenu || $('suggestionMenu');
    const searchInput = dom.searchInput || $('searchInput');
    if (!suggestionMenu) return;
    const prevIdx = preserveSelection ? selectedSuggestionIdx : -1;
    selectedSuggestionIdx = -1;

    if ((!localList || localList.length === 0) && (!netList || netList.length === 0) && !isNetLoading) {
        hideSuggestions();
        return;
    }

    let html = '';
    let globalIdx = 0;

    const renderSectionHeader = (title, isFirst = false) => `
        <div class="suggestion-section-header mx-3.5 px-0 ${isFirst ? 'pt-1.5' : 'pt-2'} pb-1.5 mb-1 text-2xs font-medium tracking-wider text-white/40 uppercase select-none">
            <span class="inline-block pb-0.5">${title}</span>
        </div>
    `;

    // 书签分组（最多 2 条）
    if (localList && localList.length > 0) {
        html += renderSectionHeader('书签', true);
        localList.forEach(bm => {
            const iconHtml = bm.icon 
                ? `<img src="${safeUrl(bm.icon)}" width="20" height="20" decoding="async" class="w-5 h-5 rounded-md object-cover shrink-0 pointer-events-none select-none" alt="" data-hide-on-error="1" draggable="false">`
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
                    <span class="text-2xs px-2 py-0.5 apple-radius bg-white/10 border border-white/15 text-white/60 shrink-0">${escapeHtml(bm.category)}</span>
                </div>
            `;
            globalIdx++;
        });
    }

    // 网络建议分组
    const maxNetCount = Math.max(0, CONFIG.SUGGEST.MAX_TOTAL_ITEMS - (localList ? localList.length : 0));
    const safeNetList = (netList || []).slice(0, maxNetCount);

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
                    <svg class="w-5 h-5 text-white/40 group-hover:text-white/80 shrink-0 pointer-events-none select-none transition" aria-hidden="true"><use href="#icon-search"/></svg>
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

    if (prevIdx >= 0) {
        const items = suggestionMenu.querySelectorAll('.suggestion-item');
        if (items.length > 0) {
            const validIdx = Math.min(prevIdx, items.length - 1);
            selectedSuggestionIdx = validIdx;
            items[validIdx].classList.add('active');
            items[validIdx].setAttribute('aria-selected', 'true');
            if (searchInput) {
                searchInput.setAttribute('aria-activedescendant', `sug-opt-${validIdx}`);
                if (items[validIdx].dataset.suggestion) {
                    searchInput.value = items[validIdx].dataset.suggestion;
                }
            }
        } else {
            selectedSuggestionIdx = -1;
            if (searchInput) {
                searchInput.removeAttribute('aria-activedescendant');
                if (typeof originalQuery === 'string') {
                    searchInput.value = originalQuery;
                }
            }
        }
    } else if (searchInput) {
        searchInput.removeAttribute('aria-activedescendant');
    }
}

/**
 * 收起联想下拉面板、作废未决网络请求并从 OverlayStack 出栈
 * @returns {void}
 */
export function hideSuggestions() {
    if (suggestDebounceTimer) {
        clearTimeout(suggestDebounceTimer);
        suggestDebounceTimer = null;
    }
    activeSuggestReqId++;
    if (suggestionScriptTag) {
        suggestionScriptTag.onerror = null;
        suggestionScriptTag.remove();
        suggestionScriptTag = null;
    }
    OverlayStack.pop('suggestions');
    const suggestionMenu = dom.suggestionMenu || $('suggestionMenu');
    const searchInput = dom.searchInput || $('searchInput');
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
    query = (query || '').trim();
    if (!query) {
        hideSuggestions();
        return;
    }

    const localList = getLocalBookmarkSuggestions(query, CONFIG.SUGGEST.MAX_LOCAL_ITEMS);
    renderSuggestions(localList, [], false, true);

    activeSuggestReqId++;
    const reqId = activeSuggestReqId;

    if (suggestionScriptTag) {
        suggestionScriptTag.onerror = null;
        suggestionScriptTag.remove();
        suggestionScriptTag = null;
    }

    const cbName = `__glassSuggestCb_${reqId}`;
    let timeoutTimer = null;

    const cleanup = () => {
        if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            timeoutTimer = null;
        }
        try { delete window[cbName]; } catch {}
        if (suggestionScriptTag) {
            suggestionScriptTag.onerror = null;
            suggestionScriptTag.remove();
            suggestionScriptTag = null;
        }
    };

    const handleSuggestFallback = () => {
        cleanup();
        if (localList && localList.length > 0) {
            renderSuggestions(localList, [], true, false);
        } else {
            hideSuggestions();
        }
    };

    timeoutTimer = setTimeout(() => {
        if (reqId === activeSuggestReqId) {
            handleSuggestFallback();
        }
    }, CONFIG.SUGGEST.JSONP_TIMEOUT);

    window[cbName] = function(data) {
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

    const script = document.createElement('script');
    suggestionScriptTag = script;
    script.onerror = handleSuggestFallback;

    if (engineKey === 'bing') {
        script.src = `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(query)}&JsonType=callback&JsonCallback=${cbName}`;
    } else if (engineKey === 'google') {
        script.src = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}&callback=${cbName}`;
    } else if (engineKey === 'wikipedia') {
        script.src = `https://zh.wikipedia.org/w/api.php?action=opensearch&format=json&search=${encodeURIComponent(query)}&callback=${cbName}`;
    }

    document.body.appendChild(script);
}
