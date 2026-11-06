/** 书签字段清洗、共享 URL 标识与图标地址推导；不读取 DOM 或持久化数据。 */
import { t, canonicalBookmarkUrl } from '../core/i18n.js';
import { CONFIG } from '../config/constants.js';
import { safeUrl } from './helpers.js';

/**
 * 规范化用户输入的 URL：去除首尾空格、补 https://，旧中文预设入口对应到共享 URL
 * @param {string} url
 * @returns {string} 规范化后的 URL，空输入返回 ''
 */
export function normalizeUrl(url) {
    url = String(url || '').trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) {
        return canonicalBookmarkUrl('https://' + url);
    }
    return canonicalBookmarkUrl(url);
}

/**
 * 从给定的 URL 字符串中安全提取规范化 Hostname 并剥离前缀 www.
 * @param {string} url
 * @returns {string} 规范化 Hostname 或 ''
 */
function getHostname(url) {
    try {
        return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

/**
 * 从 URL 域名中提取用于兜底展示的站点名称
 * @param {string} url - 站点 URL 字符串
 * @returns {string} 提取到的站点名称或'书签'兜底文本
 */
export function deriveNameFromUrl(url) {
    const host = getHostname(url);
    return (host ? host.split('.')[0] : '') || t('ui.bookmark');
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

/**
 * 书签入口共用的字段清洗；草稿标识、图标随 URL 变更等编辑行为由调用方管理。
 * @param {any} item
 * @param {string} [fallbackName]
 * @returns {import('../types').BookmarkItem | null}
 */
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
    /** @type {import('../types').BookmarkItem} */
    const bookmark = { name, url, icon };
    // 缺省继承目录简介，空字符串是明确清空；不能将两者归并。
    if (typeof item.desc === 'string') bookmark.desc = item.desc.trim().slice(0, CONFIG.SECURITY.MAX_DESC_CHARS);
    return bookmark;
}

/**
 * 根据站点 URL 或原图标 URL 推断备用 Favicon 地址（通过 Google S2 服务）
 * @param {string} url - 书签目标 URL 或失效的图标 URL
 * @returns {string} Google S2 图标代理地址，无法推断时返回 ''
 */
export function faviconFallbackFromUrl(url) {
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
    return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${CONFIG.UI.FAVICON_FALLBACK_SIZE}` : '';
}
