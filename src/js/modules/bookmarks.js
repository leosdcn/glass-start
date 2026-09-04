/**
 * ==============================================================================
 * Glass Start — 书签体系、双栏导航与 Favicon 流式管理 (src/js/modules/bookmarks.js)
 * ==============================================================================
 *
 * 核心功能：
 * 1. 派生书签数据恢复、持久化与迁移 (getDerivedBookmarks, saveUserBookmarks, migrateBookmarksStorage, loadUserData)
 * 2. 首屏快捷书签网格渲染 (renderBookmarks)
 * 3. 导航页双栏分类与 A-Z 拼音排序 (renderNavCategories, getSortedCategories, initSidebarNav)
 * 4. Favicon 懒加载观察器与首字母徽章兜底 (getFaviconHTML, handleIconError, initFaviconObserver, preloadFavicons)
 */
import { CONFIG, DEFAULT_BOOKMARKS, DEFAULT_CATEGORIES, backgrounds } from '../config/constants.js';
import {
    escapeHtml,
    safeUrl,
    normalizeUrl,
    deriveNameFromUrl,
    faviconFromUrl,
    createLetterBadgeHtml,
    storageGet,
    storageSet,
    storageRemove
} from '../utils/helpers.js';
import { state, pageData } from '../state/store.js';
import { dom, $ } from '../state/dom.js';
import { applyWallpaper } from '../core/theme-engine.js';
import { getEffectiveCustomWallpaper, findPresetBgIndex, clearCustomWallpaper } from './wallpaper.js';

export const zhCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export function getDerivedBookmarks(keys, categories, customMeta = {}) {
    if (!Array.isArray(keys)) return [];

    const catMap = new Map();
    if (Array.isArray(categories)) {
        categories.forEach(cat => {
            if (Array.isArray(cat.bookmarks)) {
                cat.bookmarks.forEach(bm => {
                    if (bm.url && !catMap.has(normalizeUrl(bm.url))) {
                        catMap.set(normalizeUrl(bm.url), bm);
                    }
                });
            }
        });
    }

    return keys.map(url => {
        const normalized = normalizeUrl(url);
        if (customMeta && customMeta[normalized]) {
            const custom = customMeta[normalized];
            const catBm = catMap.get(normalized);
            return {
                name: custom.name || catBm?.name || deriveNameFromUrl(normalized),
                url: normalized,
                icon: custom.icon || catBm?.icon || faviconFromUrl(normalized),
                desc: custom.desc !== undefined ? custom.desc : (catBm?.desc || '')
            };
        }
        if (catMap.has(normalized)) {
            const catBm = catMap.get(normalized);
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

export function migrateBookmarksStorage() {
    const rawUserKeys = storageGet(CONFIG.KEYS.BOOKMARK_KEYS);
    const rawLegacy = storageGet(CONFIG.KEYS.LEGACY_BOOKMARKS);

    if (rawUserKeys && Array.isArray(rawUserKeys)) return;

    if (rawLegacy && Array.isArray(rawLegacy) && rawLegacy.length > 0) {
        const keys = [];
        const customMeta = storageGet(CONFIG.KEYS.CUSTOM_META) || {};

        const existingCatUrls = new Set();
        (DEFAULT_CATEGORIES || []).forEach(cat => {
            (cat.bookmarks || []).forEach(bm => {
                if (bm.url) existingCatUrls.add(normalizeUrl(bm.url));
            });
        });

        rawLegacy.forEach(bm => {
            if (!bm || !bm.url) return;
            const normUrl = normalizeUrl(bm.url);
            keys.push(normUrl);
            if (!existingCatUrls.has(normUrl)) {
                customMeta[normUrl] = {
                    name: bm.name || '',
                    icon: bm.icon || '',
                    desc: bm.desc || ''
                };
            }
        });

        storageSet(CONFIG.KEYS.BOOKMARK_KEYS, keys);
        storageSet(CONFIG.KEYS.CUSTOM_META, customMeta);
        storageRemove(CONFIG.KEYS.LEGACY_BOOKMARKS);
    }
}

export function saveUserBookmarks(list) {
    const keys = [];
    const customMeta = storageGet(CONFIG.KEYS.CUSTOM_META) || {};
    const catMetaMap = new Map();
    (pageData.categories || []).forEach(cat => {
        (cat.bookmarks || []).forEach(bm => {
            if (bm.url) {
                const nUrl = normalizeUrl(bm.url);
                if (!catMetaMap.has(nUrl)) catMetaMap.set(nUrl, bm);
            }
        });
    });

    const newKeysSet = new Set();
    list.forEach(bm => {
        const normUrl = normalizeUrl(bm.url);
        if (!normUrl) return;
        keys.push(normUrl);
        newKeysSet.add(normUrl);
        const catBm = catMetaMap.get(normUrl);
        const isCustomized = !catBm || (bm.name && bm.name !== catBm.name) || (bm.icon && bm.icon !== (catBm.icon || faviconFromUrl(catBm.url))) || (bm.desc && bm.desc !== (catBm.desc || ''));
        if (isCustomized) {
            customMeta[normUrl] = {
                name: bm.name,
                icon: bm.icon,
                desc: bm.desc || ''
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

    storageSet(CONFIG.KEYS.BOOKMARK_KEYS, keys);
    storageSet(CONFIG.KEYS.CUSTOM_META, customMeta);
    pageData.bookmarks = getDerivedBookmarks(keys, pageData.categories, customMeta);
    renderBookmarks();
}

export async function loadUserData() {
    migrateBookmarksStorage();
    const userKeys = storageGet(CONFIG.KEYS.BOOKMARK_KEYS);
    const customMeta = storageGet(CONFIG.KEYS.CUSTOM_META) || {};

    if (userKeys && Array.isArray(userKeys) && userKeys.length) {
        pageData.bookmarks = getDerivedBookmarks(userKeys, pageData.categories, customMeta);
    } else {
        pageData.bookmarks = getDerivedBookmarks(DEFAULT_BOOKMARKS.map(b => b.url), pageData.categories, customMeta);
    }
    const bookmarksEl = dom.bookmarks || $('bookmarks');
    if (bookmarksEl) {
        renderBookmarks();
    }

    const savedBg = storageGet(CONFIG.KEYS.BG);
    if (savedBg !== null && typeof savedBg === 'number' && savedBg >= 0 && savedBg < backgrounds.length) {
        state.bg = savedBg;
    }

    let customBg = await getEffectiveCustomWallpaper();
    const legacyPresetIdx = findPresetBgIndex(customBg);
    if (legacyPresetIdx >= 0) {
        state.bg = legacyPresetIdx;
        storageSet(CONFIG.KEYS.BG, legacyPresetIdx);
        await clearCustomWallpaper();
        customBg = null;
    }
    if (customBg) {
        state.customWallpaper = customBg;
        applyWallpaper(customBg, false);
    } else {
        applyWallpaper(backgrounds[state.bg] || backgrounds[0], false);
    }
}

export function handleIconError(img) {
    if (!img || img.dataset.failed) return;
    img.dataset.failed = '1';
    const initial = img.dataset.initial || '?';
    const parent = img.parentElement;
    if (parent) {
        img.remove();
        const isMd = img.dataset.md === '1';
        const textClass = isMd ? 'text-xs' : 'text-2xs';
        parent.classList.add('bg-white/15', 'border', 'border-white/20', 'text-white/90', textClass, 'font-semibold');
        parent.textContent = initial;
    }
}
if (typeof window !== 'undefined') {
    window.handleIconError = handleIconError;
}

export function getFaviconHTML(bm, sizeType = 'sm') {
    const initial = (bm.name || '?').trim().charAt(0).toUpperCase();
    const isMd = sizeType === 'md';
    const sizeClass = isMd ? 'icon-box-md' : 'icon-box-sm';
    const textClass = isMd ? 'text-xs font-semibold' : 'text-2xs font-semibold';
    const safeIcon = safeUrl(bm.icon);
    
    if (!bm.icon || safeIcon === '#') {
        return createLetterBadgeHtml(initial, sizeClass, textClass);
    }
    const imgSize = isMd ? '32' : '24';
    const loadingAttr = isMd ? 'loading="eager" fetchpriority="high"' : 'loading="lazy" fetchpriority="low"';
    return `<div class="icon-box ${sizeClass}"><img src="${safeIcon}" width="${imgSize}" height="${imgSize}" data-initial="${escapeHtml(initial)}" data-md="${isMd ? '1' : '0'}" class="lazy-icon pointer-events-none select-none" alt="" ${loadingAttr} decoding="async" draggable="false"></div>`;
}

export function initFaviconObserver() {
    document.querySelectorAll('img.lazy-icon').forEach(img => {
        if (img.complete && img.naturalWidth > 0) {
            img.classList.add('loaded');
        }
    });
}

export function initPickerFaviconObserver() {
    const container = dom.pickerContent || $('pickerContent');
    if (!container) return;
    container.querySelectorAll('img.lazy-icon').forEach(img => {
        if (img.complete && img.naturalWidth > 0) {
            img.classList.add('loaded');
        }
    });
}

let lastBookmarksSignature = '';
export function renderBookmarks(force = false) {
    const bookmarksEl = dom.bookmarks || $('bookmarks');
    if (!bookmarksEl) return;
    const currentSig = JSON.stringify(pageData.bookmarks);
    if (!force && lastBookmarksSignature && currentSig === lastBookmarksSignature) return;
    lastBookmarksSignature = currentSig;

    bookmarksEl.innerHTML = pageData.bookmarks.map(bm => `
        <a href="${safeUrl(bm.url)}" target="_blank" rel="noopener noreferrer" 
           class="bookmark-item flex flex-col items-center justify-center gap-2 py-3 px-1 sm:px-1.5 apple-radius text-white/90 hover:text-white">
            ${getFaviconHTML(bm, 'md')}
            <span class="bookmark-title text-white/90">${escapeHtml(bm.name)}</span>
        </a>
    `).join('');

    bookmarksEl.querySelectorAll('img.lazy-icon').forEach(img => {
        if (img.complete && img.naturalWidth > 0) {
            img.classList.add('loaded');
        } else {
            img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
        }
    });
}

let lastNavCategoriesSignature = '';
let cachedSortedCategories = null;
let lastCategoriesRef = null;

export function getSortedCategories() {
    if (cachedSortedCategories && pageData.categories === lastCategoriesRef) {
        return cachedSortedCategories;
    }
    lastCategoriesRef = pageData.categories;
    cachedSortedCategories = pageData.categories.map(cat => ({
        ...cat,
        sortedBookmarks: [...cat.bookmarks].sort((a, b) => zhCollator.compare(a.name, b.name))
    }));
    return cachedSortedCategories;
}

let isSidebarNavInitialized = false;
let isManualScrolling = false;
let manualScrollTimer = null;
let cachedSidebarItems = [];
let cachedSidebarSections = [];
let cachedSectionOffsets = [];

export function refreshSidebarNavCache() {
    const sidebarList = dom.sidebarList || $('sidebarList');
    const navContent = dom.navContent || $('navContent');
    if (!sidebarList || !navContent) return;
    cachedSidebarItems = Array.from(sidebarList.querySelectorAll('[data-target]'));
    cachedSidebarSections = cachedSidebarItems.map(item => document.getElementById(item.dataset.target)).filter(Boolean);
    cachedSectionOffsets = cachedSidebarSections.map(s => s.offsetTop);
}

export function scrollTabIntoView(item, container) {
    if (!item || !container) return;
    const isMobile = window.innerWidth <= CONFIG.NAV.MOBILE_BREAKPOINT;
    const margin = CONFIG.NAV.TAB_SCROLL_MARGIN;
    if (isMobile) {
        const cRect = container.getBoundingClientRect();
        const iRect = item.getBoundingClientRect();
        if (iRect.left < cRect.left + margin || iRect.right > cRect.right - margin) {
            const targetLeft = item.offsetLeft - (container.clientWidth / 2) + (item.offsetWidth / 2);
            container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
        }
    } else {
        const cRect = container.getBoundingClientRect();
        const iRect = item.getBoundingClientRect();
        if (iRect.top < cRect.top + margin || iRect.bottom > cRect.bottom - margin) {
            const targetTop = item.offsetTop - (container.clientHeight / 2) + (item.offsetHeight / 2);
            container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
        }
    }
}

export function updateSidebarActive() {
    const sidebarContainer = dom.sidebar || $('sidebar');
    const sidebarList = dom.sidebarList || $('sidebarList');
    const content = dom.navContent || $('navContent');
    if (!sidebarList || !content || isManualScrolling) return;

    if (!cachedSidebarItems.length || !cachedSectionOffsets.length) refreshSidebarNavCache();
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

    items.forEach((item, i) => {
        const isActive = i === activeIdx;
        const wasActive = item.classList.contains('active');
        if (isActive !== wasActive) {
            item.classList.toggle('active', isActive);
            item.setAttribute('aria-selected', isActive ? 'true' : 'false');
        }
        if (isActive && !wasActive && !isManualScrolling) {
            scrollTabIntoView(item, sidebarContainer);
        }
    });
}

export function renderNavCategories(force = false) {
    const sidebarList = dom.sidebarList || $('sidebarList');
    const navCategories = dom.navCategories || $('navCategories');
    if (!sidebarList || !navCategories) return;

    const currentSig = JSON.stringify(pageData.categories);
    if (!force && lastNavCategoriesSignature && currentSig === lastNavCategoriesSignature) return;
    lastNavCategoriesSignature = currentSig;

    const navContent = dom.navContent || $('navContent');
    const savedScrollTop = navContent ? navContent.scrollTop : 0;
    const sortedCats = getSortedCategories();

    sidebarList.innerHTML = pageData.categories.map((cat, i) => `
        <button type="button" role="tab" id="cat-tab-${i}" aria-selected="${i === 0 ? 'true' : 'false'}" aria-controls="cat-${i}" class="sidebar-item w-full text-left text-xs md:text-sm px-2.5 py-[7px] min-h-9 text-white/70 flex items-center gap-2 ${i === 0 ? 'active' : ''}"
                data-target="cat-${i}" data-idx="${i}">
            <span class="text-sm shrink-0 sidebar-icon">${escapeHtml(cat.icon)}</span>
            <span class="truncate sidebar-label">${escapeHtml(cat.name)}</span>
        </button>
    `).join('');

    navCategories.innerHTML = sortedCats.map((cat, i) => {
        const sortedBookmarks = cat.sortedBookmarks;
        return `
        <div id="cat-${i}" role="tabpanel" aria-labelledby="cat-tab-${i}" class="category-block ${i > 0 ? 'scroll-mt-6' : ''}">
            <div class="category-header flex items-center justify-between pb-2.5 mb-3.5 transition-colors duration-300 select-none">
                <div class="flex items-center gap-2 select-none">
                    <span class="text-sm sm:text-base shrink-0 select-none">${escapeHtml(cat.icon)}</span>
                    <h3 class="text-xs sm:text-sm font-semibold tracking-wide text-white/90 select-none">${escapeHtml(cat.name)}</h3>
                </div>
                <span class="glass-badge shrink-0 select-none">${cat.bookmarks.length} 项</span>
            </div>
            <div class="nav-bookmark-grid">
                ${sortedBookmarks.map(bm => `
                    <a href="${safeUrl(bm.url)}" target="_blank" rel="noopener noreferrer"
                       class="nav-bookmark group flex items-center gap-2.5 px-3 py-2.5 md:px-3.5 md:py-2.5 apple-radius text-white/80 hover:text-white">
                        ${getFaviconHTML(bm, 'sm')}
                        ${bm.desc ? `
                            <div class="flex-1 min-w-0 flex flex-col justify-center">
                                <span class="text-xs md:text-sm font-semibold truncate leading-tight">${escapeHtml(bm.name)}</span>
                                <span class="text-2xs text-white/35 group-hover:text-white/60 truncate leading-none mt-1 transition-colors duration-150">${escapeHtml(bm.desc)}</span>
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

    refreshSidebarNavCache();
    initSidebarNav();
    initFaviconObserver();
    if (navContent && savedScrollTop > 0) {
        navContent.scrollTop = savedScrollTop;
    }
}

export function initSidebarNav() {
    const sidebarList = dom.sidebarList || $('sidebarList');
    const content = dom.navContent || $('navContent');
    if (!sidebarList || !content) return;

    updateSidebarActive();

    if (!isSidebarNavInitialized) {
        let resizeTimer = null;
        const handleResizeOrRotate = () => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                refreshSidebarNavCache();
                requestAnimationFrame(updateSidebarActive);
            }, CONFIG.NAV.RESIZE_DEBOUNCE);
        };
        window.addEventListener('resize', handleResizeOrRotate, { passive: true });
        window.addEventListener('orientationchange', handleResizeOrRotate, { passive: true });
        if ('ResizeObserver' in window && content) {
            try {
                const ro = new ResizeObserver(() => handleResizeOrRotate());
                ro.observe(content);
            } catch {}
        }

        sidebarList.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-target]');
            if (!btn) return;
            const targetId = btn.dataset.target;
            const target = document.getElementById(targetId);
            if (!target) return;

            isManualScrolling = true;
            if (manualScrollTimer) clearTimeout(manualScrollTimer);

            const allItems = Array.from(sidebarList.querySelectorAll('[data-target]'));
            allItems.forEach(item => item.classList.remove('active'));
            btn.classList.add('active');
            const sidebarContainer = dom.sidebar || $('sidebar');
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
        let scrollEndTimer = null;
        content.addEventListener('scroll', () => {
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
    urls.forEach(url => {
        const img = new Image();
        img.onload = img.onerror = () => { img.onload = img.onerror = null; };
        img.src = url;
    });
}
