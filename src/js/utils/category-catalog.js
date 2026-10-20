import { normalizeUrl } from './helpers.js';

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
// 搜索去重键与持久化键语义不同；持久化使用完整的 normalizeUrl() 键。
/**
 * @param {string} url
 * @returns {string}
 */
export const searchUrlKey = url => (url || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
/** @type {string | undefined} */
let previousSignature;
/** @type {import('../types').CategoryCatalog | undefined} */
let cached;

/**
 * @param {import('../types').BookmarkCategory[] | undefined} categories
 * @returns {string}
 */
function getCatalogSignature(categories) {
    if (!categories || !Array.isArray(categories)) return '';
    let sig = '';
    for (let i = 0; i < categories.length; i++) {
        const cat = categories[i];
        if (!cat) continue;
        const bms = cat.bookmarks || [];
        sig += `[${cat.name || ''}:${bms.length}`;
        for (let j = 0; j < bms.length; j++) {
            const b = bms[j];
            if (b) sig += `;${b.name || ''},${b.url || ''},${b.desc || ''}`;
        }
        sig += ']';
    }
    return sig;
}

/**
 * 派生、保存、排序和搜索共用目录视图，内容变化时统一重建。
 * @param {import('../types').BookmarkCategory[]} [categories]
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
    const sorted = (Array.isArray(categories) ? categories : []).map(cat => {
        for (const bm of cat.bookmarks || []) {
            if (!bm.url) continue;
            const url = normalizeUrl(bm.url), key = searchUrlKey(bm.url);
            if (!byUrl.has(url)) byUrl.set(url, bm);
            if (!searchCategories.has(key)) searchCategories.set(key, cat.name);
            entries.push({ bm, normUrl: key, defaultCat: cat.name || '分类书签' });
        }
        return { ...cat, sortedBookmarks: [...(cat.bookmarks || [])].sort((a, b) => collator.compare(a.name, b.name)) };
    });
    previousSignature = signature;
    return cached = { byUrl, searchCategories, entries, sorted };
}
