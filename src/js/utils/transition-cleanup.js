import { CONFIG } from '../config/constants.js';

/** @type {WeakMap<HTMLElement, () => void>} */
const pending = new WeakMap();

/** 新动效接管节点前，先收尾上一次动效及其延迟任务。 @param {HTMLElement} element */
export function finishPendingTransition(element) {
    pending.get(element)?.();
}

/**
 * 仅消费节点自身指定属性的事件；取消、减弱动效及事件缺失均能收尾。
 * @param {HTMLElement} element
 * @param {string} property
 * @param {number} duration
 * @param {() => void} cleanup
 */
export function onTransitionSettled(element, property, duration, cleanup) {
    finishPendingTransition(element);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        element.removeEventListener('transitionend', onEvent);
        element.removeEventListener('transitioncancel', onEvent);
        motion.removeEventListener('change', onMotion);
        pending.delete(element);
        cleanup();
    };
    /** @param {TransitionEvent} event */
    const onEvent = event => {
        if (event.target === element && event.propertyName === property) finish();
    };
    const onMotion = () => { if (motion.matches) finish(); };
    const timer = setTimeout(finish, duration + CONFIG.TIMERS.TRANSITION_CLEANUP_BUFFER);
    pending.set(element, finish);
    element.addEventListener('transitionend', onEvent);
    element.addEventListener('transitioncancel', onEvent);
    motion.addEventListener('change', onMotion);
}
