import { modalState } from './store.js';

/** @typedef {import('../types').BookmarkItem & {id?: string, origUrl?: string}} DraftInput */

/** @param {DraftInput} bookmark @param {string} id @returns {import('../types').DraftBookmarkItem} */
function createDraft(bookmark, id) {
    const { name = '', icon = '', desc, url = '', origUrl = url } = bookmark;
    const overrides = { ...(bookmark.overrides ?? { name, icon, desc }) };
    return {
        id, url, origUrl, overrides,
        get name() { return overrides.name ?? name; },
        get icon() { return overrides.icon ?? icon; },
        get desc() { return overrides.desc ?? desc; }
    };
}

/** 草稿修改集中在此；调用方负责渲染与焦点，不从 DOM 读取书签字段。
 * @param {DraftInput[]} bookmarks @param {boolean} [changed]
 */
export function replaceBookmarkDraft(bookmarks, changed = false) {
    const revision = Date.now();
    modalState.draftBookmarks = bookmarks.map((bookmark, i) => createDraft(bookmark, bookmark.id || `bm_${revision}_${i}`));
    modalState.bookmarksChanged = changed;
}

/** @param {DraftInput & {id: string}} bookmark */
export function appendBookmarkDraft(bookmark) {
    const draft = createDraft(bookmark, bookmark.id);
    modalState.draftBookmarks.push(draft);
    modalState.bookmarksChanged = true;
    return draft;
}

/** @param {string} id @param {{name?: string, url?: string}} fields */
export function updateBookmarkDraft(id, fields) {
    const item = modalState.draftBookmarks.find(bookmark => bookmark.id === id);
    if (!item) return null;
    if (fields.name !== undefined) item.overrides.name = fields.name;
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
