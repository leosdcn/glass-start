import { t } from '../core/i18n.js';
/**
 * 书签重排：鼠标使用 HTML5 拖拽，触屏使用 touch 事件，共用草稿提交与 FLIP 动画。
 */
import { CONFIG } from '../config/constants.js';
import { dom } from '../state/dom.js';
import { modalState } from '../state/store.js';
import { reorderBookmarkDraft } from '../state/bookmark-draft.js';
import { updateAllBookmarkCounters } from './bookmark-editor.js';
import { animateBookmarkLayout } from './bookmark-motion.js';

let cancelCurrentDrag = () => {};

export function cancelDragSort() {
    cancelCurrentDrag();
}

export function initDragSort() {
    /** @type {HTMLElement | null} */
    let dragSrc = null;
    /** @type {number | null} */
    let dragOverRafId = null;
    /** @type {number | null} */
    let touchMoveRafId = null;
    let touchClientX = 0;
    let touchClientY = 0;
    /** @type {number | null} */
    let touchIdentifier = null;
    /** @type {HTMLElement | null} */
    let lastOverTarget = null;
    /** @type {boolean | null} */
    let lastIsTop = null;
    /** @type {HTMLElement | null} */
    let indicatorTarget = null;
    /** @type {boolean | null} */
    let indicatorIsTop = null;
    /** @type {DOMRect | null} */
    let cachedListRect = null;
    const editList = dom.editList;
    if (!editList) return;
    const currentEditList = editList;

    /**
     * @param {EventTarget | null} element
     * @param {number} clientY
     */
    function updateDropTarget(element, clientY) {
        const target = /** @type {HTMLElement | null} */ (element instanceof Element ? element.closest('.edit-row-card') : null);
        if (!dragSrc || !target || target === dragSrc || !currentEditList.contains(target)) {
            lastOverTarget = lastIsTop = null;
            return;
        }
        const rect = target.getBoundingClientRect();
        const relY = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
        const isTop = lastOverTarget === target && lastIsTop !== null
            ? (lastIsTop ? relY <= CONFIG.PHYSICS.DRAG_HYSTERESIS_HIGH : relY < CONFIG.PHYSICS.DRAG_HYSTERESIS_LOW)
            : relY < 0.5;
        lastOverTarget = target;
        lastIsTop = isTop;
    }

    function updateDragIndicator() {
        const target = lastOverTarget;
        const isTop = lastIsTop;
        if (indicatorTarget === target && indicatorIsTop === isTop) return;
        indicatorTarget?.classList.remove('drop-target-above', 'drop-target-below');
        target?.classList.add(isTop ? 'drop-target-above' : 'drop-target-below');
        indicatorTarget = target;
        indicatorIsTop = isTop;
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
        currentEditList.querySelectorAll('.edit-row-card').forEach(el => {
            el.classList.remove('dragging', 'drop-target-above', 'drop-target-below');
        });
        lastOverTarget = null;
        lastIsTop = null;
        indicatorTarget = null;
        indicatorIsTop = null;
    }

    let isDragHandleActive = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let dragSettlingTimer = null;

    function clearDragSettling() {
        if (dragSettlingTimer) {
            clearTimeout(dragSettlingTimer);
            dragSettlingTimer = null;
        }
        document.body.classList.remove('drag-settling');
        window.removeEventListener('pointermove', clearDragSettling, { capture: true });
    }

    function settleDragHover() {
        clearDragSettling();
        document.body.classList.add('drag-settling');
        // FLIP 动画结束后确定性恢复；指针移动亦可提前解除，消除鼠标静止导致的伪悬停锁定
        dragSettlingTimer = setTimeout(clearDragSettling, CONFIG.TIMERS.FLIP_DURATION_MS);
        queueMicrotask(() => {
            window.addEventListener('pointermove', clearDragSettling, { capture: true, once: true, passive: true });
        });
    }

    function blurActiveHandle() {
        const active = /** @type {HTMLElement|null} */ (document.activeElement);
        if (active && active.closest('.drag-handle')) {
            active.blur();
        }
    }

    function resetDragSession() {
        const hadPointerDrag = isDragHandleActive || dragSrc !== null;
        isDragHandleActive = false;
        document.body.classList.remove('bookmark-dragging');
        currentEditList.querySelectorAll('.edit-row-card[draggable="true"]').forEach(card => {
            card.setAttribute('draggable', 'false');
        });
        clearDragClasses();
        cachedListRect = null;
        dragSrc = null;
        touchIdentifier = null;
        if (hadPointerDrag) blurActiveHandle();
    }

    // ── 共享：DOM 重排 + draftBookmarks 同步 + FLIP 动画 ─────────────────────
    /**
     * @param {HTMLElement | null} src
     * @param {HTMLElement | null} target
     * @param {boolean} isTop
     */
    function commitReorder(src, target, isTop) {
        if (!src || !target || src === target) return;

        const srcIdx = modalState.draftBookmarks.findIndex(b => b.id === src.dataset.id);
        const targetIdx = modalState.draftBookmarks.findIndex(b => b.id === target.dataset.id);
        if (srcIdx < 0 || targetIdx < 0) return;

        animateBookmarkLayout(currentEditList, () => {
            currentEditList.insertBefore(src, isTop ? target : target.nextSibling);
            reorderBookmarkDraft(src.dataset.id || '', target.dataset.id || '', isTop);
        });

        updateAllBookmarkCounters();
    }

    currentEditList.addEventListener('keydown', e => {
        const targetEl = e.target instanceof Element ? e.target : null;
        const handle = targetEl?.closest('.drag-handle');
        if (!handle || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey
            || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        e.stopPropagation();
        const src = /** @type {HTMLElement|null} */ (handle.closest('.edit-row-card'));
        const index = modalState.draftBookmarks.findIndex(b => b.id === src?.dataset.id);
        const nextIndex = index + (e.key === 'ArrowUp' ? -1 : 1);
        if (index < 0 || nextIndex < 0 || nextIndex >= modalState.draftBookmarks.length) return;
        const next = modalState.draftBookmarks[nextIndex];
        const target = /** @type {HTMLElement|null} */ (currentEditList.querySelector(`.edit-row-card[data-id="${CSS.escape(next.id)}"]`));
        if (!target) return;
        commitReorder(src, target, nextIndex < index);
        const focusable = /** @type {HTMLElement} */ (handle);
        focusable.focus();
        const status = currentEditList.querySelector('.bookmark-sort-status');
        if (status) status.textContent = t('bookmark.moved', { name: modalState.draftBookmarks[nextIndex].name, position: nextIndex + 1, count: modalState.draftBookmarks.length });
    });

    // ── 鼠标路径：mousedown 控制 draggable ───────────────────────────────────
    currentEditList.addEventListener('mousedown', e => {
        const targetEl = e.target instanceof Element ? e.target : null;
        const handle = targetEl?.closest('.drag-handle');
        const card = targetEl?.closest('.edit-row-card');
        if (handle && card) {
            isDragHandleActive = true;
            card.setAttribute('draggable', 'true');
        } else if (card) {
            isDragHandleActive = false;
            card.setAttribute('draggable', 'false');
        }
    });

    document.addEventListener('mouseup', () => {
        resetDragSession();
    }, { passive: true });

    currentEditList.addEventListener('dragstart', e => {
        if (!isDragHandleActive) {
            e.preventDefault();
            return;
        }
        const targetEl = e.target instanceof Element ? e.target : null;
        const item = /** @type {HTMLElement|null} */ (targetEl?.closest('.edit-row-card'));
        if (!item) {
            e.preventDefault();
            return;
        }
        blurActiveHandle();
        try { window.getSelection()?.removeAllRanges(); } catch (_) {}
        document.body.classList.add('bookmark-dragging');
        dragSrc = item;
        item.classList.add('dragging');
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            try {
                e.dataTransfer.setData('text/plain', item.dataset.id || '');
            } catch (_) {}
        }
    });

    currentEditList.addEventListener('dragend', () => {
        resetDragSession();
        settleDragHover();
    });

    /** @param {DragEvent} e */
    function trackMouseTarget(e) {
        if (!dragSrc || touchIdentifier !== null) return;
        updateDropTarget(e.target, e.clientY);
        if (!lastOverTarget) {
            updateDragIndicator();
            return;
        }
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        if (!dragOverRafId) {
            dragOverRafId = requestAnimationFrame(() => {
                dragOverRafId = null;
                updateDragIndicator();
            });
        }
    }
    currentEditList.addEventListener('dragenter', trackMouseTarget);
    currentEditList.addEventListener('dragover', trackMouseTarget);

    currentEditList.addEventListener('dragleave', e => {
        if (e.target === currentEditList || !(e.relatedTarget instanceof Node && currentEditList.contains(e.relatedTarget))) {
            updateDropTarget(null, 0);
            updateDragIndicator();
        }
    });

    currentEditList.addEventListener('drop', e => {
        if (!dragSrc || touchIdentifier !== null) return;
        e.preventDefault();
        updateDropTarget(e.target, e.clientY);
        const src = dragSrc;
        const target = lastOverTarget;
        const isTop = lastIsTop;
        resetDragSession();
        if (isTop !== null) commitReorder(src, target, isTop);
        settleDragHover();
    });

    // ── 触屏路径：.drag-handle 上有 touch-none（touch-action:none），无需 preventDefault ──
    cancelCurrentDrag = () => {
        resetDragSession();
        clearDragSettling();
    };

    currentEditList.addEventListener('touchstart', e => {
        if (dragSrc) return;
        const targetEl = e.target instanceof Element ? e.target : null;
        const handle = targetEl?.closest('.drag-handle');
        const card = /** @type {HTMLElement|null} */ (handle && handle.closest('.edit-row-card'));
        const touch = e.changedTouches[0];
        if (!handle || !card || !touch) return;
        touchIdentifier = touch.identifier;
        touchClientX = touch.clientX;
        touchClientY = touch.clientY;
        cachedListRect = currentEditList.getBoundingClientRect();
        blurActiveHandle();
        dragSrc = card;
        card.classList.add('dragging');
        document.body.classList.add('bookmark-dragging');
    }, { passive: true });

    function processTouchMove() {
        touchMoveRafId = null;
        if (!dragSrc || touchIdentifier === null) return;

        // 容器上下边缘自适应平滑滚动 (应对长列表场景)
        if (!cachedListRect) cachedListRect = currentEditList.getBoundingClientRect();
        const listRect = cachedListRect;
        const edgeZone = 36;
        const beforeScroll = currentEditList.scrollTop;
        if (touchClientY < listRect.top + edgeZone) {
            currentEditList.scrollTop -= 6;
        } else if (touchClientY > listRect.bottom - edgeZone) {
            currentEditList.scrollTop += 6;
        }

        if (currentEditList.scrollTop !== beforeScroll) {
            touchMoveRafId = requestAnimationFrame(processTouchMove);
        }
        updateDropTarget(document.elementFromPoint(touchClientX, touchClientY), touchClientY);
        updateDragIndicator();
    }

    currentEditList.addEventListener('touchmove', e => {
        if (!dragSrc) return;
        const touch = Array.from(e.touches).find(t => t.identifier === touchIdentifier);
        if (!touch) return;

        touchClientX = touch.clientX;
        touchClientY = touch.clientY;
        if (!touchMoveRafId) {
            touchMoveRafId = requestAnimationFrame(processTouchMove);
        }
    }, { passive: true });

    currentEditList.addEventListener('touchend', e => {
        const touch = Array.from(e.changedTouches).find(t => t.identifier === touchIdentifier);
        if (!dragSrc || !touch) return;
        updateDropTarget(document.elementFromPoint(touch.clientX, touch.clientY), touch.clientY);
        const src = dragSrc;
        const target = lastOverTarget;
        const isTop = lastIsTop ?? true;
        resetDragSession();
        if (target && src !== target) {
            commitReorder(src, target, isTop);
        }
        settleDragHover();
    }, { passive: true });

    // 系统手势、来电或弹窗中断：纯重置，严禁触发重排
    currentEditList.addEventListener('touchcancel', cancelDragSort, { passive: true });
}
