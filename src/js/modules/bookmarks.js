/**
 * 书签派生与持久化、快捷书签和分类导航渲染、导航图标加载调度
 *
 * 核心职责域：
 * 1. 数据派生与持久化：loadBookmarks, saveUserBookmarks, resetUserBookmarks
 * 2. 快捷书签与分类导航渲染：renderBookmarks, renderNavCategories, updateSidebarActive, refreshSidebarNavCache
 * 3. 导航图标调度：preloadFavicons, initFaviconObserver, scheduleOffscreenNavIcons
 *
 */
import { getLocale, localizeBookmarkUrl } from '../core/i18n.js';
import { isScreenTransitioning } from '../core/screen-state.js';
import { CONFIG, DEFAULT_BOOKMARKS } from '../config/constants.js';
import { escapeHtml, safeUrl, handleRovingKeyNav } from '../utils/helpers.js';
import { normalizeUrl, normalizeBookmark, deriveNameFromUrl, faviconFromUrl } from '../utils/bookmark-model.js';
import { getFaviconHTML, getCategoryIconHTML, evictFaviconCache, checkImageReady } from '../utils/favicon.js';
import { storageGet, storageSet, storageRemove } from '../utils/storage.js';
import { pageData, state } from '../state/store.js';
import { dom } from '../state/dom.js';

import { getCategoryCatalog } from '../utils/category-catalog.js';

function readBookmarkRecord() {
    const missing = Symbol();
    const record = storageGet(CONFIG.KEYS.BOOKMARKS, missing, null);
    if (record === missing) {
        return { keys: storageGet(CONFIG.KEYS.BOOKMARK_KEYS), meta: storageGet(CONFIG.KEYS.CUSTOM_META) };
    }
    return record?.version === 1 ? record : null;
}

/** @param {unknown} stored */
function getCustomMeta(stored) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).flatMap(([url, meta]) => {
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
        const bookmark = normalizeBookmark({ ...meta, url,
            name: typeof meta.name === 'string' ? meta.name : '' }, deriveNameFromUrl(url));
        if (!bookmark) return [];
        // 缺省文字继续继承目录；不要把清洗时的兜底名称保存为用户自定义。
        return [[bookmark.url, {
            ...(typeof meta.name === 'string' && meta.name.trim() ? { name: bookmark.name } : {}),
            ...(typeof meta.icon === 'string' && safeUrl(meta.icon) !== '#' ? { icon: bookmark.icon } : {}),
            ...(typeof meta.desc === 'string' ? { desc: bookmark.desc } : {})
        }]];
    }));
}

/**
 * @param {string[]} keys
 * @param {import('../types').BookmarkCategory[]} categories
 * @param {Record<string, import('../types').CustomMetaItem>} [customMeta]
 * @returns {import('../types').BookmarkItem[]}
 */
export function getDerivedBookmarks(keys, categories, customMeta = {}) {
    const catMap = getCategoryCatalog(categories).byUrl;

    return [...new Set(keys.map(normalizeUrl))].map(normalized => {
        const catBm = catMap.get(normalized);
        const custom = customMeta[normalized];
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

/**
 * 判定书签字段是否有用户自定义覆盖；未修改项保持继承目录，避免将目录默认值固化为自定义。
 * @param {import('../types').BookmarkItem} bm
 * @param {import('../types').BookmarkItem | undefined} catBm
 * @param {import('../types').CustomMetaItem | undefined} previous
 * @param {boolean} isForceCustom
 * @returns {import('../types').CustomMetaItem | null}
 */
function resolveBookmarkOverride(bm, catBm, previous, isForceCustom) {
    if (isForceCustom || !catBm) {
        return {
            name: bm.name,
            icon: bm.icon,
            ...(bm.desc !== undefined ? { desc: bm.desc } : {})
        };
    }
    const nameCustom = previous?.name !== undefined || bm.name !== catBm.name;
    const iconCustom = bm.icon !== (catBm.icon || faviconFromUrl(catBm.url));
    const descCustom = bm.desc !== undefined && (previous?.desc !== undefined || bm.desc !== (catBm.desc || ''));
    if (!nameCustom && !iconCustom && !descCustom) return null;

    /** @type {import('../types').CustomMetaItem} */
    const meta = {};
    if (nameCustom) meta.name = bm.name;
    if (iconCustom) meta.icon = bm.icon;
    if (descCustom) meta.desc = bm.desc;
    return meta;
}

/** @param {import('../types').BookmarkItem[]} list @param {Set<string>} [customTextUrls] @returns {boolean} */
export function saveUserBookmarks(list, customTextUrls = new Set()) {
    /** @type {string[]} */
    const keys = [];
    const customMeta = getCustomMeta(readBookmarkRecord()?.meta);
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
        const isForceCustom = customTextUrls.has(normUrl);
        const override = resolveBookmarkOverride(bm, catBm, previous, isForceCustom);
        if (override) {
            customMeta[normUrl] = override;
        } else {
            delete customMeta[normUrl];
        }
    });

    Object.keys(customMeta).forEach(urlKey => {
        if (!newKeysSet.has(urlKey)) {
            delete customMeta[urlKey];
        }
    });

    if (!storageSet(CONFIG.KEYS.BOOKMARKS, { version: 1, keys, meta: customMeta })) return false;
    pageData.bookmarks = getDerivedBookmarks(keys, pageData.categories, customMeta);
    renderBookmarks();
    return true;
}

/** 重置书签存储并通过同一恢复入口同步内存和视图。 */
export function resetUserBookmarks() {
    // null 表示随语言使用默认顺序，同时覆盖旧格式中仍存在的记录。
    if (!storageSet(CONFIG.KEYS.BOOKMARKS, { version: 1, keys: null, meta: {} })) return false;
    loadBookmarks();
    // 兼容清理只在提交后执行，失败时旧记录也不会重新生效。
    return [CONFIG.KEYS.BOOKMARK_KEYS, CONFIG.KEYS.CUSTOM_META].map(storageRemove).every(Boolean);
}

export function loadBookmarks() {
    const record = readBookmarkRecord();
    const storedKeys = record?.keys;
    const userKeys = Array.isArray(storedKeys) ? storedKeys.flatMap(url => {
        if (typeof url !== 'string') return [];
        const bookmark = normalizeBookmark({ url }, deriveNameFromUrl(url));
        return bookmark ? [bookmark.url] : [];
    }) : [];
    const customMeta = getCustomMeta(record?.meta);

    if (userKeys.length) {
        pageData.bookmarks = getDerivedBookmarks(userKeys, pageData.categories, customMeta);
    } else {
        const defaultKeys = getLocale() === 'en' ? window.__GLASS_I18N__?.catalogs?.en?.defaultBookmarks : undefined;
        pageData.bookmarks = getDerivedBookmarks(defaultKeys || DEFAULT_BOOKMARKS.map(b => b.url), pageData.categories, customMeta);
    }
    const bookmarksEl = dom.bookmarks;
    if (bookmarksEl) {
        renderBookmarks();
    }
}

export function initFaviconObserver() {
    const scope = navIconsActivated ? document : (dom.bookmarks || document);
    scope.querySelectorAll('img.lazy-icon').forEach(img => {
        checkImageReady(/** @type {HTMLImageElement} */ (img));
    });
}

/** @param {import('../types').BookmarkItem} bm */
function getBookmarkCardHTML(bm) {
    return `
        <a href="${safeUrl(localizeBookmarkUrl(bm.url))}" target="_blank" rel="noopener noreferrer"
           data-url="${safeUrl(bm.url)}"
           data-icon="${safeUrl(bm.icon || '')}"
           class="bookmark-item flex min-w-0 apple-radius text-white/90">
            <div class="bookmark-surface flex flex-1 flex-col items-center justify-center gap-2 py-3 px-1 sm:px-1.5">
                ${getFaviconHTML(bm, 'md')}
                <span class="bookmark-title text-white/90">${escapeHtml(bm.name)}</span>
            </div>
        </a>
    `;
}

let lastBookmarksSignature = '';
export function renderBookmarks() {
    const bookmarksEl = dom.bookmarks;
    if (!bookmarksEl) return;
    const currentSig = JSON.stringify(pageData.bookmarks);
    if (lastBookmarksSignature && currentSig === lastBookmarksSignature) return;
    lastBookmarksSignature = currentSig;

    bookmarksEl.innerHTML = pageData.bookmarks.map(getBookmarkCardHTML).join('');
    bookmarksEl.querySelectorAll('img.lazy-icon').forEach(img => checkImageReady(/** @type {HTMLImageElement} */ (img)));
}

/** @type {import('../types').CategoryCatalog | undefined} */
let lastNavCatalog;
let navIconsActivated = false;
let navAllIconsActivated = false;

/**
 * 激活单个待加载的导航图标
 * @param {HTMLImageElement} img
 * @param {{ fetchPriority?: 'low' | 'auto' | 'high', loading?: 'eager' | 'lazy', checkReady?: boolean }} [options]
 */
function activateNavImage(img, options = {}) {
    const source = img.dataset.navSrc || '';
    if (!source) return;
    if (options.fetchPriority) img.fetchPriority = options.fetchPriority;
    if (options.loading) img.loading = options.loading;
    img.src = source;
    delete img.dataset.navSrc;
    if (options.checkReady) checkImageReady(img);
}

/** 首屏空闲时仅准备前序分类的本地图标，让加载和淡入尽量在首次切屏前完成。 */
export function preloadVisibleNavIcons() {
    if (navIconsActivated || state.currentSection !== 'start' || document.hidden) return;
    const nav = dom.navSection;
    if (!nav) return;
    const selector = `.category-block:nth-child(-n+${CONFIG.NAV.INITIAL_VISIBLE_CATEGORIES}) img[data-nav-src]`;
    nav.querySelectorAll(selector).forEach(node => {
        const img = /** @type {HTMLImageElement} */ (node);
        const source = img.dataset.navSrc || '';
        // 自定义远程图标和其余分类仍等进入导航后按需加载。
        if (!source.startsWith('./icons/')) return;
        activateNavImage(img, { fetchPriority: 'low', loading: 'eager', checkReady: true });
    });
}

/**
 * 动效期按需激活前序分类图标，
 * 避免在切屏 Transform 动效首帧同时加载和解码全部导航图标。
 */
export function activateVisibleNavIcons() {
    if (navIconsActivated) return;
    navIconsActivated = true;
    const nav = dom.navSection;
    if (!nav) return;
    const selector = `.category-block:nth-child(-n+${CONFIG.NAV.INITIAL_VISIBLE_CATEGORIES}) img[data-nav-src]`;
    nav.querySelectorAll(selector).forEach(node => {
        activateNavImage(/** @type {HTMLImageElement} */ (node));
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
    dom.navCategories?.classList.remove('nav-initial-entry');
    const nav = dom.navSection;
    if (!nav) return;
    nav.querySelectorAll('img[data-nav-src]').forEach(node => {
        activateNavImage(/** @type {HTMLImageElement} */ (node));
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
        if (document.hidden || state.currentSection !== 'nav' || isScreenTransitioning()) return;
        activateAllNavIcons();
    };
    if ('requestIdleCallback' in window) {
        offscreenIconsIdleId = window.requestIdleCallback(run, { timeout: 1500 });
    } else {
        offscreenIconsIdleId = /** @type {number} */ (/** @type {unknown} */ (setTimeout(run, 120)));
    }
}

let isSidebarNavInitialized = false;
/** @type {{ item: HTMLElement, top: number } | null} */
let sidebarJump = null;
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
    const content = dom.navContent;
    if (!dom.sidebarList || !content || sidebarJump) return;

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

    selectSidebarTab(items[activeIdx]);
}

/** @param {HTMLElement} nextActive */
function selectSidebarTab(nextActive) {
    // 先读取侧栏几何信息，再更新高亮；避免 active 字重变更后立即强制布局。
    if (!nextActive.classList.contains('active')) scrollTabIntoView(nextActive, dom.sidebar);
    cachedSidebarItems.forEach(item => {
        const isActive = item === nextActive;
        const wasActive = item.classList.contains('active');
        if (isActive !== wasActive) {
            item.classList.toggle('active', isActive);
            item.setAttribute('aria-selected', isActive ? 'true' : 'false');
        }
    });
}

export function renderNavCategories() {
    const sidebarList = dom.sidebarList;
    const navCategories = dom.navCategories;
    if (!sidebarList || !navCategories) return;

    const catalog = getCategoryCatalog(pageData.categories);
    if (catalog === lastNavCatalog) return;
    lastNavCatalog = catalog;
    sidebarJump = null;

    const navContent = dom.navContent;
    // 首次构建时目录为空，无需读取滚动布局；重绘已有目录才保留位置。
    const hasCategories = Boolean(navCategories.firstElementChild);
    const savedScrollTop = navContent && hasCategories ? navContent.scrollTop : 0;
    if (!hasCategories && !navAllIconsActivated && isScreenTransitioning()) {
        navCategories.classList.add('nav-initial-entry');
    }
    const sortedCats = catalog.sorted;

    sidebarList.innerHTML = sortedCats.map((cat, i) => `
        <button type="button" role="tab" id="cat-tab-${i}" aria-selected="${i === 0 ? 'true' : 'false'}" aria-controls="cat-${i}" class="sidebar-item w-full text-left text-xs md:text-sm px-2.5 py-1.75 min-h-9 text-white/70 flex items-center gap-2 ${i === 0 ? 'active' : ''}"
                data-target="cat-${i}">
            <span class="size-5 shrink-0 sidebar-icon flex items-center justify-center">${getCategoryIconHTML(cat.icon, 'size-4')}</span>
            <span class="truncate">${escapeHtml(cat.name)}</span>
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
                                <span class="bookmark-description text-2xs text-white/60 truncate leading-normal mt-0.5 transition-colors duration-150">${escapeHtml(bm.desc)}</span>
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

            refreshSidebarNavCache();
            const firstCategory = /** @type {HTMLElement | null} */ (dom.navCategories?.firstElementChild);
            const baseOffset = firstCategory?.offsetTop ?? 0;
            const top = Math.min(content.scrollHeight - content.clientHeight, Math.max(0, target.offsetTop - baseOffset));
            const atTarget = Math.abs(content.scrollTop - top) <= 1;
            sidebarJump = atTarget ? null : { item: btn, top };
            selectSidebarTab(btn);
            // 原地点击没有 scrollend；instant 同时取消尚未开始的旧跳转。
            content.scrollTo({ top, behavior: atTarget ? 'instant' : 'smooth' });

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
        });

        sidebarList.addEventListener('keydown', (e) => {
            const allItems = /** @type {HTMLElement[]} */ (Array.from(sidebarList.querySelectorAll('[data-target]')));
            const currentBtn = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('[data-target]') : null);
            handleRovingKeyNav(e, allItems, currentBtn, nextBtn => {
                nextBtn.click();
            });
        });

        const interruptJump = () => {
            if (!sidebarJump) return;
            sidebarJump = null;
            updateSidebarActive();
        };
        content.addEventListener('wheel', e => {
            if (!e.ctrlKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) interruptJump();
        }, { passive: true });
        content.addEventListener('touchstart', interruptJump, { passive: true });
        content.addEventListener('keydown', e => {
            if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) interruptJump();
        });
        content.addEventListener('scrollend', () => {
            if (!sidebarJump) return;
            const top = Math.min(sidebarJump.top, content.scrollHeight - content.clientHeight);
            if (Math.abs(content.scrollTop - top) > 1) return;
            selectSidebarTab(sidebarJump.item);
            sidebarJump = null;
        });

        let ticking = false;
        content.addEventListener('scroll', () => {
            if (!navAllIconsActivated) activateAllNavIcons();
            if (state.currentSection !== 'nav') sidebarJump = null;
            if (sidebarJump) return;
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
    // 目录已构建时，侧栏图标的 src 已发起加载。
    if (!dom.sidebarList?.firstElementChild) {
        pageData.categories.forEach(cat => { if (cat.icon) urls.add(cat.icon); });
    }
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
