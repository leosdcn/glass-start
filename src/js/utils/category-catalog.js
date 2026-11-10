import { bookmarkUrlKey } from './bookmark-model.js';

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
/** @type {string | undefined} */
let previousSignature;
/** @type {import('../types').CategoryCatalog | undefined} */
let cached;

/**
 * @param {import('../types').BookmarkCategory[]} categories
 * @returns {string}
 */
function getCatalogSignature(categories) {
    return JSON.stringify(categories.map(cat => [cat.name, cat.icon,
        cat.bookmarks.map(b => [b.name, b.url, b.desc, b.icon])]));
}

/**
 * 派生、保存、排序和搜索共用目录视图，内容变化时统一重建。
 * @param {import('../types').BookmarkCategory[]} categories
 * @returns {import('../types').CategoryCatalog}
 */
export function getCategoryCatalog(categories) {
    const signature = getCatalogSignature(categories);
    if (signature === previousSignature && cached) return cached;
    /** @type {Map<string, import('../types').BookmarkItem>} */
    const byUrl = new Map();
    /** @type {Map<string, string>} */
    const searchCategories = new Map();
    /** @type {import('../types').CategoryCatalogEntry[]} */
    const entries = [];
    const sorted = categories.map(cat => {
        for (const bm of cat.bookmarks) {
            const normUrl = bookmarkUrlKey(bm.url);
            if (!normUrl) continue;
            if (!byUrl.has(normUrl)) byUrl.set(normUrl, bm);
            if (!searchCategories.has(normUrl)) searchCategories.set(normUrl, cat.name);
            entries.push({ bm, normUrl, defaultCat: cat.name || '分类书签' });
        }
        return { ...cat, sortedBookmarks: [...cat.bookmarks].sort((a, b) => collator.compare(a.name, b.name)) };
    });
    previousSignature = signature;
    return cached = { byUrl, searchCategories, entries, sorted };
}
