/**
 * 工具函数集
 */

import { CONFIG } from '../config/constants.js';

const htmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const htmlEscapeRegex = /[&<>"']/g;
/**
 * 将字符串中的 HTML 特殊字符转义为实体，防止 XSS
 * @param {string} str
 * @returns {string} HTML 转义后的安全字符串
 */
export function escapeHtml(str) {
    return String(str ?? '').replace(htmlEscapeRegex, ch => htmlEscapes[ch]);
}

/**
 * 协议白名单校验与 URL 安全过滤函数
 * 允许 HTTP(S)、图片 Data URL 及本地 icons/*.png 路径，返回 HTML 属性用转义值。
 * @param {string} url - 待校验的原始 URL 字符串
 * @returns {string} 校验通过返回经过 HTML 实体转义的 URL，校验失败时返回 '#' 安全占位符
 */
export function safeUrl(url) {
    const u = (url || '').trim();
    return (/^https?:\/\//i.test(u) || /^data:image\//i.test(u) || /^(\.\/|\/)?icons\/[a-zA-Z0-9_\-.]+\.png$/i.test(u)) ? escapeHtml(u) : '#';
}

/**
 * 规范化用户输入的 URL：去除首尾空格，若缺少协议头则自动补 https://
 * @param {string} url
 * @returns {string} 规范化后的 URL，空输入返回 ''
 */
export function normalizeUrl(url) {
    url = String(url || '').trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) {
        return 'https://' + url;
    }
    return url;
}

/**
 * 从给定的 URL 字符串中安全提取规范化 Hostname 并剥离前缀 www.
 * @param {string} url
 * @returns {string} 规范化 Hostname 或 ''
 */
export function getHostname(url) {
    try {
        return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

/**
 * 从 URL 域名或路径中提取用于兜底展示的站点名称
 * @param {string} url - 站点 URL 字符串
 * @returns {string} 提取到的站点名称或'书签'兜底文本
 */
export function deriveNameFromUrl(url) {
    const host = getHostname(url);
    return (host ? host.split('.')[0] : '') || '书签';
}

/**
 * 根据书签 URL 自动推断其 favicon 地址（通过 a.favicon.im 服务）
 * @param {string} url - 书签的目标 URL
 * @returns {string} a.favicon.im 代理地址，URL 解析失败时返回 ''
 */
export function faviconFromUrl(url) {
    const host = getHostname(url);
    return host ? 'https://a.favicon.im/' + host : '';
}

/** 书签入口共用的字段清洗；草稿标识、图标随 URL 变更等编辑行为由调用方管理。 */
export function normalizeBookmark(item, fallbackName = '') {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const name = String(item.name || fallbackName).trim().slice(0, CONFIG.SECURITY.MAX_NAME_CHARS);
    const rawUrl = String(item.url || '').trim();
    if (/^[a-z][a-z\d+.-]*:(?!\d+(?:[/?#]|$))/i.test(rawUrl) && !/^https?:\/\//i.test(rawUrl)) return null;
    const url = normalizeUrl(rawUrl);
    if (!name || !url) return null;
    try { if (!new URL(url).hostname) return null; } catch { return null; }
    const rawIcon = typeof item.icon === 'string' ? item.icon.trim() : '';
    const icon = rawIcon && safeUrl(rawIcon) !== '#' ? rawIcon : faviconFromUrl(url);
    const bookmark = { name, url, icon };
    // 缺省继承目录简介，空字符串是明确清空；不能将两者归并。
    if (typeof item.desc === 'string') bookmark.desc = item.desc.trim().slice(0, CONFIG.SECURITY.MAX_DESC_CHARS);
    return bookmark;
}

/**
 * 根据站点 URL 或原图标 URL 推断备用 Favicon 地址（通过 Google S2 服务）
 * @param {string} url - 书签目标 URL 或失效的图标 URL
 * @param {number} [size] - 图标分辨率，默认取配置
 * @returns {string} Google S2 图标代理地址，无法推断时返回 ''
 */
export function faviconFallbackFromUrl(url, size = CONFIG.UI.FAVICON_FALLBACK_SIZE) {
    if (!url) return '';
    let host = getHostname(url);
    if (!host || host === 'a.favicon.im') {
        try {
            const u = new URL(normalizeUrl(url));
            if (u.hostname === 'a.favicon.im' || u.hostname === 'www.a.favicon.im') {
                host = u.pathname.replace(/^\/+/, '').split('/')[0];
            }
        } catch {
            // ignore
        }
    }
    return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}` : '';
}


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
 * 数值区间限制 clamp
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
}

/**
 * 安全读取 localStorage 中的配置项并反序列化为 JSON
 * @param {string} key - 存储的键名
 * @param {*} [fallback=null] - 当键名不存在或读取抛出异常时的默认返回值
 * @returns {*} 解析后的对象/数组或 fallback 默认值
 */
export function storageGet(key, fallback = null) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

/**
 * 安全写入 JSON 序列化数据至 localStorage
 * @param {string} key - 存储的键名
 * @param {*} value - 需要存储的数据对象/数组/值
 * @returns {boolean} 写入成功返回 true，被沙盒阻断或磁盘超限时返回 false
 */
export function storageSet(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

/**
 * 安全删除 localStorage 中的指定键名记录
 * @param {string} key - 需移除的键名
 * @returns {boolean} 移除成功返回 true，抛出安全异常时返回 false
 */
export function storageRemove(key) {
    try {
        localStorage.removeItem(key);
        return true;
    } catch {
        return false;
    }
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
 * @param {number} [size] - 图标分辨率，默认取配置
 * @returns {void}
 */
export function handleFaviconFailure(img, renderFailure, size = CONFIG.UI.FAVICON_FALLBACK_SIZE) {
    if (!img || img.dataset.failed) return;
    const fallback = faviconFallbackFromUrl(img.dataset.url || img.src, size);
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
    if (!img) return false;
    if (img.complete) {
        if (img.naturalWidth > 0) {
            img.classList.add('loaded');
            return true;
        }
        if (typeof onFallback === 'function') {
            onFallback(img);
        }
        return false;
    }
    return false;
}


