/** 图标 HTML、加载状态与失败回退；不持有书签目录或设置草稿。 */
import { CONFIG } from '../config/constants.js';
import { escapeHtml, safeUrl } from './helpers.js';
import { faviconFallbackFromUrl } from './bookmark-model.js';

/**
 * 生成缺失图标的首字母徽标 HTML。
 * @param {string} initial - 首字母字符
 * @param {string} [sizeClass='icon-box-sm'] - 容器尺寸样式类
 * @param {string} [textClass='text-2xs font-semibold'] - 文字排版样式类
 * @returns {string} HTML 字符串
 */
export function createLetterBadgeHtml(initial, sizeClass = 'icon-box-sm', textClass = 'text-2xs font-semibold') {
    return `<div class="icon-box ${sizeClass} bg-white/15 border border-white/20 text-white/90 ${textClass} pointer-events-none select-none">${escapeHtml(initial)}</div>`;
}

/**
 * 安全淘汰 Service Worker Favicon 离线缓存
 * @param {string} url - 需失效的图标 URL
 * @returns {void}
 */
export function evictFaviconCache(url) {
    if (url && typeof caches !== 'undefined') {
        try {
            caches.open(CONFIG.CACHE.FAVICON).then(cache => cache.delete(url)).catch(() => {});
        } catch {}
    }
}

/**
 * 统一图标失败策略：备用地址只尝试一次，最终失败交给对应界面渲染。
 * @param {HTMLImageElement|null} img
 * @param {(img: HTMLImageElement) => void} renderFailure
 * @returns {void}
 */
export function handleFaviconFailure(img, renderFailure) {
    if (!img || img.dataset.failed) return;
    const fallback = faviconFallbackFromUrl(img.dataset.url || img.src);
    if (!img.dataset.fallback && fallback && img.src !== fallback) {
        img.dataset.fallback = '1';
        evictFaviconCache(img.src);
        img.src = fallback;
        return;
    }
    img.dataset.failed = '1';
    evictFaviconCache(img.src);
    renderFailure(img);
}

/**
 * 检测图片是否已从缓存就绪并同步状态类，已完成但破损时调用回调
 * @param {HTMLImageElement} img - 目标图片元素
 * @param {((img: HTMLImageElement) => void)|null} [onFallback=null] - 图片损坏时的兜底回调
 * @returns {boolean} 若图片已就绪则返回 true，破损或未完成返回 false
 */
export function checkImageReady(img, onFallback = null) {
    if (!img || !img.complete) return false;
    if (img.naturalWidth > 0) {
        img.classList.add('loaded');
        return true;
    }
    if (typeof onFallback === 'function') onFallback(img);
    return false;
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
