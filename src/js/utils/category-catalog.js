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

/** @type {readonly import('../types').BookmarkCategory[] | undefined} */
let previousCategories;
let previousLocale = '';
/** @type {import('../types').CategoryCatalog | undefined} */
let cached;

/**
 * 目录发布后只读。内容更新时以新数组发布，由所有调用方共用新索引。
 * @param {readonly import('../types').BookmarkCategory[]} categories
 * @returns {import('../types').CategoryCatalog}
 */
export function getCategoryCatalog(categories) {
    const locale = typeof window !== 'undefined' && window.__GLASS_I18N__?.locale ? window.__GLASS_I18N__.locale : 'zh-CN';
    if (categories === previousCategories && locale === previousLocale && cached) return cached;
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
    previousCategories = categories;
    previousLocale = locale;
    return cached = { byUrl, searchCategories, entries, sorted };
}
