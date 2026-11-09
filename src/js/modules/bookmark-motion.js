import { CONFIG } from '../config/constants.js';
import { updateAllBookmarkCounters } from './bookmark-editor.js';

/** @type {WeakMap<HTMLElement, () => void>} */
const cancelRowMotion = new WeakMap();

/** @param {HTMLElement} list */
function settleBookmarkRows(list) {
    const rows = Array.from(/** @type {NodeListOf<HTMLElement>} */ (list.querySelectorAll('.edit-row-card')));
    rows.forEach(row => cancelRowMotion.get(row)?.());
    return rows;
}

/**
 * @param {HTMLElement} row
 * @param {Keyframe[]} keyframes
 * @param {number} duration
 * @param {string} easing
 * @param {(completed: boolean) => void} [onSettle]
 */
function playRowMotion(row, keyframes, duration, easing, onSettle) {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animation = row.animate(keyframes, { duration, easing, fill: 'both' });
    const cancel = () => settle(false);
    const onMotion = () => { if (motion.matches) cancel(); };
    /** @param {boolean} completed */
    const settle = completed => {
        if (cancelRowMotion.get(row) !== cancel) return;
        cancelRowMotion.delete(row);
        motion.removeEventListener('change', onMotion);
        animation.cancel();
        onSettle?.(completed);
    };
    cancelRowMotion.set(row, cancel);
    motion.addEventListener('change', onMotion);
    animation.finished.then(() => settle(true), cancel);
}

/** 删除和重排共用同一份位移动画。先完成旧操作，再分批测量布局。 */
/** @param {HTMLElement} list @param {() => void} update */
export function animateBookmarkLayout(list, update) {
    const rows = settleBookmarkRows(list);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        update();
        return;
    }
    const before = rows.filter(row => row.isConnected).map(row => ({ row, rect: row.getBoundingClientRect() }));
    update();
    const moved = before.filter(({ row }) => row.isConnected).map(({ row, rect }) => {
        const after = row.getBoundingClientRect();
        return { row, x: rect.left - after.left, y: rect.top - after.top };
    });
    const easing = getComputedStyle(list).getPropertyValue('--ease-soft-spring').trim();
    moved.forEach(({ row, x, y }) => {
        if (x || y) playRowMotion(row, [
            { transform: `translate3d(${x}px, ${y}px, 0)` }, { transform: 'none' }
        ], CONFIG.TIMERS.FLIP_DURATION_MS, easing);
    });
}

/** @param {HTMLElement} list @param {HTMLElement} row */
export function animateBookmarkRemoval(list, row) {
    settleBookmarkRows(list);
    if (!row.isConnected) return;
    const remove = () => {
        row.remove();
        updateAllBookmarkCounters();
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        remove();
        return;
    }
    const easing = getComputedStyle(list).getPropertyValue('--ease-exit').trim();
    const { BOOKMARK_DELETE_SCALE, BOOKMARK_DELETE_OFFSET_Y } = CONFIG.PHYSICS;
    playRowMotion(row, [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: `scale(${BOOKMARK_DELETE_SCALE}) translateY(${BOOKMARK_DELETE_OFFSET_Y}px)` }
    ], CONFIG.TIMERS.BOOKMARK_DELETE_DURATION, easing, completed => {
        if (!row.isConnected) return;
        if (completed) animateBookmarkLayout(list, remove);
        else remove();
    });
}
