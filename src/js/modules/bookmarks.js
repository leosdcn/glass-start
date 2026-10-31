import { localizeBookmarkUrl } from '../core/i18n.js';
/** 书签派生与迁移、快捷书签和分类导航渲染、图标加载与回退。 */
import { CONFIG, DEFAULT_BOOKMARKS, DEFAULT_CATEGORIES } from '../config/constants.js';
import {
    escapeHtml,
    safeUrl,
    normalizeUrl,
    normalizeBookmark,
    deriveNameFromUrl,
    faviconFromUrl,
    handleFaviconFailure,
    createLetterBadgeHtml,
    evictFaviconCache,
    checkImageReady,
    storageGet,
    storageSet,
    storageRemove
} from '../utils/helpers.js';
import { pageData, state } from '../state/store.js';
import { dom } from '../state/dom.js';

import { getCategoryCatalog } from '../utils/category-catalog.js';

// Normalize old metadata keys in memory; persistence uses shared URLs on the next save.
function getCustomMeta() {
    return Object.fromEntries(Object.entries(storageGet(CONFIG.KEYS.CUSTOM_META) || {})
        .map(([url, meta]) => [normalizeUrl(url), meta]));
}

/**
 * @param {string[]} keys
 * @param {import('../types').BookmarkCategory[]} categories
 * @param {Record<string, import('../types').CustomMetaItem>} [customMeta]
 * @returns {import('../types').BookmarkItem[]}
 */
export function getDerivedBookmarks(keys, categories, customMeta = {}) {
    if (!Array.isArray(keys)) return [];

    const catMap = getCategoryCatalog(categories).byUrl;

    return [...new Set(keys.map(normalizeUrl))].map(normalized => {
        const catBm = catMap.get(normalized);
        const custom = customMeta?.[normalized];
        if (custom) {
            return {
                name: custom.name || catBm?.name || deriveNameFromUrl(normalized),
                url: normalized,
                icon: custom.icon || catBm?.icon || faviconFromUrl(normalized),
                desc: custom.desc !== undefined ? custom.desc : (catBm?.desc || '')
            };
        }
        if (catBm) {
            return {
                name: catBm.name,
                url: catBm.url,
                icon: catBm.icon || faviconFromUrl(catBm.url),
                desc: catBm.desc || ''
            };
        }
        return {
            name: deriveNameFromUrl(normalized),
            url: normalized,
            icon: faviconFromUrl(normalized)
        };
    });
}

function migrateBookmarksStorage() {
    const rawUserKeys = storageGet(CONFIG.KEYS.BOOKMARK_KEYS);
    const rawLegacy = storageGet(CONFIG.KEYS.LEGACY_BOOKMARKS);

    if (rawUserKeys && Array.isArray(rawUserKeys)) return null;

    if (rawLegacy && Array.isArray(rawLegacy) && rawLegacy.length > 0) {
        /** @type {string[]} */
        const keys = [];
        const customMeta = getCustomMeta();

        const existingCatUrls = getCategoryCatalog(DEFAULT_CATEGORIES).byUrl;

        rawLegacy.forEach(bm => {
            if (!bm || !bm.url) return;
            const normUrl = normalizeUrl(bm.url);
            keys.push(normUrl);
            if (!existingCatUrls.has(normUrl) || bm.name || bm.icon || bm.desc !== undefined) {
                customMeta[normUrl] = {
                    name: bm.name || '',
                    icon: bm.icon || '',
                    desc: bm.desc || ''
                };
            }
        });

        // URL 列表是迁移完成标记，最后写入；任一步失败均以旧记录恢复本轮视图。
        if (storageSet(CONFIG.KEYS.CUSTOM_META, customMeta) && storageSet(CONFIG.KEYS.BOOKMARK_KEYS, keys)) {
            storageRemove(CONFIG.KEYS.LEGACY_BOOKMARKS);
            return null;
        }
        return rawLegacy;

    }
}

/** @param {import('../types').BookmarkItem[]} list @param {Set<string>} [customTextUrls] @returns {boolean} */
export function saveUserBookmarks(list, customTextUrls = new Set()) {
    /** @type {string[]} */
    const keys = [];
    const customMeta = getCustomMeta();
    const catMetaMap = getCategoryCatalog(pageData.categories).byUrl;

    const newKeysSet = new Set();
    list.forEach(item => {
        const bm = normalizeBookmark(item, deriveNameFromUrl(item?.url));
        if (!bm) return;
        const normUrl = bm.url;
        keys.push(normUrl);
        newKeysSet.add(normUrl);
        const catBm = catMetaMap.get(normUrl);
        const previous = customMeta[normUrl];
        const isCustomized = customTextUrls.has(normUrl) || !catBm || previous?.name !== undefined || previous?.desc !== undefined || (bm.name && bm.name !== catBm.name) || (bm.icon && bm.icon !== (catBm.icon || faviconFromUrl(catBm.url))) || (bm.desc !== undefined && bm.desc !== (catBm.desc || ''));
        if (isCustomized) {
            customMeta[normUrl] = {
                ...((customTextUrls.has(normUrl) || !catBm || previous?.name !== undefined || bm.name !== catBm.name) ? { name: bm.name } : {}),
                ...(bm.icon !== catBm?.icon ? { icon: bm.icon } : {}),
                ...((bm.desc !== undefined && (customTextUrls.has(normUrl) || !catBm || previous?.desc !== undefined || bm.desc !== (catBm.desc || ''))) ? { desc: bm.desc } : {})
            };
        } else {
            delete customMeta[normUrl];
        }
    });

    Object.keys(customMeta).forEach(urlKey => {
        if (!newKeysSet.has(urlKey)) {
            delete customMeta[urlKey];
        }
    });

    // 两个键均写入成功后才更新视图；元数据写入失败时恢复先前的 URL 列表。
    let previousKeys;
    try { previousKeys = localStorage.getItem(CONFIG.KEYS.BOOKMARK_KEYS); }
    catch { return false; }
    if (!storageSet(CONFIG.KEYS.BOOKMARK_KEYS, keys)) return false;
    if (!storageSet(CONFIG.KEYS.CUSTOM_META, customMeta)) {
        try {
            if (previousKeys === null) localStorage.removeItem(CONFIG.KEYS.BOOKMARK_KEYS);
            else localStorage.setItem(CONFIG.KEYS.BOOKMARK_KEYS, previousKeys);
        } catch {}
        return false;
    }
    pageData.bookmarks = getDerivedBookmarks(keys, pageData.categories, customMeta);
    renderBookmarks();
    return true;
}

/** 重置书签存储并通过同一恢复入口同步内存和视图。 */
export function resetUserBookmarks() {
    const results = [CONFIG.KEYS.LEGACY_BOOKMARKS, CONFIG.KEYS.BOOKMARK_KEYS, CONFIG.KEYS.CUSTOM_META]
        .map(key => storageRemove(key));
    loadBookmarks();
    return results.every(Boolean);
}

export function loadBookmarks() {
    const legacy = migrateBookmarksStorage();
    const userKeys = storageGet(CONFIG.KEYS.BOOKMARK_KEYS);
    const customMeta = getCustomMeta();

    if (legacy) {
        pageData.bookmarks = legacy.map(bm => normalizeBookmark(bm, deriveNameFromUrl(bm?.url))).filter(bm => bm !== null);
    } else if (userKeys && Array.isArray(userKeys) && userKeys.length) {
        pageData.bookmarks = getDerivedBookmarks(userKeys, pageData.categories, customMeta);
    } else {
        pageData.bookmarks = getDerivedBookmarks(DEFAULT_BOOKMARKS.map(b => b.url), pageData.categories, customMeta);
    }
    const bookmarksEl = dom.bookmarks;
    if (bookmarksEl) {
        renderBookmarks();
    }
}

/** @param {HTMLImageElement} img */
export function handleIconError(img) {
    handleFaviconFailure(img, img => {
        const initial = img.dataset.initial || '?';
        const parent = img.parentElement;
        if (parent) {
            img.remove();
            const isMd = img.dataset.md === '1';
            const textClass = isMd ? 'text-xs' : 'text-2xs';
            parent.classList.add('bg-white/15', 'border', 'border-white/20', 'text-white/90', textClass, 'font-semibold');
            parent.textContent = initial;
        }
    });
}

/**
 * @param {import('../types').BookmarkItem} bm
 * @param {string} [sizeType]
 * @param {boolean} [deferLoad]
 */
export function getFaviconHTML(bm, sizeType = 'sm', deferLoad = false) {
    const initial = (bm.name || '?').trim().charAt(0).toUpperCase() || '?';
    const isMd = sizeType === 'md';
    const sizeClass = isMd ? 'icon-box-md' : 'icon-box-sm';
    const textClass = isMd ? 'text-xs font-semibold' : 'text-2xs font-semibold';
    const safeIcon = safeUrl(bm.icon);
    
    if (!bm.icon || safeIcon === '#') {
        return createLetterBadgeHtml(initial, sizeClass, textClass);
    }
    const imgSize = isMd ? String(CONFIG.UI.ICON_SIZE_MD) : String(CONFIG.UI.ICON_SIZE_SM);
    return `<div class="icon-box ${sizeClass}"><img ${deferLoad ? 'data-nav-src' : 'src'}="${safeIcon}" width="${imgSize}" height="${imgSize}" data-initial="${escapeHtml(initial)}" data-md="${isMd ? '1' : '0'}" data-url="${safeUrl(bm.url)}" class="lazy-icon pointer-events-none select-none" alt=""${isMd ? '' : ' loading="lazy"'} decoding="async" draggable="false"></div>`;
}

/**
 * 渲染分类图标 HTML：兼容 SVG/图片相对路径与 Emoji 字符
 * @param {string} icon - 图标路径或 Emoji 字符
 * @param {string} [sizeClass='size-4'] - 尺寸与样式类
 * @returns {string} 渲染的安全 HTML 字符串
 */
export function getCategoryIconHTML(icon, sizeClass = 'size-4') {
    if (!icon) return '';
    if (typeof icon === 'string' && (icon.startsWith('./') || icon.startsWith('/') || icon.endsWith('.svg') || icon.endsWith('.png') || icon.endsWith('.webp'))) {
        return `<img src="${safeUrl(icon)}" class="${sizeClass} shrink-0 object-contain select-none pointer-events-none inline-block align-middle" alt="" aria-hidden="true" decoding="async">`;
    }
    return escapeHtml(icon);
}

export function initFaviconObserver(container = null) {
    const scope = container || (navIconsActivated ? document : (dom.bookmarks || document));
    scope.querySelectorAll('img.lazy-icon').forEach(img => {
        checkImageReady(/** @type {HTMLImageElement} */ (img));
    });
}

export function initPickerFaviconObserver() {
    const container = dom.pickerContent;
    if (!container) return;
    container.querySelectorAll('img.lazy-icon').forEach(img => {
        checkImageReady(/** @type {HTMLImageElement} */ (img), handleIconError);
    });
}

let lastBookmarksSignature = '';
export function renderBookmarks(force = false) {
    const bookmarksEl = dom.bookmarks;
    if (!bookmarksEl) return;
    const currentSig = JSON.stringify(pageData.bookmarks);
    if (!force && lastBookmarksSignature && currentSig === lastBookmarksSignature) return;
    lastBookmarksSignature = currentSig;

    const existingMap = new Map();
    bookmarksEl.querySelectorAll(':scope > .bookmark-item').forEach(el => {
        const u = el.getAttribute('data-url') || el.getAttribute('href');
        if (u) existingMap.set(u, el);
    });

    if (existingMap.size === 0) {
        bookmarksEl.innerHTML = pageData.bookmarks.map(bm => `
        <a href="${safeUrl(localizeBookmarkUrl(bm.url))}" target="_blank" rel="noopener noreferrer"
           data-url="${safeUrl(bm.url)}"
           data-icon="${safeUrl(bm.icon || '')}"
           class="bookmark-item flex flex-col items-center justify-center gap-2 py-3 px-1 sm:px-1.5 apple-radius text-white/90">
            ${getFaviconHTML(bm, 'md')}
            <span class="bookmark-title text-white/90">${escapeHtml(bm.name)}</span>
        </a>
    `).join('');
    } else {
        const fragment = document.createDocumentFragment();
        pageData.bookmarks.forEach(bm => {
            const safeU = safeUrl(bm.url, false);
            const safeIcon = safeUrl(bm.icon || '', false);
            let node = existingMap.get(safeU) || existingMap.get(bm.url);
            if (node) {
                node.setAttribute('href', safeUrl(localizeBookmarkUrl(bm.url), false));
                existingMap.delete(safeU);
                existingMap.delete(bm.url);
                const titleSpan = node.querySelector('.bookmark-title');
                if (titleSpan && titleSpan.textContent !== bm.name) {
                    titleSpan.textContent = bm.name;
                }
                if (node.getAttribute('data-icon') !== safeIcon) {
                    node.setAttribute('data-icon', safeIcon);
                    const oldIconBox = node.querySelector('.icon-box');
                    if (oldIconBox) {
                        const newIconFrag = document.createRange().createContextualFragment(getFaviconHTML(bm, 'md'));
                        oldIconBox.replaceWith(newIconFrag);
                    }
                }
                fragment.appendChild(node);
            } else {
                const range = document.createRange();
                const newFrag = range.createContextualFragment(`
                    <a href="${safeUrl(localizeBookmarkUrl(bm.url))}" target="_blank" rel="noopener noreferrer"
                       data-url="${escapeHtml(safeU)}"
                       data-icon="${escapeHtml(safeIcon)}"
                       class="bookmark-item flex flex-col items-center justify-center gap-2 py-3 px-1 sm:px-1.5 apple-radius text-white/90">
                        ${getFaviconHTML(bm, 'md')}
                        <span class="bookmark-title text-white/90">${escapeHtml(bm.name)}</span>
                    </a>
                `);
                fragment.appendChild(newFrag);
            }
        });
        existingMap.forEach(staleNode => staleNode.remove());
        bookmarksEl.appendChild(fragment);
    }

    bookmarksEl.querySelectorAll('img.lazy-icon').forEach(img => checkImageReady(/** @type {HTMLImageElement} */ (img)));
}

/** @type {import('../types').CategoryCatalog | undefined} */
let lastNavCatalog;
let navIconsActivated = false;
let navAllIconsActivated = false;

/** 首屏空闲时仅准备首批本地图标，让加载和淡入尽量在首次切屏前完成（覆盖 1080p 至 2K 屏首屏可见的前 5 个分类）。 */
export function preloadVisibleNavIcons() {
    if (navIconsActivated || state.currentSection !== 'start' || document.hidden) return;
    const nav = dom.navSection;
    if (!nav) return;
    nav.querySelectorAll('.category-block:nth-child(-n+5) img[data-nav-src]').forEach(node => {
        const img = /** @type {HTMLImageElement} */ (node);
        const source = img.dataset.navSrc || '';
        // 自定义远程图标和其余分类仍等进入导航后按需加载。
        if (!source.startsWith('./icons/')) return;
        img.fetchPriority = 'low';
        img.loading = 'eager';
        img.src = source;
        delete img.dataset.navSrc;
        checkImageReady(img);
    });
}

/**
 * 动效期按需激活：优先激活视口内可见分类图标（前 5 个分类，约 49 个图标），
 * 避免在切屏 Transform 动效首帧同时向 130+ 个图片发起网络与解码请求。
 */
export function activateVisibleNavIcons() {
    if (navIconsActivated) return;
    navIconsActivated = true;
    const nav = dom.navSection;
    if (!nav) return;
    nav.querySelectorAll('.category-block:nth-child(-n+5) img[data-nav-src]').forEach(node => {
        const img = /** @type {HTMLImageElement} */ (node);
        img.src = img.dataset.navSrc || '';
        delete img.dataset.navSrc;
    });
}

/** @type {number | null} */
let offscreenIconsIdleId = null;

/**
 * 动效结算或空闲时，平稳激活视口外剩余的离屏图标。
 */
function activateAllNavIcons() {
    navIconsActivated = true;
    if (offscreenIconsIdleId !== null) {
        if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
            window.cancelIdleCallback(offscreenIconsIdleId);
        } else {
            clearTimeout(offscreenIconsIdleId);
        }
        offscreenIconsIdleId = null;
    }
    if (navAllIconsActivated) return;
    navAllIconsActivated = true;
    const nav = dom.navSection;
    if (!nav) return;
    nav.querySelectorAll('img[data-nav-src]').forEach(node => {
        const img = /** @type {HTMLImageElement} */ (node);
        img.src = img.dataset.navSrc || '';
        delete img.dataset.navSrc;
    });
}

/**
 * 切屏收尾后在浏览器空闲调度激活离屏图标，避免在过渡帧引发同步布局与图片解码峰值。
 */
export function scheduleOffscreenNavIcons() {
    if (navAllIconsActivated) return;
    if (offscreenIconsIdleId !== null) return;
    if (typeof window === 'undefined') return;
    const run = () => {
        offscreenIconsIdleId = null;
        activateAllNavIcons();
    };
    if ('requestIdleCallback' in window) {
        offscreenIconsIdleId = window.requestIdleCallback(run, { timeout: 1500 });
    } else {
        offscreenIconsIdleId = /** @type {number} */ (/** @type {unknown} */ (setTimeout(run, 120)));
    }
}

let isSidebarNavInitialized = false;
let isManualScrolling = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let manualScrollTimer = null;
/** @type {HTMLElement[]} */
let cachedSidebarItems = [];
/** @type {HTMLElement[]} */
let cachedSidebarSections = [];
/** @type {number[]} */
let cachedSectionOffsets = [];
let sidebarCacheDirty = true;
/** @type {ResizeObserver | null} */
let sidebarLayoutObserver = null;

export function refreshSidebarNavCache() {
    // 无尺寸观察器时沿用实时测量，避免无法可靠失效的缓存。
    if (sidebarLayoutObserver && !sidebarCacheDirty) return;
    const sidebarList = dom.sidebarList;
    const navContent = dom.navContent;
    if (!sidebarList || !navContent) return;
    cachedSidebarItems = /** @type {HTMLElement[]} */ (Array.from(sidebarList.querySelectorAll('[data-target]')));
    cachedSidebarSections = /** @type {HTMLElement[]} */ (cachedSidebarItems.map(item => item.dataset.target ? document.getElementById(item.dataset.target) : null).filter(Boolean));
    cachedSectionOffsets = cachedSidebarSections.map(s => s.offsetTop);
    sidebarCacheDirty = false;
}

/**
 * @param {HTMLElement | null | undefined} item
 * @param {HTMLElement | null | undefined} container
 */
function scrollTabIntoView(item, container) {
    if (!item || !container) return;
    const isMobile = window.innerWidth <= CONFIG.NAV.MOBILE_BREAKPOINT;
    const margin = CONFIG.NAV.TAB_SCROLL_MARGIN;
    const cRect = container.getBoundingClientRect();
    const iRect = item.getBoundingClientRect();
    if (isMobile) {
        if (iRect.left < cRect.left + margin || iRect.right > cRect.right - margin) {
            const targetLeft = container.scrollLeft + (iRect.left - cRect.left) - (container.clientWidth / 2) + (item.offsetWidth / 2);
            container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
        }
    } else {
        if (iRect.top < cRect.top + margin || iRect.bottom > cRect.bottom - margin) {
            const targetTop = container.scrollTop + (iRect.top - cRect.top) - (container.clientHeight / 2) + (item.offsetHeight / 2);
            container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
        }
    }
}

export function updateSidebarActive() {
    const sidebarContainer = dom.sidebar;
    const sidebarList = dom.sidebarList;
    const content = dom.navContent;
    if (!sidebarList || !content || isManualScrolling) return;

    refreshSidebarNavCache();
    const items = cachedSidebarItems;
    const sections = cachedSidebarSections;
    if (!items.length || !sections.length) return;

    const containerHeight = content.clientHeight;
    const scrollTop = content.scrollTop;
    const scrollHeight = content.scrollHeight;

    let activeIdx = 0;
    if (scrollTop <= CONFIG.NAV.TOP_THRESHOLD) {
        activeIdx = 0;
    } else {
        const secTops = cachedSectionOffsets.map(off => off - scrollTop);
        for (let i = 0; i < secTops.length; i++) {
            if (secTops[i] <= CONFIG.NAV.HEADER_OFFSET) {
                activeIdx = i;
            }
        }
        if (scrollTop + containerHeight >= scrollHeight - CONFIG.NAV.BOTTOM_TOLERANCE) {
            for (let i = sections.length - 1; i >= 0; i--) {
                if (secTops[i] <= containerHeight * CONFIG.NAV.BOTTOM_VISIBILITY_RATIO) {
                    activeIdx = i;
                    break;
                }
            }
        }
    }

    // 先读取侧栏几何信息，再更新高亮；避免 active 字重变更后立即强制布局。
    const nextActive = items[activeIdx];
    if (nextActive && !nextActive.classList.contains('active')) {
        scrollTabIntoView(nextActive, sidebarContainer);
    }
    items.forEach((item, i) => {
        const isActive = i === activeIdx;
        const wasActive = item.classList.contains('active');
        if (isActive !== wasActive) {
            item.classList.toggle('active', isActive);
            item.setAttribute('aria-selected', isActive ? 'true' : 'false');
        }
    });
}

export function renderNavCategories(force = false) {
    const sidebarList = dom.sidebarList;
    const navCategories = dom.navCategories;
    if (!sidebarList || !navCategories) return;

    const catalog = getCategoryCatalog(pageData.categories);
    if (!force && catalog === lastNavCatalog) return;
    lastNavCatalog = catalog;

    const navContent = dom.navContent;
    // 首次构建时目录为空，无需读取滚动布局；重绘已有目录才保留位置。
    const savedScrollTop = navContent && navCategories.firstElementChild ? navContent.scrollTop : 0;
    const sortedCats = catalog.sorted;

    sidebarList.innerHTML = sortedCats.map((cat, i) => `
        <button type="button" role="tab" id="cat-tab-${i}" aria-selected="${i === 0 ? 'true' : 'false'}" aria-controls="cat-${i}" class="sidebar-item w-full text-left text-xs md:text-sm px-2.5 py-1.75 min-h-9 text-white/70 flex items-center gap-2 ${i === 0 ? 'active' : ''}"
                data-target="cat-${i}">
            <span class="size-5 shrink-0 sidebar-icon flex items-center justify-center">${getCategoryIconHTML(cat.icon, 'size-4')}</span>
            <span class="truncate sidebar-label">${escapeHtml(cat.name)}</span>
        </button>
    `).join('');

    navCategories.innerHTML = sortedCats.map((cat, i) => {
        const sortedBookmarks = cat.sortedBookmarks;
        return `
        <div id="cat-${i}" role="tabpanel" aria-labelledby="cat-tab-${i}" class="category-block ${i > 0 ? 'scroll-mt-6' : ''}">
            <div class="category-header flex items-center gap-2.5 pb-2.5 mb-3.5 transition-colors duration-300 select-none">
                <span class="size-6 shrink-0 flex items-center justify-center">${getCategoryIconHTML(cat.icon, 'size-5')}</span>
                <h3 class="text-xs sm:text-sm font-semibold tracking-wide text-white/90">${escapeHtml(cat.name)}</h3>
            </div>
            <div class="nav-bookmark-grid">
                ${sortedBookmarks.map(bm => `
                    <a href="${safeUrl(localizeBookmarkUrl(bm.url))}" target="_blank" rel="noopener noreferrer"
                       class="nav-bookmark group flex items-center gap-2.5 px-3 py-2.5 md:px-3.5 md:py-2.5 text-white/80">
                        ${getFaviconHTML(bm, 'sm', !navIconsActivated)}
                        ${bm.desc ? `
                            <div class="flex-1 min-w-0 flex flex-col justify-center">
                                <span class="text-xs md:text-sm font-semibold truncate leading-tight">${escapeHtml(bm.name)}</span>
                                <span class="bookmark-description text-2xs text-white/60 truncate leading-none mt-1 transition-colors duration-150">${escapeHtml(bm.desc)}</span>
                            </div>
                        ` : `
                            <span class="flex-1 min-w-0 text-xs md:text-sm font-semibold truncate leading-tight text-white/90">${escapeHtml(bm.name)}</span>
                        `}
                    </a>
                `).join('')}
            </div>
        </div>
    `;
    }).join('');

    sidebarCacheDirty = true;
    const shouldMeasure = navIconsActivated || state.currentSection === 'nav';
    initSidebarNav(shouldMeasure);
    if (sidebarLayoutObserver && navContent) {
        const observer = sidebarLayoutObserver;
        observer.disconnect();
        observer.observe(navContent);
        if (navCategories) observer.observe(navCategories, { box: 'border-box' });
    }
    if (shouldMeasure) {
        refreshSidebarNavCache();
        updateSidebarActive();
        initFaviconObserver();
    }
    if (navContent && savedScrollTop > 0) {
        navContent.scrollTop = savedScrollTop;
    }
}

function initSidebarNav(measureActive = true) {
    const sidebarList = dom.sidebarList;
    const content = dom.navContent;
    if (!sidebarList || !content) return;

    if (measureActive) {
        updateSidebarActive();
    }

    if (!isSidebarNavInitialized) {
        /** @type {ReturnType<typeof setTimeout> | null} */
        let resizeTimer = null;
        const handleResizeOrRotate = () => {
            sidebarCacheDirty = true;
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (state.currentSection === 'nav') {
                    refreshSidebarNavCache();
                    requestAnimationFrame(updateSidebarActive);
                }
            }, CONFIG.NAV.RESIZE_DEBOUNCE);
        };
        window.addEventListener('resize', handleResizeOrRotate, { passive: true });
        window.addEventListener('orientationchange', handleResizeOrRotate, { passive: true });
        if ('ResizeObserver' in window && content) {
            try {
                sidebarLayoutObserver = new ResizeObserver(() => handleResizeOrRotate());
            } catch {}
        }

        sidebarList.addEventListener('click', (e) => {
            const targetEl = /** @type {Element | null} */ (e.target);
            const btn = /** @type {HTMLElement | null} */ (targetEl ? targetEl.closest('[data-target]') : null);
            if (!btn) return;
            const targetId = btn.dataset.target;
            const target = targetId ? document.getElementById(targetId) : null;
            if (!target) return;

            isManualScrolling = true;
            if (manualScrollTimer) clearTimeout(manualScrollTimer);

            const allItems = Array.from(sidebarList.querySelectorAll('[data-target]'));
            allItems.forEach(item => {
                const selected = item === btn;
                item.classList.toggle('active', selected);
                item.setAttribute('aria-selected', String(selected));
            });
            const sidebarContainer = dom.sidebar;
            scrollTabIntoView(btn, sidebarContainer);

            const cat0 = document.getElementById('cat-0');
            const baseOffset = cat0 ? cat0.offsetTop : 0;
            const targetTop = (targetId === 'cat-0') ? 0 : Math.max(0, target.offsetTop - baseOffset);

            content.scrollTo({ top: targetTop, behavior: 'smooth' });

            const header = target.querySelector('.category-header');
            if (header) {
                header.classList.remove('category-title-pulse');
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        header.classList.add('category-title-pulse');
                        header.addEventListener('animationend', () => header.classList.remove('category-title-pulse'), { once: true });
                    });
                });
            }

            manualScrollTimer = setTimeout(() => {
                isManualScrolling = false;
                updateSidebarActive();
            }, CONFIG.NAV.MANUAL_LOCK_MAX_MS);
        });

        let ticking = false;
        /** @type {ReturnType<typeof setTimeout> | null} */
        let scrollEndTimer = null;
        content.addEventListener('scroll', () => {
            if (!navAllIconsActivated) activateAllNavIcons();
            if (isManualScrolling) {
                if (scrollEndTimer) clearTimeout(scrollEndTimer);
                scrollEndTimer = setTimeout(() => {
                    isManualScrolling = false;
                    updateSidebarActive();
                }, CONFIG.NAV.SCROLL_END_DEBOUNCE);
                return;
            }
            if (!ticking) {
                requestAnimationFrame(() => {
                    updateSidebarActive();
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });

        isSidebarNavInitialized = true;
    }
}

export function preloadFavicons() {
    const urls = new Set();
    pageData.bookmarks.forEach(bm => { if (bm.icon) urls.add(bm.icon); });
    pageData.categories.forEach(cat => { if (cat.icon) urls.add(cat.icon); });
    const readySources = new Set();
    if (dom.bookmarks) {
        dom.bookmarks.querySelectorAll('img').forEach(img => {
            if (img.complete) {
                if (img.src) readySources.add(img.src);
                const attrSrc = img.getAttribute('src');
                if (attrSrc) readySources.add(attrSrc);
            }
        });
    }
    urls.forEach(url => {
        if (readySources.has(url)) return;
        const img = new Image();
        img.onload = () => { img.onload = img.onerror = null; };
        img.onerror = () => {
            img.onload = img.onerror = null;
            evictFaviconCache(url);
        };
        img.src = url;
    });
}
