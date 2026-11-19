/**
 * 统一结束、取消和减弱动效切换的收尾。动效开始前由调用方判断媒体偏好。
 * @param {Animation} animation
 * @param {MediaQueryList} motion
 * @param {(completed: boolean) => void} [onSettle]
 */
export function settleAnimation(animation, motion, onSettle) {
    const cancel = () => settle(false);
    const onMotion = () => { if (motion.matches) cancel(); };
    let settled = false;
    /** @param {boolean} completed */
    const settle = completed => {
        if (settled) return;
        settled = true;
        motion.removeEventListener('change', onMotion);
        animation.cancel();
        onSettle?.(completed);
    };

    motion.addEventListener('change', onMotion);
    animation.finished.then(() => settle(true), cancel);
    return cancel;
}
