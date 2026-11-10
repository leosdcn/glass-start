import { bookmarkUrlKey } from './bookmark-model.js';

/** @type {Map<string, Intl.Collator>} */
const collators = new Map();
/** @param {string} locale */
function getCollator(locale) {
    let c = collators.get(locale);
    if (!c) {
        c = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
        collators.set(locale, c);
    }
    return c;
}

/** @type {string | undefined} */
let previousSignature;
/** @type {import('../types').CategoryCatalog | undefined} */
let cached;

/**
 * @param {import('../types').BookmarkCategory[]} categories
 * @param {string} locale
 * @returns {string}
 */
function getCatalogSignature(categories, locale) {
    return JSON.stringify([locale, categories.map(cat => [cat.name, cat.icon,
        (cat.bookmarks || []).map(b => [b.name, b.url, b.desc, b.icon])])]);
}

/**
 * 派生、保存、排序和搜索共用目录视图，内容变化时统一重建。
 * @param {import('../types').BookmarkCategory[]} categories
 * @returns {import('../types').CategoryCatalog}
 */
export function getCategoryCatalog(categories) {
    const locale = typeof window !== 'undefined' && window.__GLASS_I18N__?.locale ? window.__GLASS_I18N__.locale : 'zh-CN';
    const signature = getCatalogSignature(categories, locale);
    if (signature === previousSignature && cached) return cached;
    /** @type {Map<string, import('../types').BookmarkItem>} */
    const byUrl = new Map();
    /** @type {Map<string, string>} */
    const searchCategories = new Map();
    /** @type {import('../types').CategoryCatalogEntry[]} */
    const entries = [];
    const collator = getCollator(locale);
    const sorted = categories.map(cat => {
        const bookmarks = Array.isArray(cat.bookmarks) ? cat.bookmarks : [];
        for (const bm of bookmarks) {
            const normUrl = bookmarkUrlKey(bm.url);
            if (!normUrl) continue;
            if (!byUrl.has(normUrl)) byUrl.set(normUrl, bm);
            if (!searchCategories.has(normUrl)) searchCategories.set(normUrl, cat.name);
            entries.push({ bm, normUrl, defaultCat: cat.name || '' });
        }
        return { ...cat, bookmarks, sortedBookmarks: [...bookmarks].sort((a, b) => collator.compare(a.name, b.name)) };
    });
    previousSignature = signature;
    return cached = { byUrl, searchCategories, entries, sorted };
}
