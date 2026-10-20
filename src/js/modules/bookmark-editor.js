import { CONFIG } from '../config/constants.js';
import { escapeHtml, safeUrl, normalizeUrl, normalizeBookmark, faviconFromUrl, createLetterBadgeHtml, handleFaviconFailure, checkImageReady } from '../utils/helpers.js';
import { modalState } from '../state/store.js';
import { appendBookmarkDraft, replaceBookmarkDraft } from '../state/bookmark-draft.js';
import { dom } from '../state/dom.js';

export function getDraftBookmarkCount() {
    return modalState.draftBookmarks.length;
}

export function updateAllBookmarkCounters() {
    const text = `已添加 ${getDraftBookmarkCount()} 项`;
    const badge = dom.bookmarkCountBadge;
    const pickerCount = dom.pickerCount;
    if (badge) badge.textContent = text;
    if (pickerCount) pickerCount.textContent = text;
}

export function getEditFaviconInner(name = '', url = '', icon = '') {
    const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
    const faviconUrl = icon || faviconFromUrl(url);
    const safeFavicon = faviconUrl ? safeUrl(faviconUrl) : '';
    if (safeFavicon && safeFavicon !== '#') {
        return `<div class="icon-box icon-box-sm edit-favicon-img-wrapper pointer-events-none select-none"><img src="${safeFavicon}" width="${CONFIG.UI.ICON_SIZE_SM}" height="${CONFIG.UI.ICON_SIZE_SM}" data-initial="${escapeHtml(initial)}" data-url="${safeUrl(url)}" class="edit-favicon-img pointer-events-none select-none" alt="" decoding="async" draggable="false"></div>`;
    }
    return createLetterBadgeHtml(initial, 'icon-box-sm edit-favicon-initial', 'text-2xs font-semibold');
}

/**
 * @param {HTMLImageElement} img
 */
export function handleEditIconError(img) {
    handleFaviconFailure(img, img => {
        const initial = img.dataset.initial || '?';
        const box = img.closest('.edit-favicon-box');
        if (box) {
            box.innerHTML = createLetterBadgeHtml(initial, 'icon-box-sm edit-favicon-initial', 'text-2xs font-semibold');
        }
    });
}

/**
 * @param {string} [name]
 * @param {string} [url]
 * @param {string | number} [idx]
 * @param {string} [icon]
 * @param {string} [rowId]
 */
export function getEditRowHTML(name = '', url = '', idx = '', icon = '', rowId = '') {
    const id = rowId || (idx !== '' && idx !== undefined ? `bm_${idx}` : `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    return `
        <div role="listitem" class="edit-row-card flex items-center gap-1.5 sm:gap-2 p-1.5 sm:p-2 bg-white/5 border border-white/10 apple-radius glass-interactive group mb-1.5 shadow-xs" data-id="${escapeHtml(id)}" data-idx="${idx}" draggable="false">
            <div class="flex items-center gap-1 shrink-0">
                <button type="button" class="drag-handle touch-none p-1 size-7 flex items-center justify-center shrink-0 text-white/30 cursor-grab active:cursor-grabbing rounded-lg glass-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40" title="拖拽或按 Alt + ↑/↓ 排序" aria-label="排序书签：${escapeHtml(name)}，按 Alt 加上或下方向键移动">
                    <svg class="size-3.5 pointer-events-none" aria-hidden="true"><use href="#icon-drag"/></svg>
                </button>
                <div class="edit-favicon-box shrink-0 flex items-center justify-center text-white/90 select-none pointer-events-none">
                    ${getEditFaviconInner(name, url, icon)}
                </div>
            </div>
            <div class="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 items-center gap-1 sm:gap-1.5">
                <input type="text" id="bm-name-${id}" name="bookmark_name_${id}" class="edit-name w-full min-w-0 bg-black/25 border border-white/10 rounded-lg px-2.5 py-1 sm:py-1.5 text-base mouse-desktop:text-xs text-white/90 focus:border-white/40 focus:bg-black/40 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none outline-none transition-colors font-medium" value="${escapeHtml(name)}" placeholder="书签名称" aria-label="书签名称">
                <input type="text" id="bm-url-${id}" name="bookmark_url_${id}" inputmode="url" autocapitalize="off" class="edit-url w-full min-w-0 sm:col-span-2 bg-black/25 border border-white/10 rounded-lg px-2.5 py-1 sm:py-1.5 text-base mouse-desktop:text-xs text-white/60 focus:border-white/40 focus:bg-black/40 focus:text-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none outline-none transition-colors font-mono" value="${escapeHtml(url)}" placeholder="https://..." aria-label="书签网址">
            </div>
            <button type="button" class="del-btn shrink-0 size-7 sm:size-8 p-1 enabled:hover:bg-red-500/20 rounded-full text-white/30 enabled:hover:text-red-400 flex items-center justify-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed" title="删除书签" aria-label="删除书签">
                <svg class="size-4 pointer-events-none" aria-hidden="true"><use href="#icon-trash"/></svg>
            </button>
        </div>
    `;
}

/**
 * 创建并追加一条草稿书签行到编辑列表
 * @param {{ name?: string, url?: string, icon?: string, desc?: string, focus?: boolean }} [options]
 * @returns {HTMLElement|null} 创建的 DOM 节点
 */
export function appendDraftBookmarkRow({ name = '', url = '', icon = '', desc, focus = false } = {}) {
    const rowId = `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newBm = {
        id: rowId,
        name,
        url,
        icon: icon || '',
        origUrl: url || '',
        desc
    };
    appendBookmarkDraft(newBm);

    const editList = dom.editList;
    if (!editList) return null;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = getEditRowHTML(name, url, modalState.draftBookmarks.length - 1, icon, rowId).trim();
    const div = /** @type {HTMLElement|null} */ (tempDiv.firstElementChild);
    if (!div) return null;

    div.classList.add('animate-item-in');
    div.addEventListener('animationend', () => div.classList.remove('animate-item-in'), { once: true });
    editList.appendChild(div);

    const newImg = /** @type {HTMLImageElement|null} */ (div.querySelector('.edit-favicon-img'));
    if (newImg) {
        checkImageReady(newImg, handleEditIconError);
    }

    if (focus) {
        const input = /** @type {HTMLInputElement|null} */ (div.querySelector('.edit-name'));
        input?.focus();
    }

    updateAllBookmarkCounters();
    return div;
}

/**
 * @param {import('../types.js').DraftBookmarkItem[] | import('../types.js').BookmarkItem[]} [listToRender]
 */
export function renderEditList(listToRender) {
    if (Array.isArray(listToRender)) {
        replaceBookmarkDraft(listToRender, modalState.bookmarksChanged);
    }

    const editList = dom.editList;
    if (!editList) return;
    editList.innerHTML = '<div id="dragDropIndicator" class="drag-drop-line"></div><span class="bookmark-sort-status sr-only" role="status" aria-live="polite"></span>' + modalState.draftBookmarks.map((bm, i) => getEditRowHTML(bm.name, bm.url, i, bm.icon, bm.id)).join('');
    dom.dragDropIndicator = editList.querySelector('#dragDropIndicator');
    updateAllBookmarkCounters();

    editList.querySelectorAll('img.edit-favicon-img').forEach(img => {
        checkImageReady(/** @type {HTMLImageElement} */ (img), handleEditIconError);
    });
}

/**
 * 从内存草稿收集并清洗书签，不反向解析 DOM。
 * @returns {Array<{name: string, url: string, icon: string, desc?: string}>}
 */
export function collectEditData() {
    const sourceList = modalState.draftBookmarks;

    const bookmarks = [];
    for (let i = 0; i < sourceList.length; i++) {
        const item = sourceList[i];
        const bookmark = normalizeBookmark(item);
        if (!bookmark) continue;
        const { url } = bookmark;
        const origUrl = normalizeUrl(item.origUrl || '');
        if (origUrl && url !== origUrl) bookmark.icon = faviconFromUrl(url);
        bookmarks.push(bookmark);
    }
    return bookmarks;
}

export function getExistingUrls() {
    const urls = new Set();
    const sourceList = modalState.draftBookmarks;

    sourceList.forEach(bm => {
        const norm = normalizeUrl(bm.url);
        if (norm) urls.add(norm);
    });
    return urls;
}
