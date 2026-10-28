import { modalState } from './store.js';

/** 草稿修改集中在此；调用方负责渲染与焦点，不从 DOM 读取书签字段。 */
/** @param {Array<import('../types').BookmarkItem & {id?: string, origUrl?: string}>} bookmarks @param {boolean} [changed] */
export function replaceBookmarkDraft(bookmarks, changed = false) {
    modalState.draftBookmarks = bookmarks.map((bm, i) => ({
        id: bm.id || `bm_${Date.now()}_${i}`,
        name: bm.name || '',
        url: bm.url || '',
        icon: bm.icon || '',
        origUrl: bm.origUrl || bm.url || '',
        desc: bm.desc,
        customText: bm.customText
    }));
    modalState.bookmarksChanged = changed;
}

/** @param {import('../types').DraftBookmarkItem} bookmark */
export function appendBookmarkDraft(bookmark) {
    modalState.draftBookmarks.push(bookmark);
    modalState.bookmarksChanged = true;
}

/** @param {string} id @param {{name?: string, url?: string}} fields */
export function updateBookmarkDraft(id, fields) {
    const item = modalState.draftBookmarks.find(bookmark => bookmark.id === id);
    if (!item) return null;
    if (fields.name !== undefined) item.name = fields.name;
    if (fields.url !== undefined) item.url = fields.url;
    modalState.bookmarksChanged = true;
    return item;
}

/** @param {string} id */
export function removeBookmarkDraft(id) {
    const index = modalState.draftBookmarks.findIndex(bookmark => bookmark.id === id);
    if (index < 0) return false;
    modalState.draftBookmarks.splice(index, 1);
    modalState.bookmarksChanged = true;
    return true;
}

/** @param {string} sourceId @param {string} targetId @param {boolean} before */
export function reorderBookmarkDraft(sourceId, targetId, before) {
    const bookmarks = modalState.draftBookmarks;
    const sourceIndex = bookmarks.findIndex(bookmark => bookmark.id === sourceId);
    const targetIndex = bookmarks.findIndex(bookmark => bookmark.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return false;
    const [moved] = bookmarks.splice(sourceIndex, 1);
    const destination = bookmarks.findIndex(bookmark => bookmark.id === targetId);
    bookmarks.splice(before ? destination : destination + 1, 0, moved);
    modalState.bookmarksChanged = true;
    return true;
}
