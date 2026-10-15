import { normalizeUrl } from './helpers.js';

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
// 搜索去重键与持久化键语义不同；持久化使用完整的 normalizeUrl() 键。
export const searchUrlKey = url => (url || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
let previousSignature, cached;

/** 派生、保存、排序和搜索共用目录视图，内容变化时统一重建。 */
export function getCategoryCatalog(categories) {
    const signature = JSON.stringify(categories || []);
    if (signature === previousSignature && cached) return cached;
    const byUrl = new Map(), searchCategories = new Map(), entries = [];
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
