/**
 * ==============================================================================
 * Glass Start — 书签编辑列表 HTML5 拖拽与 FLIP 物理吸附重排 (src/js/core/drag-sort.js)
 * ==============================================================================
 */
import { CONFIG } from '../config/constants.js';
import { dom, $ } from '../state/dom.js';
import { modalState } from '../state/store.js';
import { updateBookmarkCountBadge } from '../modules/settings.js';

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
        const lineY = isTop
            ? (target.offsetTop + CONFIG.PHYSICS.DRAG_INDICATOR_OFFSET_TOP)
            : (target.offsetTop + target.offsetHeight + CONFIG.PHYSICS.DRAG_INDICATOR_OFFSET_BOTTOM);
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
    let dragSettlingRaf = null;

    function blurActiveHandle() {
        if (document.activeElement && document.activeElement.closest('.drag-handle')) {
            document.activeElement.blur();
        }
    }

    function settleDragHover() {
        if (dragSettlingRaf) cancelAnimationFrame(dragSettlingRaf);
        document.body.classList.add('drag-settling');
        const clear = () => {
            document.body.classList.remove('drag-settling');
            document.removeEventListener('pointermove', clear, { capture: true });
            dragSettlingRaf = null;
        };
        // 在下一帧后注册 pointermove 监听，避免当前帧立即触发
        dragSettlingRaf = requestAnimationFrame(() => {
            dragSettlingRaf = requestAnimationFrame(() => {
                document.addEventListener('pointermove', clear, { capture: true, once: true, passive: true });
            });
        });
    }

    editList.addEventListener('mousedown', e => {
        const handle = e.target.closest('.drag-handle');
        const card = e.target.closest('.edit-row-card');
        if (handle && card) {
            isDragHandleActive = true;
            card.setAttribute('draggable', 'true');
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
        blurActiveHandle();
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
        blurActiveHandle();
        try { window.getSelection()?.removeAllRanges(); } catch (_) {}
        document.body.classList.add('bookmark-dragging');
        dragSrc = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try {
            e.dataTransfer.setData('text/plain', item.dataset.id || item.dataset.idx || '');
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
        blurActiveHandle();
        settleDragHover();
    });

    editList.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const target = e.target.closest('.edit-row-card');
        if (!target || target === dragSrc) return;

        const rect = target.getBoundingClientRect();
        const relY = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
        let isTop = true;
        if (lastOverTarget === target && lastIsTop !== null) {
            isTop = lastIsTop ? (relY <= CONFIG.PHYSICS.DRAG_HYSTERESIS_HIGH) : (relY < CONFIG.PHYSICS.DRAG_HYSTERESIS_LOW);
        } else {
            isTop = relY < 0.5;
        }

        lastOverTarget = target;
        lastIsTop = isTop;

        if (!dragOverRafId) {
            dragOverRafId = requestAnimationFrame(() => {
                dragOverRafId = null;
                if (lastOverTarget && lastIsTop !== null) {
                    updateDragIndicator(lastOverTarget, lastIsTop);
                }
            });
        }
    });

    editList.addEventListener('dragleave', e => {
        if (e.target === editList || !editList.contains(e.relatedTarget)) {
            clearDragClasses();
        }
    });

    editList.addEventListener('drop', e => {
        e.preventDefault();
        let target = lastOverTarget || e.target.closest('.edit-row-card');
        let isTop = lastIsTop;

        if (target && isTop === null) {
            const rect = target.getBoundingClientRect();
            const relY = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
            isTop = relY < 0.5;
        } else if (isTop === null) {
            isTop = true;
        }

        clearDragClasses();
        blurActiveHandle();

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

        // 同步重新排列内存草稿数组顺序 (基于内存索引移位，杜绝 DOM 搜刮)
        if (modalState.draftBookmarks && modalState.draftBookmarks.length > 0 && dragSrc.dataset.id && target.dataset.id) {
            const dragId = dragSrc.dataset.id;
            const targetId = target.dataset.id;
            const srcIdx = modalState.draftBookmarks.findIndex(b => b.id === dragId);
            if (srcIdx !== -1) {
                const [moved] = modalState.draftBookmarks.splice(srcIdx, 1);
                const destIdx = modalState.draftBookmarks.findIndex(b => b.id === targetId);
                if (destIdx !== -1) {
                    const insertIdx = isTop ? destIdx : destIdx + 1;
                    modalState.draftBookmarks.splice(insertIdx, 0, moved);
                } else {
                    modalState.draftBookmarks.push(moved);
                }
            }
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
                    const flipSec = `${CONFIG.TIMERS.FLIP_DURATION_MS / 1000}s`;
                    card.style.transition = `transform ${flipSec} var(--ease-overshoot)`;
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
}
