/**
 * 分类目录与侧边栏导航渲染、导航图标调度
 */
import { localizeBookmarkUrl } from '../core/i18n.js';
import { isScreenTransitioning } from '../core/screen-state.js';
import { settleAnimation } from '../core/motion.js';
import { CONFIG } from '../config/constants.js';
import { escapeHtml, safeUrl, handleRovingKeyNav } from '../utils/helpers.js';
import { getFaviconHTML, getCategoryIconHTML, checkImageReady } from '../utils/favicon.js';
import { getCategoryCatalog } from '../utils/category-catalog.js';
import { pageData, state } from '../state/store.js';
import { dom } from '../state/dom.js';

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
    const { TABLET_BREAKPOINT, INITIAL_VISIBLE_CATEGORIES, NARROW_PRELOAD_CATEGORIES } = CONFIG.NAV;
    const limit = window.matchMedia(`(min-width: ${TABLET_BREAKPOINT}px)`).matches
        ? INITIAL_VISIBLE_CATEGORIES : NARROW_PRELOAD_CATEGORIES;
    const selector = `.category-block:nth-child(-n+${limit}) img[data-nav-src]`;
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
/** @type {HTMLElement[]} */
let cachedSidebarItems = [];
/** @type {HTMLElement[]} */
let cachedSidebarSections = [];
/** @type {number[]} */
let cachedSectionOffsets = [];
let sidebarCacheDirty = true;
/** @type {ResizeObserver | null} */
let sidebarLayoutObserver = null;

function refreshSidebarNavCache() {
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
    const isMobile = window.innerWidth < CONFIG.NAV.MOBILE_BREAKPOINT;
    const margin = CONFIG.NAV.TAB_SCROLL_MARGIN;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    const cRect = container.getBoundingClientRect();
    const iRect = item.getBoundingClientRect();
    if (isMobile) {
        if (iRect.left < cRect.left + margin || iRect.right > cRect.right - margin) {
            const targetLeft = container.scrollLeft + (iRect.left - cRect.left) - (container.clientWidth / 2) + (item.offsetWidth / 2);
            container.scrollTo({ left: Math.max(0, targetLeft), behavior });
        }
    } else {
        if (iRect.top < cRect.top + margin || iRect.bottom > cRect.bottom - margin) {
            const targetTop = container.scrollTop + (iRect.top - cRect.top) - (container.clientHeight / 2) + (item.offsetHeight / 2);
            container.scrollTo({ top: Math.max(0, targetTop), behavior });
        }
    }
}

export function updateSidebarActive() {
    const content = dom.navContent;
    if (!dom.sidebarList || !content) return;

    refreshSidebarNavCache();
    const items = cachedSidebarItems;
    const sections = cachedSidebarSections;
    if (!items.length || !sections.length) return;

    const scrollTop = content.scrollTop;
    if (scrollTop <= CONFIG.NAV.TOP_THRESHOLD) {
        selectSidebarTab(items[0]);
        return;
    }

    const containerHeight = content.clientHeight;
    const scrollHeight = content.scrollHeight;
    let activeIdx = 0;
    for (let i = 0; i < cachedSectionOffsets.length; i++) {
        if (cachedSectionOffsets[i] - scrollTop <= CONFIG.NAV.HEADER_OFFSET) {
            activeIdx = i;
        }
    }
    if (scrollTop + containerHeight >= scrollHeight - CONFIG.NAV.BOTTOM_TOLERANCE) {
        const bottomThreshold = containerHeight * CONFIG.NAV.BOTTOM_VISIBILITY_RATIO;
        for (let i = sections.length - 1; i >= 0; i--) {
            if (cachedSectionOffsets[i] - scrollTop <= bottomThreshold) {
                activeIdx = i;
                break;
            }
        }
    }

    selectSidebarTab(items[activeIdx]);
}

/** @param {HTMLElement} nextActive */
function selectSidebarTab(nextActive) {
    if (nextActive.classList.contains('active')) return;
    // 先读取侧栏几何信息，再更新高亮；避免 active 字重变更后立即强制布局。
    scrollTabIntoView(nextActive, dom.sidebar);
    const previous = dom.sidebarList?.querySelector('.sidebar-item.active');
    previous?.classList.remove('active');
    previous?.removeAttribute('aria-current');
    nextActive.classList.add('active');
    nextActive.setAttribute('aria-current', 'location');
}

/** @type {(() => void) | null} */
let cancelPulse = null;

export function cancelCategoryPulse() {
    cancelPulse?.();
}

/** @param {Element} line */
function pulseCategory(line) {
    cancelCategoryPulse();
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches) return;
    const easing = getComputedStyle(line).getPropertyValue('--ease-pulse').trim();
    const animation = line.animate([
        { opacity: 1 }, { opacity: 1, offset: 0.35, easing }, { opacity: 0.28 }
    ], { duration: 1200 });
    cancelPulse = settleAnimation(animation, motion, () => { cancelPulse = null; });
}

export function renderNavCategories() {
    const sidebarList = dom.sidebarList;
    const navCategories = dom.navCategories;
    if (!sidebarList || !navCategories) return;

    const catalog = getCategoryCatalog(pageData.categories);
    if (catalog === lastNavCatalog) return;
    lastNavCatalog = catalog;
    cancelCategoryPulse();

    const navContent = dom.navContent;
    // 首次构建时目录为空，无需读取滚动布局；重绘已有目录才保留位置。
    const hasCategories = Boolean(navCategories.firstElementChild);
    const savedScrollTop = navContent && hasCategories ? navContent.scrollTop : 0;
    if (!hasCategories && !navAllIconsActivated && isScreenTransitioning()) {
        navCategories.classList.add('nav-initial-entry');
    }
    const sortedCats = catalog.sorted;

    sidebarList.innerHTML = sortedCats.map((cat, i) => `
        <button type="button" id="cat-tab-${i}" ${i === 0 ? 'aria-current="location"' : ''} aria-controls="cat-${i}" class="sidebar-item w-full text-left text-xs md:text-sm px-2.5 py-1.75 min-h-9 text-white/70 flex items-center gap-2 ${i === 0 ? 'active' : ''}"
                data-target="cat-${i}">
            <span class="size-5 shrink-0 sidebar-icon flex items-center justify-center">${getCategoryIconHTML(cat.icon, 'size-4')}</span>
            <span class="truncate">${escapeHtml(cat.name)}</span>
        </button>
    `).join('');

    navCategories.innerHTML = sortedCats.map((cat, i) => {
        const sortedBookmarks = cat.sortedBookmarks;
        return `
        <section id="cat-${i}" aria-labelledby="cat-heading-${i}" class="category-block ${i > 0 ? 'scroll-mt-6' : ''}">
            <div class="category-header flex items-center gap-2.5 pb-2.5 mb-3.5 transition-colors duration-300 select-none">
                <span class="size-6 shrink-0 flex items-center justify-center">${getCategoryIconHTML(cat.icon, 'size-5')}</span>
                <h3 id="cat-heading-${i}" class="text-xs sm:text-sm font-semibold tracking-wide text-white/90">${escapeHtml(cat.name)}</h3>
                <span class="category-header-line" aria-hidden="true"></span>
            </div>
            <div class="nav-bookmark-grid">
                ${sortedBookmarks.map(bm => `
                    <a href="${safeUrl(localizeBookmarkUrl(bm.url))}" target="_blank" rel="noopener noreferrer"
                       class="nav-bookmark flex items-center gap-2.5 px-3 py-2.5 md:px-3.5 md:py-2.5 text-white/80">
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
        </section>
    `;
    }).join('');

    sidebarCacheDirty = true;
    const shouldMeasure = navIconsActivated || state.currentSection === 'nav';
    initSidebarNav();
    if (sidebarLayoutObserver && navContent) {
        const observer = sidebarLayoutObserver;
        observer.disconnect();
        observer.observe(navContent);
        if (navCategories) observer.observe(navCategories, { box: 'border-box' });
    }
    if (navContent && savedScrollTop > 0) {
        navContent.scrollTop = savedScrollTop;
    }
    if (shouldMeasure) updateSidebarActive();
}

function initSidebarNav() {
    const sidebarList = dom.sidebarList;
    const content = dom.navContent;
    if (!sidebarList || !content) return;

    if (!isSidebarNavInitialized) {
        /** @type {ReturnType<typeof setTimeout> | null} */
        let resizeTimer = null;
        const handleResizeOrRotate = () => {
            sidebarCacheDirty = true;
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (state.currentSection === 'nav') {
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

            const firstCategory = /** @type {HTMLElement | null} */ (dom.navCategories?.firstElementChild);
            const baseOffset = firstCategory?.offsetTop ?? 0;
            const top = Math.min(content.scrollHeight - content.clientHeight, Math.max(0, target.offsetTop - baseOffset));
            content.scrollTo({ top });

            const line = target.querySelector('.category-header-line');
            if (line) pulseCategory(line);
        });

        sidebarList.addEventListener('keydown', (e) => {
            const allItems = /** @type {HTMLElement[]} */ (Array.from(sidebarList.querySelectorAll('[data-target]')));
            const currentBtn = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('[data-target]') : null);
            handleRovingKeyNav(e, allItems, currentBtn, nextBtn => {
                nextBtn.click();
            });
        });

        let ticking = false;
        content.addEventListener('scroll', () => {
            if (!navAllIconsActivated) activateAllNavIcons();
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
