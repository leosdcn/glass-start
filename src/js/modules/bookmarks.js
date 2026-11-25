/**
 * 书签派生、持久化与首屏快捷书签渲染；分类导航页与侧边栏见 bookmarks-nav.js。
 */
import { getLocale, localizeBookmarkUrl } from '../core/i18n.js';
import { CONFIG, DEFAULT_BOOKMARKS } from '../config/constants.js';
import { escapeHtml, safeUrl } from '../utils/helpers.js';
import { bookmarkUrlKey, normalizeBookmarkUrl, normalizeBookmark, normalizeBookmarks, normalizeBookmarkOverrides, deriveNameFromUrl, faviconFromUrl } from '../utils/bookmark-model.js';
import { getFaviconHTML, checkImageReady } from '../utils/favicon.js';
import { storageGet, storageSet, storageRemove } from '../utils/storage.js';
import { pageData } from '../state/store.js';
import { dom } from '../state/dom.js';
import { getCategoryCatalog } from '../utils/category-catalog.js';

function readBookmarkRecord() {
    const missing = Symbol();
    const record = storageGet(CONFIG.KEYS.BOOKMARKS, missing, null);
    if (record === missing) {
        return { keys: storageGet(CONFIG.KEYS.BOOKMARK_KEYS), meta: storageGet(CONFIG.KEYS.CUSTOM_META) };
    }
    return record?.version === 1 ? record : null;
}

/** @param {unknown} stored @param {string[]} urls */
function getCustomMeta(stored, urls) {
    /** @type {Map<string, import('../types').CustomMetaItem>} */
    const entries = new Map();
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return entries;
    const sources = new Set(urls);
    const first = new Map();
    for (const url of sources) {
        const key = bookmarkUrlKey(url);
        if (key && !first.has(key)) first.set(key, url);
    }
    for (const [url, meta] of Object.entries(stored)) {
        const key = bookmarkUrlKey(normalizeBookmarkUrl(url));
        const selected = first.get(key);
        // 后续重复条目的覆盖不能改变首条，兼容旧存储中只用别名保存的元数据。
        if (!key || (selected !== url && sources.has(url))) continue;
        if (!entries.has(key) || selected === url) entries.set(key, normalizeBookmarkOverrides(meta));
    }
    return entries;
}

/**
 * @param {string[]} keys
 * @param {readonly import('../types').BookmarkCategory[]} categories
 * @param {Record<string, import('../types').CustomMetaItem>} [customMeta]
 * @returns {import('../types').BookmarkItem[]}
 */
export function getDerivedBookmarks(keys, categories, customMeta = {}) {
    const catalog = getCategoryCatalog(categories).byUrl;
    const meta = getCustomMeta(customMeta, keys);
    const seen = new Set();
    return keys.flatMap(value => {
        const url = normalizeBookmarkUrl(value);
        const key = bookmarkUrlKey(url);
        if (!key || seen.has(key)) return [];
        seen.add(key);
        const entry = catalog.get(key);
        const overrides = meta.get(key) ?? {};
        return {
            url,
            name: overrides.name ?? entry?.name ?? deriveNameFromUrl(url),
            icon: overrides.icon || entry?.icon || faviconFromUrl(url),
            desc: overrides.desc ?? entry?.desc ?? '',
            overrides
        };
    });
}

/** @param {import('../types').BookmarkItem[]} list */
export function getImportedBookmarks(list) {
    const catalog = getCategoryCatalog(pageData.categories).byUrl;
    const meta = Object.fromEntries(list.map(bookmark => {
        const explicit = normalizeBookmarkOverrides(bookmark);
        // 没有可继承的目录项时，备份中的显示值仍能独立恢复。
        return [bookmark.url, catalog.has(bookmarkUrlKey(bookmark.url))
            ? bookmark.overrides ?? explicit : { ...explicit, ...bookmark.overrides }];
    }));
    return getDerivedBookmarks(list.map(bookmark => bookmark.url), pageData.categories, meta);
}

/** @param {import('../types').BookmarkItem[]} list @param {string} [expectedRevision] */
export function saveUserBookmarks(list, expectedRevision) {
    if (expectedRevision !== undefined && JSON.stringify(readBookmarkRecord()) !== expectedRevision) return 'conflict';
    const bookmarks = normalizeBookmarks(list, item => normalizeBookmark(item, deriveNameFromUrl(item?.url)));
    const keys = bookmarks.map(bookmark => bookmark.url);
    const customMeta = Object.fromEntries(bookmarks.flatMap(bookmark => {
        const overrides = bookmark.overrides ?? normalizeBookmarkOverrides(bookmark);
        return Object.keys(overrides).length ? [[bookmark.url, overrides]] : [];
    }));

    return writeBookmarkRecord(keys, customMeta);
}

/** 重置书签存储并通过同一恢复入口同步内存和视图。 */
export function resetUserBookmarks() {
    // null 表示随语言使用默认顺序，同时覆盖旧格式中仍存在的记录。
    const saved = writeBookmarkRecord(null, {});
    if (!saved) return false;
    return saved;
}

export function getBookmarkRevision() {
    return JSON.stringify(readBookmarkRecord());
}

export function loadBookmarks() {
    const record = readBookmarkRecord();
    const revision = JSON.stringify(record);
    applyBookmarkRecord(record, revision);
    return revision;
}

/** @param {string[] | null} keys @param {Record<string, import('../types').CustomMetaItem>} meta */
function writeBookmarkRecord(keys, meta) {
    const record = { version: 1, keys, meta };
    if (!storageSet(CONFIG.KEYS.BOOKMARKS, record)) return false;
    [CONFIG.KEYS.BOOKMARK_KEYS, CONFIG.KEYS.CUSTOM_META].forEach(storageRemove);
    const revision = JSON.stringify(record);
    applyBookmarkRecord(record, revision);
    return { revision, bookmarks: pageData.bookmarks };
}

/** @type {({ revision: string, locale: string } & import('../types').PageData) | null} */
let appliedBookmarkRecord = null;

/** @param {{ keys?: unknown, meta?: Record<string, import('../types').CustomMetaItem> } | null} record @param {string} revision */
function applyBookmarkRecord(record, revision) {
    const locale = getLocale();
    const { categories, bookmarks } = pageData;
    if (appliedBookmarkRecord?.revision === revision && appliedBookmarkRecord.locale === locale &&
        appliedBookmarkRecord.categories === categories && appliedBookmarkRecord.bookmarks === bookmarks) return;

    const storedKeys = record?.keys;
    const userKeys = Array.isArray(storedKeys)
        ? storedKeys.filter(url => typeof url === 'string' && normalizeBookmarkUrl(url)) : [];
    const customMeta = record?.meta;

    if (userKeys.length) {
        pageData.bookmarks = getDerivedBookmarks(userKeys, categories, customMeta);
    } else {
        const defaultKeys = locale === 'en' ? window.__GLASS_I18N__?.catalogs?.en?.defaultBookmarks : undefined;
        pageData.bookmarks = getDerivedBookmarks(defaultKeys || DEFAULT_BOOKMARKS.map(b => b.url), categories, customMeta);
    }
    renderBookmarks();
    appliedBookmarkRecord = { revision, locale, categories, bookmarks: pageData.bookmarks };
}

/** @param {import('../types').BookmarkItem} bm */
function getBookmarkCardHTML(bm) {
    return `
        <a href="${safeUrl(localizeBookmarkUrl(bm.url))}" target="_blank" rel="noopener noreferrer"
           class="bookmark-item flex min-w-0 apple-radius text-white/90">
            <div class="bookmark-surface flex flex-1 flex-col items-center justify-center gap-2 py-3 px-1 sm:px-1.5">
                ${getFaviconHTML(bm, 'md')}
                <span class="bookmark-title text-white/90">${escapeHtml(bm.name)}</span>
            </div>
        </a>
    `;
}

let lastBookmarksSignature = '';
export function renderBookmarks() {
    const bookmarksEl = dom.bookmarks;
    if (!bookmarksEl) return;
    const currentSig = JSON.stringify(pageData.bookmarks.map(({ url, name, icon }) => [url, name, icon]));
    if (lastBookmarksSignature && currentSig === lastBookmarksSignature) return;
    lastBookmarksSignature = currentSig;

    bookmarksEl.innerHTML = pageData.bookmarks.map(getBookmarkCardHTML).join('');
    bookmarksEl.querySelectorAll('img.lazy-icon').forEach(img => checkImageReady(/** @type {HTMLImageElement} */ (img)));
}
