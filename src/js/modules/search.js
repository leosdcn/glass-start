/** 搜索引擎切换、表单提交、URL/书签跳转与以图搜图调度；候选联想见 search-suggestions.js。 */
import { t, getLocale, localizeBookmarkUrl } from '../core/i18n.js';
import { CONFIG, engines } from '../config/constants.js';
import { getDefaultEngine, IMAGE_SEARCH_LINKS, normalizeEngine } from '../config/engines.js';
import { escapeHtml } from '../utils/helpers.js';
import { storageSet } from '../utils/storage.js';
import { state } from '../state/store.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';
import { checkImageLink, getImageSearchEngine, uploadImageSearch } from './image-search.js';
import { getSuggestionItem, hideSuggestions, parseSearchLink } from './search-suggestions.js';

let searchSubmissionId = 0;

export function cancelSearchSubmission() {
    searchSubmissionId++;
}

/** @param {number} id @param {string} inputValue */
function canFinishSearch(id, inputValue) {
    return id === searchSubmissionId && (dom.searchInput?.value ?? '') === inputValue &&
        !state.editOpen && !OverlayStack.topModal();
}

/**
 * @param {number} index
 * @param {boolean} [newTab]
 */
export function activateSuggestion(index, newTab) {
    const submissionId = ++searchSubmissionId;
    const inputValue = dom.searchInput?.value ?? '';
    if (!canFinishSearch(submissionId, inputValue)) return;
    const item = getSuggestionItem(index);
    if (item?.type === 'bookmark') openBookmarkUrl(item.url, newTab);
    else void doSearch(submissionId, inputValue, item?.text, newTab);
}

/**
 * 渲染搜索引擎下拉切换菜单项 HTML
 * @returns {void}
 */
export function renderEngineDropdown() {
    const dropdownMenu = dom.dropdownMenu;
    if (!dropdownMenu) return;
    const curEngine = state.engine || getDefaultEngine();
    dropdownMenu.innerHTML = Object.entries(engines).map(([key, eng]) => {
        const isChecked = key === curEngine;
        const iconHtml = `<span class="size-5 aspect-square shrink-0 rounded pointer-events-none select-none flex items-center justify-center">${eng.svg}</span>`;
        return `<button type="button" data-engine="${key}" role="menuitemradio" aria-checked="${isChecked}" class="w-full flex items-center gap-3 px-3 py-2.5 apple-radius hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 glass-interactive text-left text-sm select-none">
            ${iconHtml} ${escapeHtml(eng.name)}
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
    if (!dropdownMenu || !engineBtn) return;
    if (OverlayStack.has('dropdown')) {
        closeDropdown();
        return;
    }
    if (!OverlayStack.push('dropdown', closeDropdown, engineBtn, dropdownMenu)) return;
    const activeItem = /** @type {HTMLElement | null} */ (dropdownMenu.querySelector('[data-engine][aria-checked="true"]') || dropdownMenu.querySelector('[data-engine]'));
    activeItem?.focus();
}

/**
 * 主动收起搜索引擎下拉菜单并从 OverlayStack 出栈
 * @returns {void}
 */
export function closeDropdown() {
    OverlayStack.pop('dropdown');
}

/**
 * 设置当前搜索引擎
 * @param {unknown} key - engines 中的引擎标识或已存储的偏好
 * @param {boolean} [save=true] - 是否持久化到 localStorage
 */
export function setEngine(key, save = true) {
    /** @type {Record<string, { name: string; svg: string; url: string }>} */
    const engineMap = engines;
    const validEngine = normalizeEngine(key);
    if (validEngine !== state.engine) cancelSearchSubmission();
    state.engine = validEngine;
    if (dom.imageSearchStatus) dom.imageSearchStatus.textContent = '';
    const engineObj = engineMap[validEngine] || engineMap[getDefaultEngine()];
    const engineName = dom.engineName;
    const engineBtn = dom.engineBtn;
    const engineIcon = dom.engineIcon;
    const dropdownMenu = dom.dropdownMenu;

    if (engineName && engineName.textContent !== engineObj.name) engineName.textContent = engineObj.name;
    if (engineBtn) {
        const label = t('engine.current', { name: engineObj.name });
        if (engineBtn.getAttribute('aria-label') !== label) engineBtn.setAttribute('aria-label', label);
    }
    if (engineIcon && engineIcon.dataset.renderedEngine !== validEngine) {
        engineIcon.innerHTML = engineObj.svg;
        engineIcon.dataset.renderedEngine = validEngine;
    }
    if (dropdownMenu) {
        dropdownMenu.querySelectorAll('[role="menuitemradio"]').forEach(btn => {
            if (!(btn instanceof HTMLElement)) return;
            const checked = String(btn.dataset.engine === validEngine);
            if (btn.getAttribute('aria-checked') !== checked) btn.setAttribute('aria-checked', checked);
        });
    }
    if (save) storageSet(CONFIG.KEYS.PREFERRED_ENGINE, validEngine);
}

/** @param {string} url @param {boolean} newTab */
function navigateToUrl(url, newTab) {
    if (newTab) {
        window.open(url, '_blank', 'noopener,noreferrer');
    } else {
        hideSuggestions();
        window.location.href = url;
    }
}

/**
 * 执行搜索
 * @param {number} submissionId
 * @param {string} inputValue
 * @param {string} [queryOverride] - 可选直接传入建议词
 * @param {boolean} [newTab=false] - 是否在新标签页中打开
 */
async function doSearch(submissionId, inputValue, queryOverride, newTab = false) {
    const q = (queryOverride ?? inputValue).trim();
    if (!q) return;
    closeDropdown();
    const engineObj = engines[state.engine] || engines[getDefaultEngine()];
    const link = queryOverride === undefined ? parseSearchLink(q) : null;
    let targetUrl = link?.href ?? engineObj.url + encodeURIComponent(q);
    if (link && !link.username && !link.password) {
        const imageEngine = getImageSearchEngine();
        const isImage = /\.(?:avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(link.pathname)
            || await checkImageLink(link.href);
        if (isImage) {
            const destination = new URL(IMAGE_SEARCH_LINKS[imageEngine]);
            if (imageEngine === 'bing') {
                destination.searchParams.set('q', 'imgurl:' + link.href);
            } else {
                destination.searchParams.set('url', link.href);
                destination.searchParams.set('hl', getLocale());
            }
            targetUrl = destination.href;
        }
    }
    if (!canFinishSearch(submissionId, inputValue)) return;
    navigateToUrl(targetUrl, newTab);
}

/** @param {'bing' | 'google'} engine @param {HTMLInputElement} input */
export async function submitImageSearch(engine, input) {
    const file = input.files?.[0];
    if (!file) return;
    const submissionId = ++searchSubmissionId;
    const inputValue = dom.searchInput?.value ?? '';
    input.value = '';
    const isCurrent = () => canFinishSearch(submissionId, inputValue);
    if (!isCurrent()) return;
    await uploadImageSearch(engine, input, file, isCurrent);
}

/**
 * 打开本站书签 URL（带安全协议校验与域名自动补全）
 * @param {string} url - 目标网址
 * @param {boolean} [newTab=false] - 是否在新标签页打开
 */
function openBookmarkUrl(url, newTab = false) {
    if (!url) return;
    let trimmed = localizeBookmarkUrl(url.trim());
    if (trimmed.startsWith('//')) trimmed = 'https:' + trimmed;
    if (/^(javascript|data|vbscript|file|blob):/i.test(trimmed)) {
        console.warn('⚠️ 拦截高危伪协议书签 URL:', trimmed);
        return;
    }
    if (!/^(https?:\/\/|\/(?!\/)|\.\/|#)/i.test(trimmed)) {
        if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(trimmed)) {
            trimmed = 'https://' + trimmed;
        } else {
            console.warn('⚠️ 拦截非安全协议书签 URL:', trimmed);
            return;
        }
    }
    closeDropdown();
    navigateToUrl(trimmed, newTab);
}
