/**
 * ==============================================================================
 * Glass Start — 统一 UI 状态与多层弹窗响应栈 (src/js/core/overlay-stack.js)
 * ==============================================================================
 * 遵循 4 级 z-index 体系与 LIFO 退栈原则，管理全局 Escape 键与 Body 滚动穿透锁定。
 */

export const MODAL_OVERLAY_IDS = new Set([
    'editModal',
    'shortcutModal',
    'creditsModal',
    'confirmModal',
    'bookmarkPicker'
]);

export const OverlayStack = {
    stack: [],

    push(id, closeFn) {
        this.pop(id);
        this.stack.push({ id, close: closeFn });
        if (MODAL_OVERLAY_IDS.has(id)) {
            document.body.classList.add('overflow-hidden', 'touch-none');
        }
    },

    pop(id) {
        let removed = null;
        if (id) {
            const idx = this.stack.findIndex(item => item.id === id);
            if (idx !== -1) {
                removed = this.stack.splice(idx, 1)[0];
            }
        } else {
            removed = this.stack.pop() || null;
        }
        const hasOpenModal = this.stack.some(item => MODAL_OVERLAY_IDS.has(item.id));
        if (!hasOpenModal) {
            document.body.classList.remove('overflow-hidden', 'touch-none');
        }
        return removed;
    },

    top() {
        return this.stack[this.stack.length - 1] || null;
    },

    isEmpty() {
        return this.stack.length === 0;
    }
};
