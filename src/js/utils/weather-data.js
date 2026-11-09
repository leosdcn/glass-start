/** 首帧缓存恢复和运行时共用的气象数值清洗与单位换算规则。 */
/** @param {string | null} value 已存储的温度单位，兼容 JSON 字符串。 */
export function parseTempUnit(value) {
    return value === 'F' || value === '"F"' ? 'F' : 'C';
}

/** @param {unknown} value @param {number} fallback @returns {number} */
export function weatherNum(value, fallback) {
    if (typeof value !== 'number' && typeof value !== 'string') return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

/**
 * 将摄氏度转换为当前显示单位的数值
 * @param {unknown} celsius
 * @param {'C' | 'F' | string} [unit]
 * @returns {number | '--'}
 */
export function toDisplayTemp(celsius, unit = 'C') {
    const c = weatherNum(celsius, NaN);
    if (!Number.isFinite(c)) return '--';
    return unit === 'F' ? Math.round(c * 1.8 + 32) : Math.round(c);
}
