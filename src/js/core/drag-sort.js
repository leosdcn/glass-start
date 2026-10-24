/**
 * 书签重排：鼠标使用 HTML5 拖拽，触屏使用 touch 事件，共用草稿提交与 FLIP 动画。
 */
import { CONFIG } from '../config/constants.js';
import { dom } from '../state/dom.js';
import { modalState } from '../state/store.js';
import { reorderBookmarkDraft } from '../state/bookmark-draft.js';
import { updateAllBookmarkCounters } from '../modules/bookmark-editor.js';
import { finishPendingTransition, onTransitionSettled } from '../utils/transition-cleanup.js';

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
    let hasPendingTouch = false;
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
    const editList = dom.editList;
    if (!editList) return;
    const currentEditList = editList;

    /**
     * @param {HTMLElement} target
     * @param {number} relY
     */
    function updateDropTarget(target, relY) {
        const isTop = lastOverTarget === target && lastIsTop !== null
            ? (lastIsTop ? relY <= CONFIG.PHYSICS.DRAG_HYSTERESIS_HIGH : relY < CONFIG.PHYSICS.DRAG_HYSTERESIS_LOW)
            : relY < 0.5;
        lastOverTarget = target;
        lastIsTop = isTop;
    }

    /**
     * @param {HTMLElement} target
     * @param {boolean} isTop
     */
    function updateDragIndicator(target, isTop) {
        lastOverTarget = target;
        lastIsTop = isTop;
        if (indicatorTarget === target && indicatorIsTop === isTop) return;
        indicatorTarget?.classList.remove('drop-target-above', 'drop-target-below');
        target.classList.add(isTop ? 'drop-target-above' : 'drop-target-below');
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
        hasPendingTouch = false;
        currentEditList.querySelectorAll('.edit-row-card').forEach(el => {
            el.classList.remove('dragging', 'drop-target-above', 'drop-target-below');
        });
        lastOverTarget = null;
        lastIsTop = null;
        indicatorTarget = null;
        indicatorIsTop = null;
    }

    let isDragHandleActive = false;
    /** @type {number | null} */
    let dragSettlingRaf = null;

    function blurActiveHandle() {
        const active = /** @type {HTMLElement|null} */ (document.activeElement);
        if (active && active.closest('.drag-handle')) {
            active.blur();
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

        // 清除旧 FLIP（包括尚未执行的 rAF），再测量本次布局。
        const rows = /** @type {HTMLElement[]} */ (Array.from(currentEditList.querySelectorAll('.edit-row-card')));
        rows.forEach(finishPendingTransition);
        /** @type {HTMLElement[]} */
        const cards = window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? [] : rows.filter(card => card.isConnected);
        const firstPositions = new Map();
        cards.forEach(card => firstPositions.set(card, card.getBoundingClientRect()));

        if (isTop) {
            target.parentNode?.insertBefore(src, target);
        } else {
            target.parentNode?.insertBefore(src, target.nextSibling);
        }
        reorderBookmarkDraft(src.dataset.id || '', target.dataset.id || '', isTop);

        // 先批量读取重排后的坐标，再写入 FLIP 样式，避免逐行交错读写。
        const lastPositions = new Map(cards.map(card => [card, card.getBoundingClientRect()]));
        cards.forEach(card => {
            const first = firstPositions.get(card);
            const last = lastPositions.get(card);
            if (!first || !last) return;
            const deltaY = first.top - last.top;
            const deltaX = first.left - last.left;
            if (deltaY !== 0 || deltaX !== 0) {
                card.style.transition = 'none';
                card.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
                const frame = requestAnimationFrame(() => {
                    const flipSec = `${CONFIG.TIMERS.FLIP_DURATION_MS / 1000}s`;
                    card.style.transition = `transform ${flipSec} var(--ease-overshoot)`;
                    card.style.transform = 'translate3d(0, 0, 0)';
                });
                onTransitionSettled(card, 'transform', CONFIG.TIMERS.FLIP_DURATION_MS, () => {
                    cancelAnimationFrame(frame);
                    card.style.transition = '';
                    card.style.transform = '';
                });
            }
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
        if (status) status.textContent = `${modalState.draftBookmarks[nextIndex].name} 已移至第 ${nextIndex + 1} 项，共 ${modalState.draftBookmarks.length} 项`;
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
        isDragHandleActive = false;
        document.body.classList.remove('bookmark-dragging');
        currentEditList.querySelectorAll('.edit-row-card[draggable="true"]').forEach(card => {
            card.setAttribute('draggable', 'false');
        });
        blurActiveHandle();
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
                e.dataTransfer.setData('text/plain', item.dataset.id || item.dataset.idx || '');
            } catch (_) {}
        }
    });

    currentEditList.addEventListener('dragend', () => {
        isDragHandleActive = false;
        document.body.classList.remove('bookmark-dragging');
        currentEditList.querySelectorAll('.edit-row-card[draggable="true"]').forEach(card => {
            card.setAttribute('draggable', 'false');
        });
        clearDragClasses();
        dragSrc = null;
        blurActiveHandle();
        settleDragHover();
    });

    currentEditList.addEventListener('dragover', e => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const targetEl = e.target instanceof Element ? e.target : null;
        const target = /** @type {HTMLElement|null} */ (targetEl?.closest('.edit-row-card'));
        if (!target || target === dragSrc) return;
        const rect = target.getBoundingClientRect();
        const relY = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
        updateDropTarget(target, relY);
        if (!dragOverRafId) {
            dragOverRafId = requestAnimationFrame(() => {
                dragOverRafId = null;
                if (lastOverTarget && lastIsTop !== null) updateDragIndicator(lastOverTarget, lastIsTop);
            });
        }
    });

    currentEditList.addEventListener('dragleave', e => {
        if (e.target === currentEditList || !(e.relatedTarget instanceof Node && currentEditList.contains(e.relatedTarget))) clearDragClasses();
    });

    currentEditList.addEventListener('drop', e => {
        e.preventDefault();
        const targetEl = e.target instanceof Element ? e.target : null;
        let target = lastOverTarget || /** @type {HTMLElement|null} */ (targetEl?.closest('.edit-row-card'));
        let isTop = lastIsTop;
        if (target && isTop === null) {
            const rect = target.getBoundingClientRect();
            isTop = ((e.clientY - rect.top) / (rect.height || 1)) < 0.5;
        } else if (isTop === null) {
            isTop = true;
        }
        const src = dragSrc;
        dragSrc = null;
        clearDragClasses();
        blurActiveHandle();
        commitReorder(src, target, isTop);
        settleDragHover();
    });

    // ── 触屏路径：.drag-handle 上有 touch-none（touch-action:none），无需 preventDefault ──
    cancelCurrentDrag = () => {
        dragSrc = null;
        touchIdentifier = null;
        isDragHandleActive = false;
        clearDragClasses();
        currentEditList.querySelectorAll('[draggable="true"]').forEach(card => card.setAttribute('draggable', 'false'));
        document.body.classList.remove('bookmark-dragging');
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
        blurActiveHandle();
        dragSrc = card;
        card.classList.add('dragging');
        document.body.classList.add('bookmark-dragging');
    }, { passive: true });

    function processTouchMove() {
        touchMoveRafId = null;
        if (!dragSrc || touchIdentifier === null) return;
        hasPendingTouch = false;

        // 容器上下边缘自适应平滑滚动 (应对长列表场景)
        const listRect = currentEditList.getBoundingClientRect();
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
        const el = document.elementFromPoint(touchClientX, touchClientY);
        const target = /** @type {HTMLElement|null} */ (el && el.closest('.edit-row-card'));

        // 滑回自身或移出列表卡片区时，隐藏指示线并重置目标，防止松手误重排
        if (!target || target === dragSrc) {
            indicatorTarget?.classList.remove('drop-target-above', 'drop-target-below');
            lastOverTarget = indicatorTarget = null;
            lastIsTop = indicatorIsTop = null;
            return;
        }

        const rect = target.getBoundingClientRect();
        const relY = (touchClientY - rect.top) / (rect.height || 1);
        updateDropTarget(target, relY);
        if (lastOverTarget && lastIsTop !== null) {
            updateDragIndicator(lastOverTarget, lastIsTop);
        }
    }

    currentEditList.addEventListener('touchmove', e => {
        if (!dragSrc) return;
        const touch = Array.from(e.touches).find(t => t.identifier === touchIdentifier);
        if (!touch) return;

        touchClientX = touch.clientX;
        touchClientY = touch.clientY;
        hasPendingTouch = true;
        if (!touchMoveRafId) {
            touchMoveRafId = requestAnimationFrame(processTouchMove);
        }
    }, { passive: true });

    currentEditList.addEventListener('touchend', e => {
        if (!dragSrc || !Array.from(e.changedTouches).some(t => t.identifier === touchIdentifier)) return;
        if (touchMoveRafId) {
            cancelAnimationFrame(touchMoveRafId);
            touchMoveRafId = null;
        }
        if (hasPendingTouch) {
            processTouchMove();
        }
        const src = dragSrc;
        const target = lastOverTarget;
        const isTop = lastIsTop ?? true;
        dragSrc = null;
        touchIdentifier = null;
        hasPendingTouch = false;
        clearDragClasses();
        blurActiveHandle();
        document.body.classList.remove('bookmark-dragging');
        if (target && src !== target) {
            commitReorder(src, target, isTop);
        }
    }, { passive: true });

    // 系统手势、来电或弹窗中断：纯重置，严禁触发重排
    currentEditList.addEventListener('touchcancel', cancelDragSort, { passive: true });
}
