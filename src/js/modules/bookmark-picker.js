/**
 * 预置书签目录挑选器模块
 * 处理备选书签卡片渲染、动态可用性过滤以及挑选器弹窗生命周期。
 */
import { t } from '../core/i18n.js';
import { escapeHtml } from '../utils/helpers.js';
import { normalizeUrl } from '../utils/bookmark-model.js';
import { pageData } from '../state/store.js';
import { dom } from '../state/dom.js';
import { OverlayStack } from '../core/overlay-stack.js';
import { getFaviconHTML, getCategoryIconHTML, checkImageReady, handleIconError } from '../utils/favicon.js';
import { getCategoryCatalog } from '../utils/category-catalog.js';
import { updateAllBookmarkCounters, getExistingUrls, appendDraftBookmarkRow } from './bookmark-editor.js';

function initPickerFaviconObserver() {
    const container = dom.pickerContent;
    if (!container) return;
    container.querySelectorAll('img.lazy-icon').forEach(img => {
        checkImageReady(/** @type {HTMLImageElement} */ (img), handleIconError);
    });
}

/** @type {import('../types').CategoryCatalog | null} */
let pickerCatalog = null;
/** @type {Element | null} */
let pickerRoot = null;
/** @type {{ button: HTMLButtonElement, bookmark: import('../types').BookmarkItem }[]} */
let pickerEntries = [];
let pickerSelectionSignature = '';
/** @type {HTMLElement | null} */
let lastAddedRow = null;

/**
 * 获取当前已存在于编辑列表或已添加的 URL 集合并渲染备选卡片
 * @returns {void}
 */
function renderPickerCategories() {
    const pickerContent = dom.pickerContent;
    if (!pickerContent) return;
    const catalog = getCategoryCatalog(pageData.categories);
    if (pickerCatalog === catalog && pickerContent.firstElementChild === pickerRoot) {
        updatePickerAvailability();
        updateAllBookmarkCounters();
        return;
    }
    const urls = getExistingUrls();
    const sortedCats = catalog.sorted;

    pickerContent.innerHTML = sortedCats.map(cat => {
        const sortedBookmarks = cat.sortedBookmarks;
        return `
        <div>
            <div class="flex items-center gap-1.5 mb-1.5 pb-1 border-b border-white/5">
                <span class="size-4 shrink-0 flex items-center justify-center">${getCategoryIconHTML(cat.icon, 'size-3.5')}</span>
                <h4 class="text-xs font-medium text-white/70">${escapeHtml(cat.name)}</h4>
                <span class="ml-auto text-2xs text-white/20">${cat.bookmarks.length}</span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-1">
                ${sortedBookmarks.map(bm => {
                    const exists = urls.has(normalizeUrl(bm.url));
                    const faviconHtml = getFaviconHTML(bm, 'sm');
                    return `
                        <button type="button" class="w-full flex items-center gap-2 px-2 py-1.5 apple-radius picker-item text-left select-none ${exists ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}" ${exists ? 'disabled aria-disabled="true"' : ''} aria-label="${exists ? escapeHtml(t('bookmark.existsLabel', { name: bm.name })) : escapeHtml(t('bookmark.addLabel', { name: bm.name }))}" data-url="${escapeHtml(bm.url)}">
                            ${faviconHtml}
                            <span class="text-xs text-white/70 truncate flex-1 min-w-0">${escapeHtml(bm.name)}</span>
                            ${exists
                                ? `<span class="text-2xs text-white/20 shrink-0">${escapeHtml(t('ui.already.added'))}</span>`
                                : '<span class="text-white/40 shrink-0 text-sm">+</span>'
                            }
                        </button>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    }).join('');
    pickerCatalog = catalog;
    pickerRoot = pickerContent.firstElementChild;
    const bookmarks = sortedCats.flatMap(cat => cat.sortedBookmarks);
    pickerEntries = Array.from(pickerContent.querySelectorAll('.picker-item'), (node, i) => ({
        button: /** @type {HTMLButtonElement} */ (node), bookmark: bookmarks[i]
    }));
    pickerSelectionSignature = JSON.stringify([...urls].sort());
    updateAllBookmarkCounters();
    initPickerFaviconObserver();
}

/** 草稿成员变化只更新受影响的卡片，保留已经加载的图片及滚动位置。 */
function updatePickerAvailability() {
    const urls = getExistingUrls();
    const signature = JSON.stringify([...urls].sort());
    if (signature === pickerSelectionSignature) return;
    pickerSelectionSignature = signature;
    for (const { button, bookmark } of pickerEntries) {
        const exists = urls.has(normalizeUrl(bookmark.url));
        if (button.disabled === exists) continue;
        button.disabled = exists;
        button.classList.toggle('opacity-40', exists);
        button.classList.toggle('cursor-not-allowed', exists);
        button.classList.toggle('cursor-pointer', !exists);
        if (exists) button.setAttribute('aria-disabled', 'true');
        else button.removeAttribute('aria-disabled');
        button.setAttribute('aria-label', exists ? t('bookmark.existsLabel', { name: bookmark.name }) : t('bookmark.addLabel', { name: bookmark.name }));
        const status = button.lastElementChild;
        if (status) {
            status.textContent = exists ? t('ui.already.added') : '+';
            status.className = exists ? 'text-2xs text-white/20 shrink-0' : 'text-white/40 shrink-0 text-sm';
        }
    }
}

/** @param {string} url */
export function addBookmarkFromPicker(url) {
    const key = normalizeUrl(url);
    const bookmark = getCategoryCatalog(pageData.categories).byUrl.get(key);
    if (!bookmark || getExistingUrls().has(key)) return;
    lastAddedRow = appendDraftBookmarkRow(bookmark);
    updatePickerAvailability();
}

/**
 * @param {Element | null} [triggerEl]
 */
export function openBookmarkPicker(triggerEl = null) {
    const opener = triggerEl || document.activeElement || dom.togglePickerBtn;
    dom.togglePickerBtn?.setAttribute('aria-expanded', 'true');
    OverlayStack.push('bookmarkPicker', closeBookmarkPicker, opener);
    renderPickerCategories();
}

export function closeBookmarkPicker() {
    const closed = OverlayStack.pop('bookmarkPicker');
    dom.togglePickerBtn?.setAttribute('aria-expanded', 'false');
    const row = lastAddedRow;
    lastAddedRow = null;
    if (closed && row) requestAnimationFrame(async () => {
        // 入场动画会暂时移动行的位置，等它结束再对齐。
        await Promise.allSettled(row.getAnimations().map(animation => animation.finished));
        if (OverlayStack.top()?.id === 'editModal' && row.parentElement === dom.editList) {
            row.scrollIntoView({ block: 'nearest' });
        }
    });
}
