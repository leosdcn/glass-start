/** HTML 安全输出与无障碍列表键盘导航；不读取业务配置或状态。 */
/** @type {Record<string, string>} */
const htmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const htmlEscapeRegex = /[&<>"']/g;
/**
 * 将字符串中的 HTML 特殊字符转义为实体，防止 XSS
 * @param {string} str
 * @returns {string} HTML 转义后的安全字符串
 */
export function escapeHtml(str) {
    return String(str ?? '').replace(htmlEscapeRegex, ch => htmlEscapes[ch]);
}

/**
 * 协议白名单校验与 URL 安全过滤函数
 * 允许 HTTP(S)、图片 Data URL 及本地 icons/*.png 路径，默认返回 HTML 属性用转义值。
 * @param {string} url - 待校验的原始 URL 字符串
 * @param {boolean} [html=true] - HTML 模板使用转义值，原生 DOM 属性赋值传 false
 * @returns {string} 按赋值方式返回安全 URL；校验失败时返回 '#' 安全占位符
 */
export function safeUrl(url, html = true) {
    const u = (url || '').trim();
    return (/^https?:\/\//i.test(u) || /^data:image\//i.test(u) || /^(\.\/|\/)?icons\/[a-zA-Z0-9_\-\/.]+\.(png|svg|webp|ico)$/i.test(u)) ? (html ? escapeHtml(u) : u) : '#';
}

/**
 * 通用无障碍列表键盘方向键循环导航 (Roving Tabindex)
 * @param {KeyboardEvent} e
 * @param {HTMLElement[]} items
 * @param {HTMLElement | null} currentEl
 * @param {(nextEl: HTMLElement) => void} onSelect
 */
export function handleRovingKeyNav(e, items, currentEl, onSelect) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing || !items.length) return;
    const currentIndex = currentEl ? items.indexOf(currentEl) : -1;
    if (currentIndex === -1) return;
    let nextIndex;
    switch (e.key) {
        case 'ArrowDown':
        case 'ArrowRight':
            nextIndex = (currentIndex + 1) % items.length;
            break;
        case 'ArrowUp':
        case 'ArrowLeft':
            nextIndex = (currentIndex - 1 + items.length) % items.length;
            break;
        case 'Home':
            nextIndex = 0;
            break;
        case 'End':
            nextIndex = items.length - 1;
            break;
        default:
            return;
    }
    e.preventDefault();
    const nextEl = items[nextIndex];
    if (nextEl) {
        onSelect(nextEl);
        nextEl.focus();
    }
}
