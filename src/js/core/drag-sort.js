/**
 * ==============================================================================
 * Glass Start — 书签编辑列表 HTML5 拖拽与 FLIP 物理吸附重排 (src/js/core/drag-sort.js)
 * ==============================================================================
 */
import { CONFIG } from '../config/constants.js';
import { dom, $ } from '../state/dom.js';
import { modalState } from '../state/store.js';
import {
    updateBookmarkCountBadge,
    getEditFaviconInner,
    handleEditIconError
} from '../modules/settings.js';

export function initDragSort() {
    let dragSrc = null;
    let dragOverRafId = null;
    let touchMoveRafId = null;
    let lastOverTarget = null;
    let lastIsTop = null;
    const editList = dom.editList || $('editList');
    if (!editList) return;

    function updateDragIndicator(target, isTop) {
        lastOverTarget = target;
        lastIsTop = isTop;
        const lineY = isTop ? (target.offsetTop - 4.5) : (target.offsetTop + target.offsetHeight + 1.5);
        if (dom.dragDropIndicator) {
            dom.dragDropIndicator.style.transform = `translate3d(0, ${lineY}px, 0)`;
            dom.dragDropIndicator.style.opacity = '1';
        }
    }

    function clearDragClasses() {
        if (dragOverRafId) {
            cancelAnimationFrame(dragOverRafId);
            dragOverRafId = null;
        }
        if (touchMoveRafId) {
            cancelAnimationFrame(touchMoveRafId);
            touchMoveRafId = null;
        }
        editList.querySelectorAll('.edit-row-card').forEach(el => {
            el.classList.remove('dragging');
        });
        if (dom.dragDropIndicator) {
            dom.dragDropIndicator.style.opacity = '0';
        }
        lastOverTarget = null;
        lastIsTop = null;
    }

    let isDragHandleActive = false;

    editList.addEventListener('mousedown', e => {
        const handle = e.target.closest('.drag-handle');
        const card = e.target.closest('.edit-row-card');
        if (handle && card) {
            isDragHandleActive = true;
            card.setAttribute('draggable', 'true');
            e.preventDefault();
            try { window.getSelection()?.removeAllRanges(); } catch (_) {}
            document.body.classList.add('bookmark-dragging');
        } else if (card) {
            isDragHandleActive = false;
            card.setAttribute('draggable', 'false');
        }
    });

    document.addEventListener('mouseup', () => {
        isDragHandleActive = false;
        document.body.classList.remove('bookmark-dragging');
        editList.querySelectorAll('.edit-row-card[draggable="true"]').forEach(card => {
            card.setAttribute('draggable', 'false');
        });
    }, { passive: true });

    editList.addEventListener('dragstart', e => {
        if (!isDragHandleActive) {
            e.preventDefault();
            return;
        }
        const item = e.target.closest('.edit-row-card');
        if (!item) {
            e.preventDefault();
            return;
        }
        dragSrc = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try {
            e.dataTransfer.setData('text/plain', item.dataset.idx || '');
        } catch (_) {}
    });

    editList.addEventListener('dragend', () => {
        isDragHandleActive = false;
        document.body.classList.remove('bookmark-dragging');
        editList.querySelectorAll('.edit-row-card[draggable="true"]').forEach(card => {
            card.setAttribute('draggable', 'false');
        });
        clearDragClasses();
        dragSrc = null;
    });

    editList.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const target = e.target.closest('.edit-row-card');
        if (!target || target === dragSrc) return;

        if (dragOverRafId) return;
        dragOverRafId = requestAnimationFrame(() => {
            dragOverRafId = null;
            const rect = target.getBoundingClientRect();
            const relY = (e.clientY - rect.top) / rect.height;

            let isTop = true;
            if (lastOverTarget === target && lastIsTop !== null) {
                isTop = lastIsTop ? (relY <= CONFIG.PHYSICS.DRAG_HYSTERESIS_HIGH) : (relY < CONFIG.PHYSICS.DRAG_HYSTERESIS_LOW);
            } else {
                isTop = relY < 0.5;
            }

            updateDragIndicator(target, isTop);
        });
    });

    editList.addEventListener('dragleave', e => {
        if (e.target === editList || !editList.contains(e.relatedTarget)) {
            clearDragClasses();
        }
    });

    editList.addEventListener('drop', e => {
        e.preventDefault();
        const target = lastOverTarget || e.target.closest('.edit-row-card');
        const isTop = lastIsTop !== null ? lastIsTop : true;
        clearDragClasses();

        if (!target || !dragSrc || target === dragSrc) return;

        const cards = Array.from(editList.querySelectorAll('.edit-row-card'));
        const firstPositions = new Map();
        cards.forEach(card => {
            firstPositions.set(card, card.getBoundingClientRect());
        });

        if (isTop) {
            target.parentNode.insertBefore(dragSrc, target);
        } else {
            target.parentNode.insertBefore(dragSrc, target.nextSibling);
        }
        modalState.bookmarksChanged = true;

        // 同步重新排列内存草稿数组顺序
        if (modalState.draftBookmarks && modalState.draftBookmarks.length > 0) {
            const currentRows = Array.from(editList.querySelectorAll('.edit-row-card'));
            const orderMap = new Map();
            currentRows.forEach((r, idx) => {
                if (r.dataset.id) orderMap.set(r.dataset.id, idx);
            });
            modalState.draftBookmarks.sort((a, b) => {
                const posA = orderMap.has(a.id) ? orderMap.get(a.id) : 9999;
                const posB = orderMap.has(b.id) ? orderMap.get(b.id) : 9999;
                return posA - posB;
            });
        }

        cards.forEach(card => {
            const first = firstPositions.get(card);
            const last = card.getBoundingClientRect();
            if (!first || !last) return;

            const deltaY = first.top - last.top;
            const deltaX = first.left - last.left;

            if (deltaY !== 0 || deltaX !== 0) {
                card.style.transition = 'none';
                card.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;

                requestAnimationFrame(() => {
                    card.style.transition = 'transform 0.35s var(--ease-overshoot)';
                    card.style.transform = 'translate3d(0, 0, 0)';
                });

                card.addEventListener('transitionend', (ev) => {
                    if (ev.propertyName !== 'transform') return;
                    card.style.transition = '';
                    card.style.transform = '';
                }, { once: true });
            }
        });

        updateBookmarkCountBadge();
    });

    let editFaviconDebounceTimer = null;
    editList.addEventListener('input', e => {
        const target = e.target;
        const row = target.closest('.edit-row-card');
        if (!row) return;

        const nameInput = row.querySelector('.edit-name');
        const urlInput = row.querySelector('.edit-url');
        const faviconBox = row.querySelector('.edit-favicon-box');
        if (!faviconBox) return;

        const nameVal = nameInput ? nameInput.value : '';
        const urlVal = urlInput ? urlInput.value : '';
        const initial = (nameVal || '?').trim().charAt(0).toUpperCase() || '?';

        const existingImg = faviconBox.querySelector('.edit-favicon-img');
        const existingInitial = faviconBox.querySelector('.edit-favicon-initial');
        if (existingImg) {
            existingImg.dataset.initial = initial;
        }
        if (existingInitial) {
            existingInitial.textContent = initial;
        }

        if (target.classList.contains('edit-url')) {
            clearTimeout(editFaviconDebounceTimer);
            editFaviconDebounceTimer = setTimeout(() => {
                faviconBox.innerHTML = getEditFaviconInner(nameVal, urlVal);
                const newImg = faviconBox.querySelector('.edit-favicon-img');
                if (newImg && newImg.complete) {
                    if (newImg.naturalWidth > 0) newImg.classList.add('loaded');
                    else handleEditIconError(newImg);
                }
            }, 180);
        } else if (target.classList.contains('edit-name')) {
            if (!existingImg || existingImg.dataset.failed === '1') {
                faviconBox.innerHTML = getEditFaviconInner(nameVal, urlVal);
                const newImg = faviconBox.querySelector('.edit-favicon-img');
                if (newImg && newImg.complete) {
                    if (newImg.naturalWidth > 0) newImg.classList.add('loaded');
                    else handleEditIconError(newImg);
                }
            }
        }
    });
}
